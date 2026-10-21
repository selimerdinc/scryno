import { app, BrowserWindow } from 'electron'
import { createServer } from 'net'
import { join } from 'path'
import type { MirrorSessionInfo } from '../../shared/types'
import { startIosFrameHub, type IosFrameHub } from './frameHub'
import { findMirrorWindowBounds } from '../ui/mirrorWindowBounds'
import { closeMirrorToolbar, showMirrorToolbar } from '../ui/mirrorToolbar'
import { spawnIosStream, stopIosTunnel, tunnelForDevice } from './goios'
import { IPHONE_MIRRORING_NEEDLE, openIphoneMirroring, quitIphoneMirroring } from './iphoneMirroring'

// window/hub are null for iPhone Mirroring sessions (macOS draws the phone; Scryno docks its bar).
interface IosMirrorSession {
  info: MirrorSessionInfo
  hub: IosFrameHub | null
  window: BrowserWindow | null
  stopStream: () => void | Promise<void>
}

const sessions = new Map<string, IosMirrorSession>()
const autoRestoreLabels = new Map<string, string>()
let autoRestoreTimer: ReturnType<typeof setInterval> | null = null
let autoRestoreBusy = false

function mirrorPageUrl(port: number, label: string, deviceId: string): string {
  const query = new URLSearchParams({
    port: String(port),
    label,
    deviceId
  }).toString()
  if (!app?.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/ios-mirror.html?${query}`
  }
  return `file://${join(__dirname, '../renderer/ios-mirror.html')}?${query}`
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function waitForStreamReady(
  child: ReturnType<typeof spawnIosStream>,
  timeoutMs: number,
  requestedPort: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    let log = ''
    const timer = setTimeout(() => {
      reject(
        Object.assign(new Error(`iOS akış başlamadı: ${log.trim().slice(-400)}`), {
          code: 'IOS_STREAM_TIMEOUT'
        })
      )
    }, timeoutMs)

    const onData = (chunk: Buffer): void => {
      log += chunk.toString('utf8')
      if (log.includes('starting server')) {
        clearTimeout(timer)
        // This go-ios build ignores --port and reports the port it actually bound.
        const match = log.match(/"port":"(\d+)"/)
        resolve(match ? Number(match[1]) : requestedPort)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(
        Object.assign(new Error(`iOS akış kapandı (${code ?? '?'}): ${log.trim().slice(-400)}`), {
          code: 'IOS_STREAM_EXIT'
        })
      )
    })
  })
}

export function getIosFrameHub(deviceId: string): IosFrameHub | null {
  return sessions.get(deviceId)?.hub ?? null
}

export function listIosMirrorSessions(): MirrorSessionInfo[] {
  return Array.from(sessions.values()).map((session) => session.info)
}

export function isIosMirroring(deviceId: string): boolean {
  return sessions.has(deviceId)
}

export function isIphoneMirroringSession(deviceId: string): boolean {
  const session = sessions.get(deviceId)
  return Boolean(session && !session.window)
}

export async function startIosMirror(deviceId: string, label?: string): Promise<MirrorSessionInfo> {
  const existing = sessions.get(deviceId)
  if (existing) {
    if (existing.window && !existing.window.isDestroyed()) {
      existing.window.focus()
      return existing.info
    }
    if (!existing.window) {
      await openIphoneMirroring()
      return existing.info
    }
    stopIosMirror(deviceId)
  }

  if (process.platform !== 'darwin') {
    throw Object.assign(new Error('iOS yansıtma yalnızca macOS’ta'), {
      code: 'IOS_MIRROR_UNSUPPORTED_HOST'
    })
  }

  const title = label?.trim() || 'iPhone'
  if (await openIphoneMirroring()) {
    const info: MirrorSessionInfo = { deviceId, pid: 0, startedAt: Date.now() }
    const stopStream = (): Promise<void> => {
      closeMirrorToolbar(deviceId)
      return quitIphoneMirroring()
    }
    sessions.set(deviceId, { info, hub: null, window: null, stopStream })
    showMirrorToolbar(deviceId, {
      label: title,
      platform: 'ios',
      windowNeedle: IPHONE_MIRRORING_NEEDLE,
      dockAbove: true
    })
    return info
  }

  return startStreamMirror(deviceId, title)
}

// Fallback when iPhone Mirroring is unavailable: go-ios screenshot stream in a Scryno window.
async function startStreamMirror(deviceId: string, title: string): Promise<MirrorSessionInfo> {
  const tunnel = await tunnelForDevice(deviceId)
  const requestedPort = await freePort()
  const child = spawnIosStream(deviceId, tunnel, requestedPort)

  let port = requestedPort
  try {
    port = await waitForStreamReady(child, 20000, requestedPort)
  } catch (error) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
    throw error
  }

  const win = new BrowserWindow({
    width: 420,
    height: 900,
    minWidth: 320,
    minHeight: 560,
    title: `Scryno — ${title}`,
    backgroundColor: '#0c0f14',
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const info: MirrorSessionInfo = {
    deviceId,
    pid: child.pid ?? 0,
    startedAt: Date.now()
  }

  const hub = await startIosFrameHub(port)

  const stopStream = (): void => {
    hub.close()
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM')
    }
  }

  sessions.set(deviceId, { info, hub, window: win, stopStream })

  win.on('closed', () => {
    const current = sessions.get(deviceId)
    if (current?.window === win) {
      current.stopStream()
      sessions.delete(deviceId)
    }
  })

  child.on('exit', () => {
    const current = sessions.get(deviceId)
    if (current?.window && !current.window.isDestroyed()) {
      current.window.close()
    }
  })

  await win.loadURL(mirrorPageUrl(hub.port, title, deviceId))
  win.show()
  return info
}

export async function restoreIosMirror(deviceId: string, label?: string): Promise<{ message: string }> {
  const opened = await openIphoneMirroring()
  if (!opened) {
    throw Object.assign(
      new Error('iPhone Mirroring penceresi açılmadı. Kurulumdaki izinleri kontrol et.'),
      { code: 'IOS_RESTORE_FAILED' }
    )
  }

  const title = label?.trim() || 'iPhone'
  if (!sessions.has(deviceId)) {
    sessions.set(deviceId, {
      info: { deviceId, pid: 0, startedAt: Date.now() },
      hub: null,
      window: null,
      stopStream: () => {
        closeMirrorToolbar(deviceId)
        return quitIphoneMirroring()
      }
    })
  }

  closeMirrorToolbar(deviceId)
  showMirrorToolbar(deviceId, {
    label: title,
    platform: 'ios',
    windowNeedle: IPHONE_MIRRORING_NEEDLE,
    dockAbove: true
  })
  return { message: 'iPhone penceresi geri getirildi.' }
}

export function stopIosMirror(deviceId: string): Promise<void> {
  const session = sessions.get(deviceId)
  if (!session) {
    return Promise.resolve()
  }
  sessions.delete(deviceId)
  const stopped = session.stopStream()
  if (session.window && !session.window.isDestroyed()) {
    session.window.close()
  }
  return Promise.resolve(stopped)
}

export function setIosAutoRestore(deviceId: string, label: string, enabled: boolean): void {
  if (!deviceId) {
    return
  }
  if (enabled) {
    autoRestoreLabels.set(deviceId, label.trim() || 'iPhone')
  } else {
    autoRestoreLabels.delete(deviceId)
  }
  if (autoRestoreLabels.size === 0) {
    if (autoRestoreTimer) {
      clearInterval(autoRestoreTimer)
      autoRestoreTimer = null
    }
    return
  }
  if (autoRestoreTimer) {
    return
  }
  autoRestoreTimer = setInterval(() => {
    void restoreMissingIphoneWindows()
  }, 4000)
}

async function restoreMissingIphoneWindows(): Promise<void> {
  if (autoRestoreBusy) {
    return
  }
  autoRestoreBusy = true
  try {
    for (const [deviceId, label] of autoRestoreLabels) {
      if (!isIphoneMirroringSession(deviceId)) {
        continue
      }
      const bounds = await findMirrorWindowBounds(IPHONE_MIRRORING_NEEDLE)
      if (!isIphoneMirroringSession(deviceId) || bounds) {
        continue
      }
      await restoreIosMirror(deviceId, label)
    }
  } catch {
    // The next poll retries if iPhone Mirroring is still missing.
  } finally {
    autoRestoreBusy = false
  }
}

export function stopAllIosMirrors(): Promise<void> {
  const pending = Array.from(sessions.keys()).map((deviceId) => stopIosMirror(deviceId))
  stopIosTunnel()
  return Promise.all(pending).then(() => undefined)
}
