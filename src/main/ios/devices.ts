import { execFile } from 'child_process'
import { promisify } from 'util'
import type { DeviceInfo } from '../../shared/types'
import { iosMarketingName, iosToolEnv, resolveIdeviceBinary } from './binaries'
import { getIosDeviceReadiness } from './readiness'

const execFileAsync = promisify(execFile)

async function readIdeviceKey(udid: string, key: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      resolveIdeviceBinary('ideviceinfo'),
      ['-u', udid, '-k', key],
      {
        timeout: 8000,
        maxBuffer: 64 * 1024,
        env: iosToolEnv()
      }
    )
    const value = stdout.trim()
    return value || undefined
  } catch {
    return undefined
  }
}

/**
 * Lists connected iOS devices on macOS via libimobiledevice.
 * Screen mirroring is not implemented yet; discovery + screenshot/pair only.
 */
export async function listIosDevices(): Promise<{
  devices: DeviceInfo[]
  available: boolean
  message?: string
}> {
  if (process.platform !== 'darwin') {
    return {
      devices: [],
      available: false,
      message: 'iOS keşif yalnızca macOS’ta destekleniyor.'
    }
  }

  const ideviceId = resolveIdeviceBinary('idevice_id')

  try {
    const { stdout } = await execFileAsync(ideviceId, ['-l'], {
      timeout: 10000,
      maxBuffer: 256 * 1024,
      env: iosToolEnv()
    })
    const ids = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    const devices: DeviceInfo[] = await Promise.all(
      ids.map(async (id) => {
        const [deviceName, productType, productVersion, readiness] = await Promise.all([
          readIdeviceKey(id, 'DeviceName'),
          readIdeviceKey(id, 'ProductType'),
          readIdeviceKey(id, 'ProductVersion'),
          getIosDeviceReadiness(id)
        ])

        const marketing = iosMarketingName(productType)
        const modelBits = [
          marketing || productType,
          productVersion ? `iOS ${productVersion}` : undefined
        ]
          .filter(Boolean)
          .join(' · ')

        const displayName =
          deviceName && deviceName !== 'iPhone' && deviceName !== 'iPad'
            ? deviceName
            : marketing || deviceName || `iOS ${id.slice(0, 8)}…`

        return {
          id,
          platform: 'ios' as const,
          name: displayName,
          model: modelBits || undefined,
          product: productType,
          state: 'device' as const,
          iosPaired: readiness.paired,
          iosScreenshotHint: readiness.screenshotHint
        }
      })
    )

    return {
      devices,
      available: true,
      message:
        devices.length === 0
          ? 'libimobiledevice hazır; USB ile iPhone bağla ve “Güven”e bas.'
          : undefined
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      return {
        devices: [],
        available: false,
        message:
          'idevice_id yok. macOS iOS keşif için: brew install libimobiledevice'
      }
    }

    return {
      devices: [],
      available: false,
      message: `iOS keşif hatası: ${err.message}`
    }
  }
}
