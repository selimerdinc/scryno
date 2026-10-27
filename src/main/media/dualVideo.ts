import { execFile } from 'child_process'
import { copyFileSync, existsSync, renameSync, rmSync, statSync } from 'fs'
import { basename, join } from 'path'
import { promisify } from 'util'
import { getCaptureDir, makeCapturePath } from './capturePaths'
import { resolveBinary } from '../paths'
import type { CaptureFileResult } from '../../shared/types'

const execFileAsync = promisify(execFile)

interface ActiveDualSession {
  androidId: string
  iosId: string
  startedAt: number
}

let activeDualSession: ActiveDualSession | null = null

export function isDualRecordingActive(): boolean {
  return activeDualSession !== null
}

export function setDualRecordingActive(androidId: string, iosId: string): void {
  activeDualSession = { androidId, iosId, startedAt: Date.now() }
}

export function clearDualRecordingActive(): void {
  activeDualSession = null
}

function resolveFfmpeg(): string {
  // Bundled binary first, then /opt/homebrew/bin, /usr/local/bin, /usr/bin, PATH.
  return resolveBinary('ffmpeg')
}

/**
 * Moves temp dual-recording sources into the capture folder so a failed merge
 * never loses footage. Files already outside the temp folder are left alone.
 */
export function preserveDualSources(paths: Array<string | undefined>): string[] {
  const saved: string[] = []
  for (const source of paths) {
    if (!source || !existsSync(source)) {
      continue
    }
    const name = basename(source)
    if (!name.startsWith('temp-')) {
      saved.push(source)
      continue
    }
    const target = join(getCaptureDir(), `scryno-${name.slice('temp-'.length)}`)
    try {
      renameSync(source, target)
      saved.push(target)
    } catch {
      try {
        copyFileSync(source, target)
        rmSync(source, { force: true })
        saved.push(target)
      } catch (error) {
        console.error('[DualVideo] Could not preserve source:', source, error)
      }
    }
  }
  return saved
}

/**
 * Merges an Android video and an iOS video into a single side-by-side MP4 video
 * using hardware acceleration (h264_videotoolbox on macOS) for blazing fast output.
 */
export async function mergeDualVideos(
  androidVideoPath: string,
  iosVideoPath: string
): Promise<CaptureFileResult> {
  if (!existsSync(androidVideoPath) || !existsSync(iosVideoPath)) {
    throw new Error('Birleştirilecek kaynak video dosyaları bulunamadı')
  }

  const aStat = statSync(androidVideoPath)
  const iStat = statSync(iosVideoPath)
  console.log(`[DualVideo] Source sizes: Android=${aStat.size} bytes, iOS=${iStat.size} bytes`)

  const outPath = makeCapturePath('dual-recording', 'mp4')
  const ffmpegPath = resolveFfmpeg()
  const filter =
    '[0:v]scale=-2:1080[v0];[1:v]scale=-2:1080[v1];[v0]pad=iw+24:ih:0:0:color=0x07080c[v0p];[v0p][v1]hstack=inputs=2:shortest=0[v]'

  const cleanupSources = (): void => {
    try {
      rmSync(androidVideoPath, { force: true })
    } catch {
      // ignore
    }
    try {
      rmSync(iosVideoPath, { force: true })
    } catch {
      // ignore
    }
  }

  // 1. Try hardware-accelerated VideoToolbox encoder on Apple Silicon (blazing fast, ~0.5s - 1.5s)
  try {
    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-i',
        androidVideoPath,
        '-i',
        iosVideoPath,
        '-filter_complex',
        filter,
        '-map',
        '[v]',
        '-c:v',
        'h264_videotoolbox',
        '-b:v',
        '8M',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outPath
      ],
      { timeout: 60000 }
    )

    if (existsSync(outPath)) {
      cleanupSources()
      return {
        ok: true,
        path: outPath,
        message: `Yan yana tek video kaydedildi: ${outPath}`,
        stopped: true
      }
    }
  } catch (hwError) {
    console.warn('[DualVideo] Hardware encoder failed or unavailable, falling back to ultrafast CPU:', hwError)
  }

  // 2. Fallback to libx264 with ultrafast preset
  try {
    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-i',
        androidVideoPath,
        '-i',
        iosVideoPath,
        '-filter_complex',
        filter,
        '-map',
        '[v]',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outPath
      ],
      { timeout: 60000 }
    )

    if (existsSync(outPath)) {
      cleanupSources()
      return {
        ok: true,
        path: outPath,
        message: `Yan yana tek video kaydedildi: ${outPath}`,
        stopped: true
      }
    }
  } catch (err) {
    // Sources are intentionally kept; callers decide where they end up.
    rmSync(outPath, { force: true })
    const error = err as Error
    throw new Error(`Video birleştirme başarısız: ${error.message}`)
  }

  throw new Error('Birleşik video dosyası oluşturulamadı')
}
