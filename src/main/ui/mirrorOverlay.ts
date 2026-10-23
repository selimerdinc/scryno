import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { findMirrorWindowBounds } from './mirrorWindowBounds'

interface OverlaySession {
  win: BrowserWindow
  timer: ReturnType<typeof setInterval> | null
  needle: string
}

const overlays = new Map<string, OverlaySession>()

function overlayUrl(deviceId: string, label: string): string {
  const query = new URLSearchParams({
    deviceId,
    label
  }).toString()
  if (!app?.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/overlay.html?${query}`
  }
  return `file://${join(__dirname, '../renderer/overlay.html')}?${query}`
}

export function closeMirrorOverlay(deviceId: string): void {
  const session = overlays.get(deviceId)
  if (!session) {
    return
  }
  overlays.delete(deviceId)
  if (session.timer) {
    clearInterval(session.timer)
  }
  if (!session.win.isDestroyed()) {
    session.win.destroy()
  }
}

export function closeAllMirrorOverlays(): void {
  for (const deviceId of Array.from(overlays.keys())) {
    closeMirrorOverlay(deviceId)
  }
}

export async function toggleMirrorOverlay(
  deviceId: string,
  needle = '@iphone-mirroring',
  label = 'iPhone'
): Promise<{ ok: boolean; open: boolean }> {
  if (overlays.has(deviceId)) {
    closeMirrorOverlay(deviceId)
    return { ok: true, open: false }
  }

  const bounds = await findMirrorWindowBounds(needle)
  if (!bounds) {
    return { ok: false, open: false }
  }

  const win = new BrowserWindow({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'floating')

  win.on('closed', () => {
    closeMirrorOverlay(deviceId)
  })

  // Periodically track iPhone Mirroring window bounds
  const timer = setInterval(async () => {
    if (win.isDestroyed()) {
      closeMirrorOverlay(deviceId)
      return
    }
    const current = await findMirrorWindowBounds(needle)
    if (!current) {
      closeMirrorOverlay(deviceId)
      return
    }
    const winBounds = win.getBounds()
    const target = {
      x: Math.round(current.x),
      y: Math.round(current.y),
      width: Math.round(current.width),
      height: Math.round(current.height)
    }
    if (
      Math.abs(winBounds.x - target.x) > 2 ||
      Math.abs(winBounds.y - target.y) > 2 ||
      Math.abs(winBounds.width - target.width) > 2 ||
      Math.abs(winBounds.height - target.height) > 2
    ) {
      win.setBounds(target)
    }
  }, 400)

  overlays.set(deviceId, { win, timer, needle })

  await win.loadURL(overlayUrl(deviceId, label))
  if (!win.isDestroyed()) {
    win.show()
  }

  return { ok: true, open: true }
}
