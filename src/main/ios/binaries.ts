import { existsSync } from 'fs'
import { delimiter } from 'path'

const IDEVICE_NAMES = [
  'idevice_id',
  'ideviceinfo',
  'idevicepair',
  'idevicescreenshot',
  'ideviceimagemounter',
  'ffmpeg'
] as const

export type IdeviceBinary = (typeof IDEVICE_NAMES)[number]

const CANDIDATE_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/local/bin'
]

/**
 * Resolve libimobiledevice CLIs even when Electron inherits a slim GUI PATH.
 */
export function resolveIdeviceBinary(name: IdeviceBinary): string {
  for (const dir of CANDIDATE_DIRS) {
    const full = `${dir}/${name}`
    if (existsSync(full)) {
      return full
    }
  }
  return name
}

/** Env for child_process so Homebrew stays on PATH for any nested tools. */
export function iosToolEnv(): NodeJS.ProcessEnv {
  const prefix = CANDIDATE_DIRS.join(delimiter)
  const current = process.env.PATH || ''
  return {
    ...process.env,
    PATH: current.includes('/opt/homebrew/bin') ? current : `${prefix}${delimiter}${current}`
  }
}

/** Rough ProductType → marketing name (best-effort). */
export function iosMarketingName(productType: string | undefined): string | undefined {
  if (!productType) {
    return undefined
  }
  const map: Record<string, string> = {
    'iPhone14,2': 'iPhone 13 Pro',
    'iPhone14,3': 'iPhone 13 Pro Max',
    'iPhone14,4': 'iPhone 13 mini',
    'iPhone14,5': 'iPhone 13',
    'iPhone14,7': 'iPhone 14',
    'iPhone14,8': 'iPhone 14 Plus',
    'iPhone15,2': 'iPhone 14 Pro',
    'iPhone15,3': 'iPhone 14 Pro Max',
    'iPhone15,4': 'iPhone 15',
    'iPhone15,5': 'iPhone 15 Plus',
    'iPhone16,1': 'iPhone 15 Pro',
    'iPhone16,2': 'iPhone 15 Pro Max',
    'iPhone17,1': 'iPhone 16 Pro',
    'iPhone17,2': 'iPhone 16 Pro Max',
    'iPhone17,3': 'iPhone 16',
    'iPhone17,4': 'iPhone 16 Plus'
  }
  return map[productType]
}
