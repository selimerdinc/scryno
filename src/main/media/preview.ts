import { execFile } from 'child_process'
import { nativeImage, type NativeImage } from 'electron'
import { readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { getIosFrameHub, isIphoneMirroringSession } from '../ios/mirror'
import { isIphoneMirroringRecording } from '../ios/iphoneMirroring'
import { isDualRecordingActive } from './dualVideo'
import { resolveBinary } from '../paths'
import type { DevicePlatform } from '../../shared/types'

const execFileAsync = promisify(execFile)

const PREVIEW_WIDTH = 168
const DARK_THRESHOLD = 12

export interface DevicePreview {
  image: string | null
  locked: boolean
}

const inflight = new Map<string, Promise<DevicePreview | null>>()

function isDark(image: NativeImage): boolean {
  const bitmap = image.resize({ width: 24 }).toBitmap()
  for (let index = 0; index + 2 < bitmap.length; index += 4) {
    if ((bitmap[index] > DARK_THRESHOLD) || (bitmap[index + 1] > DARK_THRESHOLD) || (bitmap[index + 2] > DARK_THRESHOLD)) {
      return false
    }
  }
  return true
}

function toPreview(input: Buffer): DevicePreview | null {
  const image = nativeImage.createFromBuffer(input)
  if (image.isEmpty()) {
    return null
  }
  if (isDark(image)) {
    return { image: null, locked: true }
  }
  const size = image.getSize()
  const resized =
    size.width > PREVIEW_WIDTH ? image.resize({ width: PREVIEW_WIDTH, quality: 'good' }) : image
  const jpeg = resized.toJPEG(60)
  if (jpeg.length < 32) {
    return null
  }
  return { image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, locked: false }
}

async function captureAndroidPng(deviceId: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    resolveBinary('adb'),
    ['-s', deviceId, 'exec-out', 'screencap', '-p'],
    { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, timeout: 8000 }
  )
  return stdout
}

function tempPng(deviceId: string): string {
  const safe = deviceId.replace(/[^a-zA-Z0-9]/g, '').slice(-16) || 'device'
  return join(tmpdir(), `scryno-preview-${safe}.png`)
}

async function captureWindowPng(deviceId: string): Promise<Buffer> {
  const outPath = tempPng(deviceId)
  try {
    await execFileAsync(resolveBinary('scryno-wincapture'), ['shot', outPath], { timeout: 8000 })
    return readFileSync(outPath)
  } finally {
    rmSync(outPath, { force: true })
  }
}

async function captureOnce(deviceId: string, platform: DevicePlatform): Promise<DevicePreview | null> {
  if (platform === 'ios') {
    const frame = getIosFrameHub(deviceId)?.latestFrame()
    if (frame) {
      return toPreview(frame)
    }
    // A developer screenshot makes the iPhone play the shutter. Only capture the
    // Mac-side iPhone Mirroring window, which is silent.
    if (!isIphoneMirroringSession(deviceId)) {
      return null
    }
    // Never run scryno-wincapture shot while an active recording is in progress,
    // as concurrent ScreenCaptureKit requests interrupt the ongoing recording stream.
    if (isIphoneMirroringRecording(deviceId) || isDualRecordingActive()) {
      return null
    }
    return toPreview(await captureWindowPng(deviceId))
  }
  return toPreview(await captureAndroidPng(deviceId))
}

/** Small JPEG data URL of the device screen. Never writes to Downloads or the clipboard. */
export function captureDevicePreview(
  deviceId: string,
  platform: DevicePlatform
): Promise<DevicePreview | null> {
  const pending = inflight.get(deviceId)
  if (pending) {
    return pending
  }
  const job = captureOnce(deviceId, platform)
    .catch(() => null)
    .finally(() => {
      inflight.delete(deviceId)
    })
  inflight.set(deviceId, job)
  return job
}
