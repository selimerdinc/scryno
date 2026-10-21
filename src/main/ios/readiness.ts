import { execFile } from 'child_process'
import { promisify } from 'util'
import { iosToolEnv, resolveIdeviceBinary } from './binaries'

const execFileAsync = promisify(execFile)

export interface IosDeviceReadiness {
  paired: boolean
  pairMessage: string
  screenshotHint: string
}

const readinessCache = new Map<string, { at: number; value: IosDeviceReadiness }>()
const CACHE_MS = 8000

async function runPairValidate(udid: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      resolveIdeviceBinary('idevicepair'),
      ['-u', udid, 'validate'],
      {
        timeout: 8000,
        maxBuffer: 256 * 1024,
        env: iosToolEnv()
      }
    )
    const detail = `${stdout}\n${stderr}`.trim()
    if (/success/i.test(detail)) {
      return { ok: true, detail }
    }
    return { ok: false, detail: detail || 'Eşleştirme doğrulanamadı' }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    if (err.code === 'ENOENT') {
      return {
        ok: false,
        detail: 'idevicepair yok. brew install libimobiledevice'
      }
    }
    const detail = `${err.stdout || ''}\n${err.stderr || ''}\n${err.message || ''}`.trim()
    return { ok: false, detail: detail || 'Eşleştirme kontrolü başarısız' }
  }
}

export async function getIosDeviceReadiness(udid: string): Promise<IosDeviceReadiness> {
  const cached = readinessCache.get(udid)
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value
  }

  const pair = await runPairValidate(udid)
  const value: IosDeviceReadiness = {
    paired: pair.ok,
    pairMessage: pair.ok
      ? 'Bilgisayarla eşleştirilmiş'
      : `Eşleştirme gerekli: telefonda “Güven” de, gerekirse Eşleştir’e bas. ${pair.detail}`,
    screenshotHint: pair.ok
      ? 'Screenshot için Developer Mode / Disk Image gerekebilir.'
      : 'Önce eşleştirmeyi tamamla, sonra screenshot dene.'
  }
  readinessCache.set(udid, { at: Date.now(), value })
  return value
}

export function clearIosReadinessCache(udid?: string): void {
  if (udid) {
    readinessCache.delete(udid)
    return
  }
  readinessCache.clear()
}

export async function requestIosPair(udid: string): Promise<{ ok: true; message: string }> {
  clearIosReadinessCache(udid)
  try {
    const { stdout, stderr } = await execFileAsync(
      resolveIdeviceBinary('idevicepair'),
      ['-u', udid, 'pair'],
      {
        timeout: 60000,
        maxBuffer: 256 * 1024,
        env: iosToolEnv()
      }
    )
    const detail = `${stdout}\n${stderr}`.trim()
    if (/success/i.test(detail)) {
      clearIosReadinessCache(udid)
      return { ok: true, message: 'iOS eşleştirme tamam: ' + detail }
    }
    throw Object.assign(new Error(detail || 'Eşleştirme başarısız'), { code: 'IOS_PAIR_FAILED' })
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string }
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error('idevicepair yok. brew install libimobiledevice'), {
        code: 'IDEVICEPAIR_NOT_FOUND'
      })
    }
    if (err.code === 'IOS_PAIR_FAILED') {
      throw error
    }
    const detail = `${err.stdout || ''}\n${err.stderr || ''}\n${err.message || ''}`.trim()
    throw Object.assign(new Error(detail || 'iOS eşleştirme başarısız'), {
      code: 'IOS_PAIR_FAILED'
    })
  }
}
