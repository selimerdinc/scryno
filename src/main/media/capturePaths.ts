import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

/** Save captures under the user Downloads folder (İndirilenler). */
export function getCaptureDir(): string {
  const dir = join(app.getPath('downloads'), 'Scryno')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function makeCaptureFilename(kind: 'screenshot' | 'recording', extension: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  return `scryno-${kind}-${stamp}.${extension}`
}

export function makeCapturePath(kind: 'screenshot' | 'recording', extension: string): string {
  return join(getCaptureDir(), makeCaptureFilename(kind, extension))
}
