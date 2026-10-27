import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { resolveBinary } from '../paths'

const execFileAsync = promisify(execFile)

export interface MirrorWindowBounds {
  x: number
  y: number
  width: number
  height: number
  owner?: string
  name?: string
  onScreen?: boolean
}

export async function isOtherAppFullscreen(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false
  }

  const helper = resolveBinary('scryno-winbounds')
  if (!existsSync(helper) && helper === 'scryno-winbounds') {
    return false
  }

  try {
    const { stdout } = await execFileAsync(helper, ['is-fullscreen'], {
      timeout: 800,
      maxBuffer: 64 * 1024
    })
    const line = stdout.trim()
    if (!line || line === '{}') {
      return false
    }
    const parsed = JSON.parse(line) as { fullscreen?: boolean }
    return parsed.fullscreen === true
  } catch {
    return false
  }
}

export async function findMirrorWindowBounds(deviceId: string): Promise<MirrorWindowBounds | null> {
  if (process.platform !== 'darwin') {
    return null
  }

  const helper = resolveBinary('scryno-winbounds')
  if (!existsSync(helper) && helper === 'scryno-winbounds') {
    return null
  }

  try {
    const { stdout } = await execFileAsync(helper, [deviceId], {
      timeout: 800,
      maxBuffer: 64 * 1024
    })
    const line = stdout.trim()
    if (!line || line === '{}') {
      return null
    }
    const parsed = JSON.parse(line) as Partial<MirrorWindowBounds>
    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number'
    ) {
      return null
    }
    return {
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
      owner: parsed.owner,
      name: parsed.name,
      onScreen: parsed.onScreen
    }
  } catch {
    return null
  }
}

function parseBounds(stdout: string): MirrorWindowBounds | null {
  const line = stdout
    .trim()
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.startsWith('{'))
    .pop()
  if (!line || line === '{}') {
    return null
  }
  try {
    const parsed = JSON.parse(line) as Partial<MirrorWindowBounds>
    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number'
    ) {
      return null
    }
    return {
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
      owner: parsed.owner,
      name: parsed.name,
      onScreen: parsed.onScreen
    }
  } catch {
    return null
  }
}

async function runHelper(args: string[], timeout: number): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null
  }
  const helper = resolveBinary('scryno-winbounds')
  if (!existsSync(helper) && helper === 'scryno-winbounds') {
    return null
  }
  try {
    const { stdout } = await execFileAsync(helper, args, { timeout, maxBuffer: 64 * 1024 })
    return stdout
  } catch {
    return null
  }
}

/** Presses iPhone Mirroring's View → Larger and returns the window afterwards. */
export async function enlargeIphoneMirroringWindow(): Promise<MirrorWindowBounds | null> {
  const stdout = await runHelper(['larger'], 5000)
  return stdout ? parseBounds(stdout) : null
}

export async function moveMirrorWindow(
  deviceId: string,
  x: number,
  y: number
): Promise<{ ok: boolean; trusted: boolean }> {
  if (process.platform !== 'darwin') {
    return { ok: false, trusted: true }
  }

  const helper = resolveBinary('scryno-winbounds')
  if (!existsSync(helper) && helper === 'scryno-winbounds') {
    return { ok: false, trusted: true }
  }

  try {
    const { stdout } = await execFileAsync(
      helper,
      ['move', deviceId, String(Math.round(x)), String(Math.round(y))],
      { timeout: 800, maxBuffer: 64 * 1024 }
    )
    const parsed = JSON.parse(stdout.trim() || '{}') as { ok?: boolean; trusted?: boolean }
    return { ok: parsed.ok === true, trusted: parsed.trusted !== false }
  } catch {
    return { ok: false, trusted: true }
  }
}
