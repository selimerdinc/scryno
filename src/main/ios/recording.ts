import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { existsSync } from 'fs'
import { makeCapturePath, makeTempCapturePath } from '../media/capturePaths'
import { isDualRecordingActive } from '../media/dualVideo'
import { iosToolEnv, resolveIdeviceBinary } from './binaries'
import type { IosFrameHub } from './frameHub'

interface ActiveIosRecording {
  process: ChildProcessWithoutNullStreams
  outPath: string
  unsubscribe: () => void
  exited: Promise<void>
}

const MAX_ENCODER_BACKLOG = 8 * 1024 * 1024
const recordings = new Map<string, ActiveIosRecording>()

export function isIosRecording(deviceId: string): boolean {
  return recordings.has(deviceId)
}

export function listIosRecordings(): string[] {
  return Array.from(recordings.keys())
}

export function startIosRecording(
  deviceId: string,
  hub: IosFrameHub,
  isDual = false
): { path: string } {
  if (recordings.has(deviceId)) {
    throw Object.assign(new Error('Bu cihaz için zaten kayıt var'), { code: 'RECORDING_EXISTS' })
  }

  const ffmpeg = resolveIdeviceBinary('ffmpeg')
  if (ffmpeg === 'ffmpeg') {
    throw Object.assign(new Error('iOS kaydı için ffmpeg gerekli (brew install ffmpeg).'), {
      code: 'FFMPEG_NOT_FOUND'
    })
  }

  const outPath = isDual || isDualRecordingActive()
    ? makeTempCapturePath('recording-ios', 'mp4')
    : makeCapturePath('recording', 'mp4')
  const child = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-use_wallclock_as_timestamps',
      '1',
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
      '-i',
      '-',
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-fps_mode',
      'vfr',
      '-movflags',
      '+faststart',
      outPath
    ],
    { env: iosToolEnv(), stdio: ['pipe', 'pipe', 'pipe'] }
  )

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    child.once('error', () => resolve())
  })
  child.stdin.on('error', () => undefined)

  const unsubscribe = hub.onFrame((frame) => {
    if (child.stdin.writable && (child.stdin.writableLength < MAX_ENCODER_BACKLOG)) {
      child.stdin.write(frame)
    }
  })

  recordings.set(deviceId, { process: child, outPath, unsubscribe, exited })
  hub.onClose(() => {
    void stopIosRecording(deviceId).catch(() => undefined)
  })
  return { path: outPath }
}

export async function stopIosRecording(deviceId: string): Promise<{ path: string }> {
  const active = recordings.get(deviceId)
  if (!active) {
    throw Object.assign(new Error('Aktif kayıt yok'), { code: 'RECORDING_NOT_FOUND' })
  }
  recordings.delete(deviceId)
  active.unsubscribe()
  active.process.stdin.end()

  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 15000))
  await Promise.race([active.exited, timeout])
  if (active.process.exitCode === null) {
    active.process.kill('SIGTERM')
  }

  if (!existsSync(active.outPath)) {
    throw Object.assign(new Error('Kayıt dosyası oluşmadı'), { code: 'RECORD_MISSING' })
  }
  return { path: active.outPath }
}
