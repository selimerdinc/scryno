import type { IosSpikeResult } from '../../shared/types'
import { listIosDevices } from './devices'
import { probeUsbmux } from './usbmux'

/**
 * Kept for compatibility; preferred path is devices:list which already merges iOS.
 */
export async function runIosSpike(): Promise<IosSpikeResult> {
  const hostPlatform = process.platform
  const [result, usbmux] = await Promise.all([listIosDevices(), probeUsbmux()])

  if (!result.available) {
    return {
      ok: true,
      supported: false,
      hostPlatform,
      message: [result.message, usbmux.message].filter(Boolean).join(' · '),
      devices: []
    }
  }

  const countNote =
    result.devices.length === 0
      ? 'bağlı iOS cihaz yok'
      : `${result.devices.length} iOS cihaz görüldü`

  return {
    ok: true,
    supported: true,
    hostPlatform,
    message: `${countNote}. ${usbmux.message} Canlı mirror henüz yok (keşif + screenshot aktif).`,
    devices: result.devices
  }
}
