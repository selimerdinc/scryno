import { ChildProcessWithoutNullStreams, execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { makeCapturePath } from '../media/capturePaths'
import { resolveBinary } from '../paths'
import { enlargeIphoneMirroringWindow, findMirrorWindowBounds } from '../ui/mirrorWindowBounds'

const execFileAsync = promisify(execFile)

export const IPHONE_MIRRORING_NEEDLE = '@iphone-mirroring'
const APP_NAME = 'iPhone Mirroring'
const APP_PATH = '/System/Applications/iPhone Mirroring.app'
const WINDOW_WAIT_MS = 15000

interface ActiveWindowRecording {
  process: ChildProcessWithoutNullStreams
  outPath: string
  exited: Promise<void>
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

export async function captureIphoneMirroringScreenshot(): Promise<{ path: string }> {
  const outPath = makeCapturePath('screenshot', 'png')
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

export function isIphoneMirroringRecording(deviceId: string): boolean {
  return recordings.has(deviceId)
}

export function startIphoneMirroringRecording(deviceId: string): { path: string } {
  if (recordings.has(deviceId)) {
    throw Object.assign(new Error('Bu cihaz için zaten kayıt var'), { code: 'RECORDING_EXISTS' })
  }
  const outPath = makeCapturePath('recording', 'mp4')
  const child = spawn(captureHelper(), ['record', outPath], { stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    child.once('error', () => resolve())
  })
  child.once('exit', () => {
    if (recordings.get(deviceId)?.process === child) {
      recordings.delete(deviceId)
    }
  })
  recordings.set(deviceId, { process: child, outPath, exited })
  return { path: outPath }
}

export async function stopIphoneMirroringRecording(deviceId: string): Promise<{ path: string }> {
  const active = recordings.get(deviceId)
  if (!active) {
    throw Object.assign(new Error('Aktif kayıt yok'), { code: 'RECORDING_NOT_FOUND' })
  }
  recordings.delete(deviceId)
  if (active.process.exitCode === null) {
    active.process.kill('SIGINT')
  }
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10000))
  await Promise.race([active.exited, timeout])
  if (active.process.exitCode === null) {
    active.process.kill('SIGTERM')
  }
  if (!existsSync(active.outPath)) {
    throw Object.assign(new Error('Kayıt dosyası oluşmadı (Ekran Kaydı izni gerekli olabilir)'), {
      code: 'RECORD_MISSING'
    })
  }
  return { path: active.outPath }
}
