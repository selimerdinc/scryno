import { screen } from 'electron'
import { getMirrorWindow, listSessions } from '../android/scrcpySession'
import { IPHONE_MIRRORING_NEEDLE } from '../ios/iphoneMirroring'
import { listIosMirrorSessions } from '../ios/mirror'
import {
  enlargeIphoneMirroringWindow,
  findMirrorWindowBounds,
  moveMirrorWindow,
  type MirrorWindowBounds
} from './mirrorWindowBounds'

const BAR_HEIGHT = 40
const GAP = 28

interface PlacedWindow {
  needle: string
  frame: MirrorWindowBounds
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Grows iPhone Mirroring to the largest size macOS allows, matches every Android
 * mirror to that height, then places the windows side by side with a shared top edge.
 */
export async function alignMirrorWindows(attempt = 0): Promise<void> {
  const expected = listSessions().length + listIosMirrorSessions().length
  if (expected === 0) {
    return
  }

  let ios = await findMirrorWindowBounds(IPHONE_MIRRORING_NEEDLE)
  if (ios) {
    for (let step = 0; step < 3; step += 1) {
      const grown = await enlargeIphoneMirroringWindow()
      if (!grown || grown.height <= ios.height + 4) {
        break
      }
      ios = grown
    }
  }

  const windows: PlacedWindow[] = []
  if (ios) {
    windows.push({ needle: IPHONE_MIRRORING_NEEDLE, frame: ios })
  }
  for (const session of listSessions()) {
    const win = getMirrorWindow(session.deviceId)
    if (win) {
      const bounds = win.getBounds()
      windows.push({
        needle: session.deviceId,
        frame: { x: bounds.x, y: bounds.y + BAR_HEIGHT, width: bounds.width, height: bounds.height - BAR_HEIGHT }
      })
    }
  }

  if (windows.length < expected && attempt < 5) {
    await delay(400)
    await alignMirrorWindows(attempt + 1)
    return
  }
  if (windows.length === 0 || (!ios && windows.length < 2)) {
    return
  }

  windows.sort((left, right) => left.frame.x - right.frame.x)
  const anchor = windows[0].frame
  const display = screen.getDisplayMatching({
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
    width: Math.round(Math.max(1, anchor.width)),
    height: Math.round(Math.max(1, anchor.height))
  })
  const area = display.workArea
  const tallest = Math.max(...windows.map((item) => item.frame.height))
  let y = area.y + BAR_HEIGHT + 8
  if (y + tallest > area.y + area.height - 8) {
    y = Math.max(area.y + BAR_HEIGHT, area.y + area.height - 8 - tallest)
  }

  // Lift first: a window parked against the bottom of the screen refuses to grow.
  if (ios) {
    for (const item of windows) {
      if (item.needle === IPHONE_MIRRORING_NEEDLE) {
        continue
      }
      const win = getMirrorWindow(item.needle)
      if (!win) {
        continue
      }
      const width = Math.round((ios.height * item.frame.width) / item.frame.height)
      win.setBounds({
        x: Math.round(item.frame.x),
        y: Math.round(y - BAR_HEIGHT),
        width,
        height: Math.round(ios.height + BAR_HEIGHT)
      })
      item.frame = { x: item.frame.x, y, width, height: ios.height }
    }
  }

  const totalWidth =
    windows.reduce((sum, item) => sum + item.frame.width, 0) + GAP * (windows.length - 1)
  let x = Math.round(area.x + Math.max(8, (area.width - totalWidth) / 2))
  for (const item of windows) {
    const win = getMirrorWindow(item.needle)
    if (win) {
      win.setPosition(Math.round(x), Math.round(y - BAR_HEIGHT))
    } else {
      await moveMirrorWindow(item.needle, Math.round(x), Math.round(y))
    }
    x += item.frame.width + GAP
  }
}
