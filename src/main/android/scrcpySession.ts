import { app, BrowserWindow, clipboard, ipcMain, screen, type IpcMainEvent } from 'electron'
import { ChildProcessWithoutNullStreams, execFile, spawn } from 'child_process'
import { randomInt } from 'crypto'
import { writeFile } from 'fs/promises'
import { connect, type Socket } from 'net'
import { join } from 'path'
import { promisify } from 'util'
import type { MirrorInput, MirrorOptions, MirrorSessionInfo } from '../../shared/types'
import { makeCapturePath } from '../media/capturePaths'
import { getBinRoot, resolveBinary } from '../paths'

const execFileAsync = promisify(execFile)

const SERVER_VERSION = '3.2'
const DEVICE_SERVER_PATH = '/data/local/tmp/scryno-server.jar'
const BAR_HEIGHT = 40
const CONNECT_TIMEOUT_MS = 10_000
const CODEC_DISABLED = 0
const CODEC_ERROR = 1

const CONTROL_INJECT_KEYCODE = 0
const CONTROL_INJECT_TEXT = 1
const CONTROL_INJECT_TOUCH = 2
const CONTROL_INJECT_SCROLL = 3
const CONTROL_BACK_OR_SCREEN_ON = 4
const CONTROL_EXPAND_NOTIFICATIONS = 5
const CONTROL_SET_CLIPBOARD = 9
const CONTROL_START_APP = 16

const DEVICE_MESSAGE_CLIPBOARD = 0
const DEVICE_MESSAGE_ACK_CLIPBOARD = 1
const DEVICE_MESSAGE_UHID_OUTPUT = 2

class StreamReader {
  private chunks: Buffer[] = []
  private length = 0
  private closed = false
  private waiters: {
    size: number
    resolve: (data: Buffer) => void
    reject: (error: Error) => void
  }[] = []

  constructor(socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.chunks.push(chunk)
      this.length += chunk.length
      this.pump()
    })
    socket.on('close', () => {
      this.closed = true
      this.pump()
    })
    socket.on('error', () => undefined)
  }

  read(size: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ size, resolve, reject })
      this.pump()
    })
  }

  private pump(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0]
      if (this.length >= waiter.size) {
        this.waiters.shift()
        const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks)
        waiter.resolve(all.subarray(0, waiter.size))
        const rest = all.subarray(waiter.size)
        this.chunks = rest.length > 0 ? [rest] : []
        this.length = rest.length
      } else if (this.closed) {
        this.waiters.shift()
        waiter.reject(new Error('Bağlantı kapandı'))
      } else {
        return
      }
    }
  }
}

interface ActiveSession {
  info: MirrorSessionInfo
  label: string
  server: ChildProcessWithoutNullStreams
  port: number
  sockets: Socket[]
  control: Socket | null
  window: BrowserWindow | null
  options: MirrorOptions
  clipboardSequence: bigint
  recording: boolean
  autoRecordArmed: boolean
  stopPromise: Promise<{ path: string }> | null
  pendingRecording: {
    resolve: (path: string) => void
    reject: (error: Error) => void
  } | null
  startStreaming: (() => void) | null
  closing: boolean
}

const sessions = new Map<string, ActiveSession>()

type SessionExitListener = (deviceId: string) => void

let onSessionExit: SessionExitListener | null = null
let ipcRegistered = false

export function setSessionExitListener(listener: SessionExitListener | null): void {
  onSessionExit = listener
}

export function getSession(deviceId: string): MirrorSessionInfo | undefined {
  return sessions.get(deviceId)?.info
}

export function listSessions(): MirrorSessionInfo[] {
  return Array.from(sessions.values()).map((session) => session.info)
}

function mirrorPageUrl(deviceId: string, label: string, control: boolean): string {
  const query = new URLSearchParams({
    deviceId,
    label,
    control: control ? '1' : '0'
  }).toString()
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/android-mirror.html?${query}`
  }
  return `file://${join(__dirname, '../renderer/android-mirror.html')}?${query}`
}

function buildServerArgs(
  scid: string,
  options: MirrorOptions
): { args: string[]; audio: boolean; control: boolean } {
  const source = options.source ?? 'display'
  const control = source !== 'camera'
  const audio = options.audio !== false
  const args = [
    `scid=${scid}`,
    'log_level=info',
    'tunnel_forward=true',
    `audio=${audio}`,
    `control=${control}`,
    'video_codec=h264',
    `max_size=${options.maxSize ?? 1280}`,
    `video_bit_rate=${options.bitRate ?? 8_000_000}`,
    `max_fps=${options.maxFps ?? 60}`,
    `clipboard_autosync=${options.clipboard !== false}`,
    'i_frame_interval=1'
  ]

  if (audio) {
    args.push('audio_codec=opus')
    if (source === 'camera') {
      args.push('audio_source=mic-camcorder')
    }
  }

  const startApp = options.startApp?.trim() ?? ''
  if (source === 'camera') {
    const facing = options.cameraFacing === 'front' ? 'front' : 'back'
    args.push('video_source=camera', `camera_facing=${facing}`)
  } else {
    if (startApp) {
      const pattern = source === 'virtual' ? /^[+?]{0,2}[A-Za-z][\w.]*$/ : /^[A-Za-z][\w.]*$/
      if (!pattern.test(startApp)) {
        throw Object.assign(
          new Error('Uygulama adı paket biçiminde olmalı. Örnek: com.android.chrome'),
          {
            code: 'INVALID_APP'
          }
        )
      }
    }
    switch (options.orientation) {
      case 'initial':
        args.push('capture_orientation=@')
        break
      case 'portrait':
        args.push('capture_orientation=@0')
        break
      case 'landscape':
        args.push('capture_orientation=@90')
        break
    }
    if (options.stayAwake !== false) {
      args.push('stay_awake=true')
    }
  }

  if (source === 'virtual') {
    args.push('new_display=')
    if (options.keepVirtualApp) {
      args.push('vd_destroy_content=false')
    }
  }

  return { args, audio, control }
}

function connectSocket(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    socket.setNoDelay(true)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// adb accepts the forwarded connection before the server listens, so a socket that closes
// without the dummy byte means the server is not ready yet.
async function connectFirstSocket(
  port: number,
  server: ChildProcessWithoutNullStreams
): Promise<{ socket: Socket; reader: StreamReader }> {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      break
    }
    try {
      const socket = await connectSocket(port)
      const reader = new StreamReader(socket)
      await reader.read(1)
      return { socket, reader }
    } catch {
      await delay(100)
    }
  }
  throw Object.assign(new Error('Telefondaki yansıtma servisi başlamadı'), {
    code: 'SERVER_NOT_READY'
  })
}

function windowSizeFor(
  videoWidth: number,
  videoHeight: number,
  longSide?: number
): { width: number; height: number } {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const maxWidth = Math.round(area.width * 0.85)
  const maxHeight = area.height - BAR_HEIGHT - 24
  const target = longSide ?? Math.min(maxHeight, 900)
  let scale = target / Math.max(videoWidth, videoHeight)
  scale = Math.min(scale, maxWidth / videoWidth, maxHeight / videoHeight)
  return {
    width: Math.round(videoWidth * scale),
    height: Math.round(videoHeight * scale) + BAR_HEIGHT
  }
}

function sendControl(session: ActiveSession, message: Buffer): void {
  if (session.control && !session.control.destroyed) {
    session.control.write(message)
  }
}

function startAppMessage(name: string): Buffer {
  const content = Buffer.from(name, 'utf8')
  if (content.length === 0 || content.length > 255) {
    throw Object.assign(
      new Error('Uygulama adı paket biçiminde olmalı. Örnek: com.android.chrome'),
      { code: 'INVALID_APP' }
    )
  }
  const message = Buffer.alloc(2 + content.length)
  message.writeUInt8(CONTROL_START_APP, 0)
  message.writeUInt8(content.length, 1)
  content.copy(message, 2)
  return message
}

function fixedPoint16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value))
  return Math.max(-0x8000, Math.min(0x7fff, Math.round(clamped * 0x8000)))
}

function keycodeMessage(action: number, keycode: number, metaState: number): Buffer {
  const message = Buffer.alloc(14)
  message.writeUInt8(CONTROL_INJECT_KEYCODE, 0)
  message.writeUInt8(action, 1)
  message.writeInt32BE(keycode, 2)
  message.writeInt32BE(0, 6)
  message.writeInt32BE(metaState, 10)
  return message
}

function clipboardMessage(session: ActiveSession, text: string, paste: boolean): Buffer {
  const content = Buffer.from(text, 'utf8').subarray(0, 256 * 1024 - 14)
  const message = Buffer.alloc(14 + content.length)
  session.clipboardSequence += 1n
  message.writeUInt8(CONTROL_SET_CLIPBOARD, 0)
  message.writeBigUInt64BE(session.clipboardSequence, 1)
  message.writeUInt8(paste ? 1 : 0, 9)
  message.writeUInt32BE(content.length, 10)
  content.copy(message, 14)
  return message
}

function handleInput(session: ActiveSession, input: MirrorInput): void {
  switch (input.kind) {
    case 'touch': {
      const message = Buffer.alloc(32)
      message.writeUInt8(CONTROL_INJECT_TOUCH, 0)
      message.writeUInt8(input.action, 1)
      message.writeBigInt64BE(-1n, 2)
      message.writeInt32BE(Math.round(input.x), 10)
      message.writeInt32BE(Math.round(input.y), 14)
      message.writeUInt16BE(input.width, 18)
      message.writeUInt16BE(input.height, 20)
      message.writeUInt16BE(input.action === 1 ? 0 : 0xffff, 22)
      message.writeUInt32BE(1, 24)
      message.writeUInt32BE(input.buttons, 28)
      sendControl(session, message)
      break
    }
    case 'scroll': {
      const message = Buffer.alloc(21)
      message.writeUInt8(CONTROL_INJECT_SCROLL, 0)
      message.writeInt32BE(Math.round(input.x), 1)
      message.writeInt32BE(Math.round(input.y), 5)
      message.writeUInt16BE(input.width, 9)
      message.writeUInt16BE(input.height, 11)
      message.writeInt16BE(fixedPoint16(input.horizontal / 16), 13)
      message.writeInt16BE(fixedPoint16(input.vertical / 16), 15)
      message.writeInt32BE(0, 17)
      sendControl(session, message)
      break
    }
    case 'key':
      sendControl(session, keycodeMessage(input.action, input.keycode, input.metaState))
      break
    case 'text': {
      const content = Buffer.from(input.text, 'utf8').subarray(0, 300)
      const message = Buffer.alloc(5 + content.length)
      message.writeUInt8(CONTROL_INJECT_TEXT, 0)
      message.writeUInt32BE(content.length, 1)
      content.copy(message, 5)
      sendControl(session, message)
      break
    }
    case 'paste': {
      const text = clipboard.readText()
      if (text) {
        sendControl(session, clipboardMessage(session, text, true))
      }
      break
    }
    case 'back':
      sendControl(session, Buffer.from([CONTROL_BACK_OR_SCREEN_ON, 0]))
      sendControl(session, Buffer.from([CONTROL_BACK_OR_SCREEN_ON, 1]))
      break
    case 'notifications':
      sendControl(session, Buffer.from([CONTROL_EXPAND_NOTIFICATIONS]))
      break
  }
}

function sessionForSender(
  event: IpcMainEvent | Electron.IpcMainInvokeEvent
): ActiveSession | undefined {
  for (const session of sessions.values()) {
    if (
      session.window &&
      !session.window.isDestroyed() &&
      session.window.webContents.id === event.sender.id
    ) {
      return session
    }
  }
  return undefined
}

function registerMirrorIpc(): void {
  if (ipcRegistered) {
    return
  }
  ipcRegistered = true

  ipcMain.on('android-mirror:ready', (event) => {
    const session = sessionForSender(event)
    if (!session) {
      return
    }
    session.startStreaming?.()
    if (session.options.record && !session.autoRecordArmed) {
      session.autoRecordArmed = true
      try {
        startMirrorRecording(session.info.deviceId)
      } catch {
        session.autoRecordArmed = false
      }
    }
  })

  ipcMain.on('android-mirror:input', (event, input: MirrorInput) => {
    const session = sessionForSender(event)
    if (session && input && typeof input === 'object') {
      handleInput(session, input)
    }
  })

  ipcMain.on('android-mirror:size', (event, videoWidth: number, videoHeight: number) => {
    const session = sessionForSender(event)
    const win = session?.window
    if (!win || win.isDestroyed() || !(videoWidth > 0) || !(videoHeight > 0)) {
      return
    }
    const current = win.getBounds()
    const longSide = Math.max(current.width, current.height - BAR_HEIGHT)
    const size = windowSizeFor(videoWidth, videoHeight, longSide)
    win.setAspectRatio(videoWidth / videoHeight, {
      width: 0,
      height: BAR_HEIGHT
    })
    win.setBounds({
      x: Math.round(current.x + (current.width - size.width) / 2),
      y: current.y,
      width: size.width,
      height: size.height
    })
  })

  ipcMain.handle('android-mirror:recording', async (event, data: Uint8Array, extension: string) => {
    const session = sessionForSender(event)
    const pending = session?.pendingRecording
    if (!session || !pending) {
      return { ok: false as const }
    }
    session.pendingRecording = null
    try {
      const path = makeCapturePath('recording', extension === 'mp4' ? 'mp4' : 'webm')
      await writeFile(path, Buffer.from(data))
      pending.resolve(path)
      return { ok: true as const }
    } catch (error) {
      pending.reject(error as Error)
      return { ok: false as const }
    }
  })
}

async function pumpPackets(
  session: ActiveSession,
  reader: StreamReader,
  channel: 'android-mirror:video' | 'android-mirror:audio',
  onFirstPacket?: () => void
): Promise<void> {
  let first = true
  for (;;) {
    const header = await reader.read(12)
    const ptsAndFlags = header.readBigUInt64BE(0)
    const size = header.readUInt32BE(8)
    const data = await reader.read(size)
    const win = session.window
    if (!win || win.isDestroyed()) {
      return
    }
    win.webContents.send(channel, {
      config: ((ptsAndFlags >> 63n) & 1n) === 1n,
      key: ((ptsAndFlags >> 62n) & 1n) === 1n,
      pts: Number(ptsAndFlags & 0x3fffffffffffffffn),
      data
    })
    if (first && onFirstPacket) {
      first = false
      onFirstPacket()
    }
  }
}

async function pumpDeviceMessages(session: ActiveSession, reader: StreamReader): Promise<void> {
  for (;;) {
    const type = (await reader.read(1)).readUInt8(0)
    if (type === DEVICE_MESSAGE_CLIPBOARD) {
      const length = (await reader.read(4)).readUInt32BE(0)
      const text = (await reader.read(length)).toString('utf8')
      if (session.options.clipboard !== false && text !== clipboard.readText()) {
        clipboard.writeText(text)
      }
    } else if (type === DEVICE_MESSAGE_ACK_CLIPBOARD) {
      await reader.read(8)
    } else if (type === DEVICE_MESSAGE_UHID_OUTPUT) {
      const header = await reader.read(4)
      await reader.read(header.readUInt16BE(2))
    } else {
      return
    }
  }
}

function teardown(deviceId: string, session: ActiveSession, reason: string): void {
  if (session.closing) {
    return
  }
  session.closing = true
  sessions.delete(deviceId)
  void reason
  session.pendingRecording?.reject(new Error('Yansıtma kapandı, kayıt alınamadı'))
  session.pendingRecording = null
  for (const socket of session.sockets) {
    socket.destroy()
  }
  if (session.server.exitCode === null) {
    session.server.kill('SIGTERM')
  }
  execFile(
    resolveBinary('adb'),
    ['-s', deviceId, 'forward', '--remove', `tcp:${session.port}`],
    () => undefined
  )
  if (session.window && !session.window.isDestroyed()) {
    session.window.destroy()
  }
  onSessionExit?.(deviceId)
}

export async function startScrcpySession(
  deviceId: string,
  options: MirrorOptions = {},
  label = deviceId
): Promise<MirrorSessionInfo> {
  if (sessions.has(deviceId)) {
    throw Object.assign(new Error(`Bu cihaz için zaten bir yansıtma oturumu var: ${deviceId}`), {
      code: 'SESSION_EXISTS'
    })
  }
  registerMirrorIpc()

  const adbPath = resolveBinary('adb')
  const scid = randomInt(0, 0x7fffffff).toString(16).padStart(8, '0')
  const { args, audio, control } = buildServerArgs(scid, options)

  try {
    await execFileAsync(
      adbPath,
      ['-s', deviceId, 'push', join(getBinRoot(), 'scrcpy-server'), DEVICE_SERVER_PATH],
      {
        timeout: 30_000
      }
    )
  } catch (error) {
    const err = error as { stderr?: string; message?: string }
    throw Object.assign(
      new Error(
        `Telefona yansıtma servisi gönderilemedi: ${(err.stderr || err.message || '').trim()}`
      ),
      {
        code: 'SERVER_PUSH_FAILED'
      }
    )
  }

  const { stdout: forwardOut } = await execFileAsync(
    adbPath,
    ['-s', deviceId, 'forward', 'tcp:0', `localabstract:scrcpy_${scid}`],
    { timeout: 10_000 }
  )
  const port = Number.parseInt(forwardOut.trim(), 10)

  const server = spawn(adbPath, [
    '-s',
    deviceId,
    'shell',
    `CLASSPATH=${DEVICE_SERVER_PATH}`,
    'app_process',
    '/',
    'com.genymobile.scrcpy.Server',
    SERVER_VERSION,
    ...args
  ])
  let serverLog = ''
  const collect = (chunk: Buffer): void => {
    serverLog = `${serverLog}${chunk.toString()}`.slice(-4000)
  }
  server.stdout.on('data', collect)
  server.stderr.on('data', collect)

  const session: ActiveSession = {
    info: { deviceId, pid: server.pid ?? -1, startedAt: Date.now() },
    label,
    server,
    port,
    sockets: [],
    control: null,
    window: null,
    options,
    clipboardSequence: 0n,
    recording: false,
    autoRecordArmed: false,
    stopPromise: null,
    pendingRecording: null,
    startStreaming: null,
    closing: false
  }

  let videoReader: StreamReader
  let audioReader: StreamReader | null = null
  let controlReader: StreamReader | null = null
  let videoWidth: number
  let videoHeight: number
  try {
    const first = await connectFirstSocket(port, server)
    session.sockets.push(first.socket)
    videoReader = first.reader
    if (audio) {
      const socket = await connectSocket(port)
      session.sockets.push(socket)
      audioReader = new StreamReader(socket)
    }
    if (control) {
      const socket = await connectSocket(port)
      session.sockets.push(socket)
      session.control = socket
      controlReader = new StreamReader(socket)
    }
    await videoReader.read(64)
    const codec = await videoReader.read(12)
    if (codec.readUInt32BE(0) === CODEC_DISABLED || codec.readUInt32BE(0) === CODEC_ERROR) {
      throw new Error('Telefon görüntüyü paylaşmadı')
    }
    videoWidth = codec.readUInt32BE(4)
    videoHeight = codec.readUInt32BE(8)
    const startApp = options.startApp?.trim() ?? ''
    if (startApp && session.control) {
      sendControl(session, startAppMessage(startApp))
    }
  } catch (error) {
    session.closing = true
    for (const socket of session.sockets) {
      socket.destroy()
    }
    server.kill('SIGTERM')
    execFile(adbPath, ['-s', deviceId, 'forward', '--remove', `tcp:${port}`], () => undefined)
    const detail = serverLog
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('at '))
      .slice(-3)
      .join(' ')
    throw Object.assign(
      new Error(`Yansıtma başlatılamadı: ${detail || (error as Error).message}`),
      { code: 'MIRROR_START_FAILED' }
    )
  }

  const size = windowSizeFor(videoWidth, videoHeight)
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + Math.max(0, (area.height - size.height) / 2)),
    minWidth: 180,
    minHeight: 240,
    show: false,
    title: label,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.setAspectRatio(videoWidth / videoHeight, {
    width: 0,
    height: BAR_HEIGHT
  })
  session.window = win
  sessions.set(deviceId, session)

  win.on('close', (event) => {
    if (session.recording && !session.closing) {
      event.preventDefault()
      void stopMirrorRecording(deviceId)
        .catch(() => undefined)
        .finally(() => teardown(deviceId, session, 'pencere kapatıldı'))
    }
  })
  win.on('closed', () => teardown(deviceId, session, 'pencere kapatıldı'))
  server.on('exit', (code) => teardown(deviceId, session, `sunucu çıktı (${code})`))
  server.on('error', (error) => teardown(deviceId, session, error.message))
  session.sockets[0].on('close', () => teardown(deviceId, session, 'görüntü bağlantısı kapandı'))

  session.startStreaming = () => {
    session.startStreaming = null
    void pumpPackets(session, videoReader, 'android-mirror:video').catch((error: Error) =>
      teardown(deviceId, session, error.message)
    )
    if (audioReader) {
      void readAudio(session, audioReader)
    }
    if (controlReader) {
      void pumpDeviceMessages(session, controlReader).catch(() => undefined)
    }
  }

  await win.loadURL(mirrorPageUrl(deviceId, label, control))
  win.show()

  return session.info
}

async function readAudio(session: ActiveSession, reader: StreamReader): Promise<void> {
  try {
    const codec = (await reader.read(4)).readUInt32BE(0)
    if (codec === CODEC_DISABLED || codec === CODEC_ERROR) {
      return
    }
    await pumpPackets(session, reader, 'android-mirror:audio')
  } catch {
    // The phone may refuse audio capture; video keeps running.
  }
}

export function isMirrorRecording(deviceId: string): boolean {
  return sessions.get(deviceId)?.recording ?? false
}

export function startMirrorRecording(deviceId: string): void {
  const session = sessions.get(deviceId)
  if (!session?.window || session.window.isDestroyed()) {
    throw Object.assign(new Error('Aktif yansıtma yok'), {
      code: 'SESSION_NOT_FOUND'
    })
  }
  if (session.recording || session.stopPromise) {
    throw Object.assign(new Error('Bu cihaz için zaten kayıt var'), {
      code: 'RECORDING_EXISTS'
    })
  }
  session.recording = true
  session.window.webContents.send('android-mirror:record', 'start')
}

export function stopMirrorRecording(deviceId: string): Promise<{ path: string }> {
  const session = sessions.get(deviceId)
  if (!session?.window || session.window.isDestroyed()) {
    return Promise.reject(
      Object.assign(new Error('Aktif kayıt yok'), {
        code: 'RECORDING_NOT_FOUND'
      })
    )
  }
  if (session.stopPromise) {
    return session.stopPromise
  }
  if (!session.recording) {
    return Promise.reject(
      Object.assign(new Error('Aktif kayıt yok'), {
        code: 'RECORDING_NOT_FOUND'
      })
    )
  }
  const win = session.window
  const pending = new Promise<{ path: string }>((resolve, reject) => {
    const finish = (settle: () => void): void => {
      session.recording = false
      session.pendingRecording = null
      session.stopPromise = null
      settle()
    }
    const timer = setTimeout(() => {
      finish(() => reject(new Error('Kayıt dosyası alınamadı')))
    }, 20_000)
    session.pendingRecording = {
      resolve: (path) => {
        clearTimeout(timer)
        finish(() => resolve({ path }))
      },
      reject: (error) => {
        clearTimeout(timer)
        finish(() => reject(error))
      }
    }
    win.webContents.send('android-mirror:record', 'stop')
  })
  session.stopPromise = pending
  return pending
}

export function getMirrorWindow(deviceId: string): BrowserWindow | null {
  const win = sessions.get(deviceId)?.window
  return win && !win.isDestroyed() ? win : null
}

export function stopScrcpySession(deviceId: string): void {
  const session = sessions.get(deviceId)
  if (!session) {
    throw Object.assign(new Error(`Aktif yansıtma oturumu yok: ${deviceId}`), {
      code: 'SESSION_NOT_FOUND'
    })
  }
  teardown(deviceId, session, 'durduruldu')
}

/** Closes scrcpy windows left behind when a previous Scryno run was force-killed. */
export function killOrphanedScrcpy(): void {
  if (process.platform === 'win32') {
    return
  }
  const child = spawn('pkill', ['-P', '1', '-f', resolveBinary('scrcpy')], {
    stdio: 'ignore'
  })
  child.on('error', () => undefined)
}

export function stopAllSessions(): void {
  for (const [deviceId, session] of Array.from(sessions.entries())) {
    teardown(deviceId, session, 'uygulama kapanıyor')
  }
}
