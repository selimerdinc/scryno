import { execFile } from 'child_process'
import { readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { listSessions, captureAndroidMirrorScreenshot } from '../android/scrcpySession'
import { isIphoneMirroringSession } from '../ios/mirror'
import { captureIphoneMirroringScreenshot } from '../ios/iphoneMirroring'
import { resolveBinary } from '../paths'
import { copyImageFileToClipboard } from './clipboardImage'
import { makeCapturePath } from './capturePaths'
import { takeIosScreenshot } from './screenshot'
import type { CaptureFileResult, DualScreenshotRawResponse } from '../../shared/types'

const execFileAsync = promisify(execFile)

/**
 * Captures raw screenshot buffers from both an Android and an iOS device
 * without leaving orphan files on the user's Downloads directory.
 */
export async function captureDualRawSources(
  androidId?: string,
  iosId?: string,
  androidName: string = 'Android',
  iosName: string = 'iPhone'
): Promise<DualScreenshotRawResponse> {
  const adbPath = resolveBinary('adb')
  let resolvedAndroid = androidId
  if (!resolvedAndroid || resolvedAndroid === 'android') {
    const s = listSessions()
    if (s.length > 0) {
      resolvedAndroid = s[0].deviceId
    } else {
      try {
        const { stdout } = await execFileAsync(adbPath, ['devices'], { timeout: 3000 })
        const match = stdout.split('\n').find((line) => line.includes('\tdevice'))
        if (match) {
          resolvedAndroid = match.split('\t')[0].trim()
        }
      } catch {
        // ignore
      }
    }
  }

  if (!resolvedAndroid) {
    return {
      ok: false,
      code: 'ANDROID_NOT_FOUND',
      message: 'Bağlı bir Android cihaz bulunamadı'
    }
  }

  const isIphoneMirror =
    !iosId ||
    iosId === '@iphone-mirroring' ||
    iosId === 'ios' ||
    isIphoneMirroringSession(iosId) ||
    iosId.toLowerCase().includes('iphone')

  const tempIosPath = join(tmpdir(), `scryno-dual-ios-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)

  try {
    const [androidBuf, iosBuf] = await Promise.all([
      (async (): Promise<Buffer> => {
        const mirrorBuf = await captureAndroidMirrorScreenshot(resolvedAndroid)
        if (mirrorBuf && mirrorBuf.length > 32) {
          return mirrorBuf
        }
        const { stdout } = await execFileAsync(adbPath, ['-s', resolvedAndroid, 'exec-out', 'screencap', '-p'], {
          encoding: 'buffer',
          maxBuffer: 40 * 1024 * 1024,
          timeout: 30000
        })
        return stdout as Buffer
      })(),
      (async (): Promise<Buffer> => {
        try {
          if (isIphoneMirror) {
            await captureIphoneMirroringScreenshot(tempIosPath)
          } else {
            await takeIosScreenshot(iosId!, tempIosPath)
          }
          return readFileSync(tempIosPath)
        } finally {
          rmSync(tempIosPath, { force: true })
        }
      })()
    ])
    if (!androidBuf || androidBuf.length < 32) {
      return {
        ok: false,
        code: 'ANDROID_CAPTURE_EMPTY',
        message: 'Android ekran görüntüsü alınamadı veya boş döndü'
      }
    }

    if (!iosBuf || iosBuf.length < 32) {
      return {
        ok: false,
        code: 'IOS_CAPTURE_EMPTY',
        message: 'iPhone ekran görüntüsü alınamadı veya boş döndü'
      }
    }

    let finalAndroidName = androidName
    try {
      const [modelRes, osRes] = await Promise.all([
        execFileAsync(adbPath, ['-s', resolvedAndroid, 'shell', 'getprop', 'ro.product.model'], { timeout: 2000 }).catch(() => ({ stdout: '' })),
        execFileAsync(adbPath, ['-s', resolvedAndroid, 'shell', 'getprop', 'ro.build.version.release'], { timeout: 2000 }).catch(() => ({ stdout: '' }))
      ])
      const m = modelRes.stdout.trim()
      const o = osRes.stdout.trim()
      if (m && o) {
        finalAndroidName = `${m} · Android ${o}`
      } else if (m) {
        finalAndroidName = `${m} · Android`
      } else if (o) {
        finalAndroidName = `Android ${o}`
      }
    } catch {
      // ignore
    }

    let finalIosName = iosName
    if (!finalIosName || finalIosName === 'iPhone' || finalIosName === '@iphone-mirroring' || finalIosName === 'ios') {
      finalIosName = 'Apple iPhone · iOS'
    }

    return {
      ok: true,
      androidImage: `data:image/png;base64,${androidBuf.toString('base64')}`,
      iosImage: `data:image/png;base64,${iosBuf.toString('base64')}`,
      androidName: finalAndroidName,
      iosName: finalIosName
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: Buffer | string }
    const detail = (typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf8') || err.message || '').trim()
    return {
      ok: false,
      code: 'DUAL_CAPTURE_FAILED',
      message: `Ekran görüntüsü alınamadı: ${detail || 'Bilinmeyen hata'}`
    }
  }
}

/**
 * Saves the composited dual screenshot image into Downloads/Scryno,
 * automatically copies it to the system clipboard, and returns path info.
 */
export async function saveDualScreenshot(data: Uint8Array): Promise<CaptureFileResult> {
  const outPath = makeCapturePath('dual-screenshot', 'png')
  writeFileSync(outPath, Buffer.from(data))
  const copiedToClipboard = copyImageFileToClipboard(outPath)
  console.log(`[DualCapture] Saved composited dual screenshot: ${outPath} (${data.length} bytes)`)

  return {
    ok: true,
    path: outPath,
    message: copiedToClipboard
      ? 'Yan yana ekran görüntüsü kaydedildi ve panoya kopyalandı'
      : 'Yan yana ekran görüntüsü kaydedildi',
    copiedToClipboard
  }
}
