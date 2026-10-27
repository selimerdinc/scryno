import { type ChildProcessByStdio, execFile, spawn } from 'child_process'
import type { Readable } from 'stream'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { makeCapturePath, makeTempCapturePath } from '../media/capturePaths'
import { isDualRecordingActive } from '../media/dualVideo'
import { resolveBinary } from '../paths'
import { enlargeIphoneMirroringWindow, findMirrorWindowBounds, isOtherAppFullscreen } from '../ui/mirrorWindowBounds'

const execFileAsync = promisify(execFile)

export const IPHONE_MIRRORING_NEEDLE = '@iphone-mirroring'
const APP_NAME = 'iPhone Mirroring'
const APP_PATH = '/System/Applications/iPhone Mirroring.app'
const WINDOW_WAIT_MS = 15000

interface ActiveWindowRecording {
  process: ChildProcessByStdio<null, Readable, Readable>
  outPath: string
  exited: Promise<void>
  getStderr?: () => string
}

const recordings = new Map<string, ActiveWindowRecording>()

function captureHelper(): string {
  const helper = resolveBinary('scryno-wincapture')
  if (helper === 'scryno-wincapture') {
    throw Object.assign(new Error('scryno-wincapture yardımcısı bulunamadı'), {
      code: 'WINCAPTURE_NOT_FOUND'
    })
  }
  return helper
}

export function isIphoneMirroringAvailable(): boolean {
  return (process.platform === 'darwin') && existsSync(APP_PATH)
}

/** Opens macOS iPhone Mirroring and waits until its window is on screen. */
export async function openIphoneMirroring(): Promise<boolean> {
  if (!isIphoneMirroringAvailable()) {
    return false
  }
  await execFileAsync('open', ['-a', APP_NAME], { timeout: 10000 })
  const deadline = Date.now() + WINDOW_WAIT_MS
  while (Date.now() < deadline) {
    if (await findMirrorWindowBounds(IPHONE_MIRRORING_NEEDLE)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return false
}

/** Brings the macOS iPhone Mirroring window to the front. */
export async function activateIphoneMirroring(): Promise<void> {
  if (!isIphoneMirroringAvailable()) {
    return
  }
  if (await isOtherAppFullscreen()) {
    return
  }
  try {
    await execFileAsync('osascript', ['-e', `tell application "${APP_NAME}" to activate`], {
      timeout: 3000
    })
  } catch {
    // Ignore error if app is closed or not responding
  }
}

export async function enlargeIphoneMirroring(): Promise<{ message: string }> {
  const before = await findMirrorWindowBounds(IPHONE_MIRRORING_NEEDLE)
  if (!before) {
    throw Object.assign(new Error('iPhone penceresi yok. Önce Yansıt’a bas.'), {
      code: 'IOS_WINDOW_MISSING'
    })
  }
  const after = await enlargeIphoneMirroringWindow()
  if (!after) {
    throw Object.assign(
      new Error('Pencere büyütülemedi. Erişilebilirlik izni gerekebilir.'),
      { code: 'IOS_ENLARGE_FAILED' }
    )
  }
  if (after.height <= before.height + 8 && after.width <= before.width + 8) {
    return { message: 'Pencere zaten en büyük boyutta.' }
  }
  return { message: 'iPhone penceresi büyütüldü.' }
}

export async function quitIphoneMirroring(): Promise<void> {
  try {
    await execFileAsync('osascript', ['-e', `quit app "${APP_NAME}"`], { timeout: 5000 })
  } catch {
    // Already closed.
  }
}

export async function captureIphoneMirroringScreenshot(customPath?: string): Promise<{ path: string }> {
  const outPath = customPath ?? makeCapturePath('screenshot', 'png')
  try {
    await execFileAsync(captureHelper(), ['shot', outPath], { timeout: 15000 })
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string }
    throw Object.assign(
      new Error(
        `Screenshot alınamadı: ${(err.stderr || err.message || '').trim()} (Ekran Kaydı izni gerekli olabilir)`
      ),
      { code: 'IOS_SCREENSHOT_FAILED' }
    )
  }
  if (!existsSync(outPath)) {
    throw Object.assign(new Error('Screenshot dosyası oluşmadı'), { code: 'IOS_SCREENSHOT_FAILED' })
  }
  return { path: outPath }
}

export function isIphoneMirroringRecording(deviceId?: string): boolean {
  if (deviceId) {
    return recordings.has(deviceId) || (deviceId === '@iphone-mirroring' && recordings.size > 0)
  }
  return recordings.size > 0
}

export function listIphoneMirroringRecordings(): string[] {
  return Array.from(recordings.keys())
}

export function startIphoneMirroringRecording(deviceId: string, isDual = false): { path: string } {
  // If an old dead process is still in the map, clean it up
  const existing = recordings.get(deviceId)
  if (existing && existing.process.exitCode === null) {
    throw Object.assign(new Error('iPhone için zaten kayıt devam ediyor'), { code: 'RECORDING_EXISTS' })
  }
  // Stop (rather than orphan) any capture process still tracked under another key.
  for (const stale of recordings.values()) {
    if (stale.process.exitCode === null) {
      stale.process.kill('SIGINT')
    }
  }
  recordings.clear()

  const outPath = (isDual || isDualRecordingActive())
    ? makeTempCapturePath('recording-ios', 'mp4')
    : makeCapturePath('recording', 'mp4')
  const child = spawn(captureHelper(), ['record', outPath], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderrText = ''
  child.stderr.on('data', (d) => {
    stderrText += d.toString()
    console.error(`[iPhoneRecord stderr] ${d.toString().trim()}`)
  })
  child.stdout.on('data', (d) => {
    console.log(`[iPhoneRecord stdout] ${d.toString().trim()}`)
  })

  const exited = new Promise<void>((resolve) => {
    child.once('exit', (code, sig) => {
      console.log(`[iPhoneRecord exit] code=${code}, sig=${sig}`)
      resolve()
    })
    child.once('error', (err) => {
      console.error(`[iPhoneRecord error]`, err)
      resolve()
    })
  })

  recordings.set(deviceId, {
    process: child,
    outPath,
    exited,
    getStderr: () => stderrText
  })
  return { path: outPath }
}

export async function stopIphoneMirroringRecording(deviceId?: string): Promise<{ path: string }> {
  let targetKey = deviceId
  let active = deviceId ? recordings.get(deviceId) : undefined
  if (!active && recordings.size > 0) {
    const firstEntry = Array.from(recordings.entries())[0]
    targetKey = firstEntry[0]
    active = firstEntry[1]
  }
  if (!active || !targetKey) {
    throw Object.assign(new Error('Aktif iPhone kaydı bulunamadı'), { code: 'RECORDING_NOT_FOUND' })
  }

  try {
    if (active.process.exitCode === null) {
      active.process.kill('SIGINT')
    }
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000))
    await Promise.race([active.exited, timeout])
    if (active.process.exitCode === null) {
      console.warn('[iPhoneRecord] Process did not exit within 8s timeout, sending SIGTERM')
      active.process.kill('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (!existsSync(active.outPath)) {
      const errDetail = active.getStderr ? active.getStderr() : ''
      throw Object.assign(
        new Error(`iPhone kayıt dosyası oluşmadı: ${errDetail || 'Ekran Kaydı izni gerekli olabilir'}`),
        { code: 'RECORD_MISSING' }
      )
    }
    return { path: active.outPath }
  } finally {
    recordings.delete(targetKey)
  }
}
