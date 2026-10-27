import { type ChildProcessByStdio, spawn, execFile } from 'child_process'
import type { Readable } from 'stream'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { resolveBinary } from '../paths'
import { makeCapturePath, makeTempCapturePath } from './capturePaths'
import { isDualRecordingActive } from './dualVideo'

const execFileAsync = promisify(execFile)

interface ActiveRecording {
  process: ChildProcessByStdio<null, Readable, Readable>
  devicePath: string
  startedAt: number
  isDual?: boolean
}

const recordings = new Map<string, ActiveRecording>()

function remoteTempPath(deviceId: string): string {
  const safe = deviceId.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `/data/local/tmp/scryno-${safe}.mp4`
}

export function isRecording(deviceId: string): boolean {
  return recordings.has(deviceId)
}

export function listAdbRecordings(): string[] {
  return Array.from(recordings.keys())
}

/**
 * Records via adb screenrecord while scrcpy mirroring can stay open.
 * Stop pulls the file into Downloads/Scryno.
 */
export function startAdbRecording(deviceId: string, isDual = false): { deviceId: string; startedAt: number } {
  if (!deviceId) {
    throw Object.assign(new Error('Geçersiz cihaz kimliği'), { code: 'INVALID_DEVICE' })
  }
  if (recordings.has(deviceId)) {
    throw Object.assign(new Error('Bu cihaz için zaten kayıt var'), { code: 'RECORDING_EXISTS' })
  }

  const adbPath = resolveBinary('adb')
  const devicePath = remoteTempPath(deviceId)

  let child: ChildProcessByStdio<null, Readable, Readable>
  try {
    child = spawn(
      adbPath,
      ['-s', deviceId, 'shell', 'screenrecord', '--time-limit', '180', devicePath],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error('ADB bulunamadı'), { code: 'ADB_NOT_FOUND' })
    }
    throw Object.assign(new Error(`Kayıt başlatılamadı: ${err.message}`), {
      code: 'RECORD_SPAWN_FAILED'
    })
  }

  const startedAt = Date.now()
  recordings.set(deviceId, {
    process: child,
    devicePath,
    startedAt,
    isDual: isDual || isDualRecordingActive()
  })

  child.on('error', () => {
    recordings.delete(deviceId)
  })

  return { deviceId, startedAt }
}

export async function stopAdbRecording(deviceId: string): Promise<{ path: string }> {
  const active = recordings.get(deviceId)
  if (!active) {
    throw Object.assign(new Error('Aktif kayıt yok'), { code: 'RECORDING_NOT_FOUND' })
  }

  recordings.delete(deviceId)

  if (!active.process.killed && active.process.exitCode === null) {
    active.process.kill('SIGINT')
    await new Promise((resolve) => setTimeout(resolve, 800))
    if (!active.process.killed && active.process.exitCode === null) {
      active.process.kill('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }

  const adbPath = resolveBinary('adb')
  const isDual = active.isDual || isDualRecordingActive()
  const outPath = isDual
    ? makeTempCapturePath('recording-android', 'mp4')
    : makeCapturePath('recording', 'mp4')

  try {
    await execFileAsync(adbPath, ['-s', deviceId, 'pull', active.devicePath, outPath], {
      timeout: 120000,
      maxBuffer: 1024 * 1024
    })
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string }
    throw Object.assign(
      new Error(`Kayıt indirilemedi: ${(err.stderr || err.message || '').trim()}`),
      { code: 'RECORD_PULL_FAILED' }
    )
  } finally {
    try {
      await execFileAsync(adbPath, ['-s', deviceId, 'shell', 'rm', '-f', active.devicePath], {
        timeout: 10000
      })
    } catch {
      // Ignore cleanup failures on device.
    }
  }

  if (!existsSync(outPath)) {
    throw Object.assign(new Error('İndirilen kayıt dosyası bulunamadı'), {
      code: 'RECORD_MISSING'
    })
  }

  return { path: outPath }
}

export function stopAllAdbRecordings(): void {
  for (const deviceId of Array.from(recordings.keys())) {
    const active = recordings.get(deviceId)
    recordings.delete(deviceId)
    if (active && !active.process.killed) {
      active.process.kill('SIGTERM')
    }
  }
}
