import { execFile } from 'child_process'
import { existsSync, statSync, writeFileSync } from 'fs'
import { promisify } from 'util'
import { iosToolEnv, resolveIdeviceBinary } from '../ios/binaries'
import { captureIosScreenshot } from '../ios/goios'
import { resolveBinary } from '../paths'
import { makeCapturePath } from './capturePaths'

const execFileAsync = promisify(execFile)

export async function takeAndroidScreenshot(deviceId: string): Promise<{ path: string }> {
  if (!deviceId) {
    throw Object.assign(new Error('Geçersiz cihaz kimliği'), { code: 'INVALID_DEVICE' })
  }

  const adbPath = resolveBinary('adb')
  const outPath = makeCapturePath('screenshot', 'png')

  try {
    const { stdout } = await execFileAsync(adbPath, ['-s', deviceId, 'exec-out', 'screencap', '-p'], {
      encoding: 'buffer',
      maxBuffer: 40 * 1024 * 1024,
      timeout: 30000
    })
    writeFileSync(outPath, stdout)
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: Buffer | string }
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error('ADB bulunamadı'), { code: 'ADB_NOT_FOUND' })
    }
    const stderr =
      typeof err.stderr === 'string'
        ? err.stderr
        : err.stderr
          ? err.stderr.toString('utf8')
          : err.message
    throw Object.assign(new Error(`Screenshot alınamadı: ${stderr.trim()}`), {
      code: 'SCREENSHOT_FAILED'
    })
  }

  if (!existsSync(outPath) || statSync(outPath).size < 32) {
    throw Object.assign(new Error('Screenshot dosyası boş veya geçersiz'), {
      code: 'SCREENSHOT_EMPTY'
    })
  }

  return { path: outPath }
}

/**
 * iOS screenshot via libimobiledevice. Requires a mounted Developer Disk Image
 * on the device (Xcode pairing / developer mode) — otherwise screenshotr is unavailable.
 */
export async function takeIosScreenshot(udid: string): Promise<{ path: string }> {
  if (!udid) {
    throw Object.assign(new Error('Geçersiz cihaz kimliği'), { code: 'INVALID_DEVICE' })
  }

  if (process.platform !== 'darwin') {
    throw Object.assign(new Error('iOS screenshot yalnızca macOS’ta destekleniyor'), {
      code: 'IOS_SCREENSHOT_UNSUPPORTED_HOST'
    })
  }

  const outPath = makeCapturePath('screenshot', 'png')

  try {
    await captureIosScreenshot(udid, outPath)
    if (existsSync(outPath) && statSync(outPath).size >= 32) {
      return { path: outPath }
    }
  } catch {
    // Fall through to idevicescreenshot (older iOS / mounted DDI).
  }

  try {
    await execFileAsync(resolveIdeviceBinary('idevicescreenshot'), ['-u', udid, outPath], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: iosToolEnv()
    })
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
    if (err.code === 'ENOENT') {
      throw Object.assign(
        new Error(
          'idevicescreenshot yok. `brew install libimobiledevice` ve cihazda Developer Disk Image gerekir.'
        ),
        { code: 'IDEVICESCREENSHOT_NOT_FOUND' }
      )
    }

    const detail = (err.stderr || err.stdout || err.message || '').trim()
    throw Object.assign(
      new Error(
        `iOS screenshot başarısız: ${detail || 'screenshotr servisi yok (Developer Disk Image?).'}`
      ),
      { code: 'IOS_SCREENSHOT_FAILED' }
    )
  }

  if (!existsSync(outPath) || statSync(outPath).size < 32) {
    throw Object.assign(new Error('iOS screenshot dosyası boş veya geçersiz'), {
      code: 'SCREENSHOT_EMPTY'
    })
  }

  return { path: outPath }
}
