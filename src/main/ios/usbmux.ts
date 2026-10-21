import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const USBMUX_SOCKET_CANDIDATES = ['/var/run/usbmuxd', '/var/run/usbmuxd.sock']

export interface UsbmuxStatus {
  available: boolean
  socketPath?: string
  deviceCount: number
  message: string
}

/**
 * Lightweight readiness check for the macOS usbmuxd path used by iOS tooling.
 * Does not speak the usbmux protocol yet — discovery still goes through libimobiledevice.
 */
export async function probeUsbmux(): Promise<UsbmuxStatus> {
  if (process.platform !== 'darwin') {
    return {
      available: false,
      deviceCount: 0,
      message: 'usbmuxd keşifi yalnızca macOS’ta anlamlı.'
    }
  }

  const socketPath = USBMUX_SOCKET_CANDIDATES.find((path) => existsSync(path))
  if (!socketPath) {
    return {
      available: false,
      deviceCount: 0,
      message: 'usbmuxd soketi yok. iPhone USB ile bağlı mı / Apple Mobile Device servisi çalışıyor mu?'
    }
  }

  let deviceCount = 0
  try {
    const { stdout } = await execFileAsync('idevice_id', ['-l'], {
      timeout: 5000,
      maxBuffer: 64 * 1024
    })
    deviceCount = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length
  } catch {
    // Socket may exist while libimobiledevice is missing.
  }

  return {
    available: true,
    socketPath,
    deviceCount,
    message:
      deviceCount > 0
        ? `usbmuxd hazır (${socketPath}), ${deviceCount} iOS cihaz.`
        : `usbmuxd hazır (${socketPath}). Canlı mirror sonraki adım; şimdilik keşif + screenshot.`
  }
}
