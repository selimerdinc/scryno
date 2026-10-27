import { app, BrowserWindow, screen } from 'electron'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { alignMirrorWindows } from './mirrorLayout'
import { findMirrorWindowBounds, moveMirrorWindow, type MirrorWindowBounds } from './mirrorWindowBounds'
import { getMirrorWindow, listSessions } from '../android/scrcpySession'
import { isDualRecordingActive } from '../media/dualVideo'
import { resolveBinary } from '../paths'

let dualWin: BrowserWindow | null = null
const createdDualWins = new Set<BrowserWindow>()
let followTimer: NodeJS.Timeout | null = null
let watcherTimer: NodeJS.Timeout | null = null
let missCount = 0

const DOCK_WIDTH = 46
const DOCK_HEIGHT = 232

function getConnectedAndroidId(): string {
  const s = listSessions()
  if (s.length > 0) return s[0].deviceId
  try {
    const adb = resolveBinary('adb')
    const out = execFileSync(adb, ['devices'], { encoding: 'utf8', timeout: 2000 })
    const lines = out.split('\n').filter((l) => l.includes('\tdevice'))
    if (lines.length > 0) return lines[0].split('\t')[0].trim()
  } catch {}
  return 'android'
}

let lastKnownAndroidBounds: MirrorWindowBounds | null = null
let lastKnownIosBounds: MirrorWindowBounds | null = null
let lastSelfMovedIosTime = 0
let lastUserDragTime = 0
let isProgrammaticMove = false

const attachedAndroidWindows = new WeakSet<BrowserWindow>()

export function attachAndroidMovement(win: BrowserWindow): void {
  if (attachedAndroidWindows.has(win)) {
    return
  }
  attachedAndroidWindows.add(win)

  let dragOffsetX: number | null = null
  let dragOffsetY: number | null = null

  win.on('move', () => {
    if (win.isDestroyed() || !dualWin || dualWin.isDestroyed() || isProgrammaticMove) return
    const ab = win.getBounds()
    if (dragOffsetX === null || dragOffsetY === null) {
      const db = dualWin.getBounds()
      dragOffsetX = db.x - ab.x
      dragOffsetY = db.y - ab.y
    }
    dualWin.setPosition(ab.x + dragOffsetX, ab.y + dragOffsetY)
  })

  win.on('moved', () => {
    dragOffsetX = null
    dragOffsetY = null
    if (win.isDestroyed() || isProgrammaticMove) return
    lastUserDragTime = Date.now()
    void onAndroidWindowDropped(win)
  })
}

async function onAndroidWindowDropped(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed() || isProgrammaticMove) return
  isProgrammaticMove = true
  lastUserDragTime = Date.now()

  try {
    const ab = win.getBounds()
    const display = screen.getDisplayMatching(ab)
    const area = display.workArea

    let ax = Math.min(Math.max(area.x + 8, ab.x), area.x + area.width - ab.width - 8)
    let ay = Math.min(Math.max(area.y + 40, ab.y), area.y + area.height - ab.height - 8)
    if (ax !== ab.x || ay !== ab.y) {
      win.setPosition(ax, ay)
    }

    lastKnownAndroidBounds = { x: ax, y: ay, width: ab.width, height: ab.height }

    const freshIos = await findMirrorWindowBounds('@iphone-mirroring')
    const iosWidth = freshIos?.width ?? 340
    const iosHeight = freshIos?.height ?? (ab.height - 40)

    let targetIosX = Math.round(ax + ab.width + 24)
    let targetIosY = Math.round(ay + 40)

    if (targetIosX + iosWidth > area.x + area.width - 8) {
      targetIosX = Math.round(ax - iosWidth - 24)
    }
    targetIosX = Math.min(Math.max(area.x + 8, targetIosX), area.x + area.width - iosWidth - 8)
    targetIosY = Math.min(Math.max(area.y + 40, targetIosY), area.y + area.height - iosHeight - 8)

    await moveMirrorWindow('@iphone-mirroring', targetIosX, targetIosY)
    lastKnownIosBounds = {
      x: targetIosX,
      y: targetIosY,
      width: iosWidth,
      height: iosHeight
    }
    lastSelfMovedIosTime = Date.now()

    const aId = getConnectedAndroidId()
    void updateDualToolbarPosition(aId, '@iphone-mirroring')
  } finally {
    setTimeout(() => {
      isProgrammaticMove = false
    }, 600)
  }
}

async function onIosWindowMoved(ios: MirrorWindowBounds, androidId: string): Promise<void> {
  if (isProgrammaticMove) return
  isProgrammaticMove = true
  lastUserDragTime = Date.now()

  try {
    const androidWin = getMirrorWindow(androidId) ?? (listSessions()[0] ? getMirrorWindow(listSessions()[0].deviceId) : null)
    if (!androidWin || androidWin.isDestroyed()) return

    const ab = androidWin.getBounds()
    const display = screen.getDisplayMatching(ios)
    const area = display.workArea

    let targetAndroidX = Math.round(ios.x - ab.width - 24)
    let targetAndroidY = Math.round(ios.y - 40)

    if (targetAndroidX < area.x + 8) {
      targetAndroidX = Math.round(ios.x + ios.width + 24)
    }

    targetAndroidX = Math.min(Math.max(area.x + 8, targetAndroidX), area.x + area.width - ab.width - 8)
    targetAndroidY = Math.min(Math.max(area.y + 40, targetAndroidY), area.y + area.height - ab.height - 8)

    androidWin.setPosition(targetAndroidX, targetAndroidY)
    lastKnownAndroidBounds = {
      x: targetAndroidX,
      y: targetAndroidY,
      width: ab.width,
      height: ab.height
    }

    void updateDualToolbarPosition(androidId, '@iphone-mirroring')
  } finally {
    setTimeout(() => {
      isProgrammaticMove = false
    }, 600)
  }
}

async function onDualWindowDropped(win: BrowserWindow, androidId: string): Promise<void> {
  if (win.isDestroyed() || isProgrammaticMove) return
  isProgrammaticMove = true
  lastUserDragTime = Date.now()

  try {
    const pos = win.getPosition()
    const display = screen.getDisplayMatching({ x: pos[0], y: pos[1], width: DOCK_WIDTH, height: DOCK_HEIGHT })

    await alignMirrorWindows(0, display)
    lastSelfMovedIosTime = Date.now()
    void updateDualToolbarPosition(androidId, '@iphone-mirroring')
  } finally {
    setTimeout(() => {
      isProgrammaticMove = false
    }, 600)
  }
}

export async function alignDualMirrors(): Promise<void> {
  await alignMirrorWindows(0)
  lastSelfMovedIosTime = Date.now()
  const aId = getConnectedAndroidId()
  void updateDualToolbarPosition(aId, '@iphone-mirroring')
}

function dualToolbarUrl(androidId: string, iosId: string): string {
  const query = new URLSearchParams({
    mode: 'dual',
    androidId,
    iosId
  }).toString()
  if (!app?.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/toolbar.html?${query}`
  }
  return `file://${join(__dirname, '../renderer/toolbar.html')}?${query}`
}

export function getAndroidWindowBounds(androidId?: string): MirrorWindowBounds | null {
  if (androidId) {
    const win = getMirrorWindow(androidId)
    if (win && !win.isDestroyed() && win.isVisible()) {
      const b = win.getBounds()
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    }
  }
  for (const s of listSessions()) {
    const win = getMirrorWindow(s.deviceId)
    if (win && !win.isDestroyed() && win.isVisible()) {
      const b = win.getBounds()
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.isVisible() && win !== dualWin) {
      try {
        const url = win.webContents.getURL()
        if (url.includes('mirror.html') || url.includes('/mirror')) {
          const b = win.getBounds()
          return { x: b.x, y: b.y, width: b.width, height: b.height }
        }
      } catch {
        // Ignore destroyed webContents
      }
    }
  }
  return null
}

function stopDualFollowLoop(): void {
  if (followTimer) {
    clearInterval(followTimer)
    followTimer = null
  }
  missCount = 0
}

function closeDuplicateDualWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (win === dualWin) continue
    try {
      const url = win.webContents.getURL()
      if (url.includes('mode=dual') || win.getTitle() === 'Scryno Dual Toolbar') {
        win.destroy()
      }
    } catch {
      // Ignore destroyed webContents
    }
  }
}

async function updateDualToolbarPosition(androidId: string, _iosId: string): Promise<void> {
  if (!dualWin || dualWin.isDestroyed()) {
    stopDualFollowLoop()
    return
  }

  // If user is actively dragging, let them finish
  if (Date.now() - lastUserDragTime < 600) {
    return
  }

  const freshAndroid = getAndroidWindowBounds(androidId)
  if (freshAndroid) {
    lastKnownAndroidBounds = freshAndroid
  }

  const freshIos = await findMirrorWindowBounds('@iphone-mirroring')
  if (freshIos) {
    // Check if user manually dragged iOS window to another position or monitor
    if (
      lastKnownIosBounds &&
      Date.now() - lastSelfMovedIosTime > 1500 &&
      !isProgrammaticMove &&
      (Math.abs(freshIos.x - lastKnownIosBounds.x) > 40 || Math.abs(freshIos.y - lastKnownIosBounds.y) > 40)
    ) {
      lastKnownIosBounds = freshIos
      void onIosWindowMoved(freshIos, androidId)
      return
    }
    lastKnownIosBounds = freshIos
  }

  const androidBounds = freshAndroid ?? lastKnownAndroidBounds
  const iosBounds = freshIos ?? lastKnownIosBounds

  // Dual toolbar ONLY exists when BOTH screens are simultaneously open
  if (!androidBounds || !iosBounds) {
    missCount += 1
    if (missCount >= 2 && !isDualRecordingActive()) {
      closeDualToolbar()
    }
    return
  }
  missCount = 0

  // Both windows are active! Dock vertically right next to the rightmost phone
  const maxX = Math.max(androidBounds.x + androidBounds.width, iosBounds.x + iosBounds.width)
  const minX = Math.min(androidBounds.x, iosBounds.x)
  const topY = Math.min(androidBounds.y, iosBounds.y)

  // Find the monitor matching the right edge of the cluster
  const display = screen.getDisplayMatching({
    x: Math.round(maxX - 20),
    y: Math.round(topY + 60),
    width: 40,
    height: 40
  })
  const workArea = display.workArea

  let targetX = Math.round(maxX + 6)
  if (targetX + DOCK_WIDTH > workArea.x + workArea.width - 2) {
    targetX = Math.round(Math.max(workArea.x + 4, minX - DOCK_WIDTH - 6))
  }
  let targetY = Math.round(topY + 60)

  targetX = Math.min(Math.max(workArea.x + 4, targetX), workArea.x + workArea.width - DOCK_WIDTH - 4)
  targetY = Math.min(Math.max(workArea.y + 4, targetY), workArea.y + workArea.height - DOCK_HEIGHT - 4)

  if (dualWin && !dualWin.isDestroyed()) {
    const cur = dualWin.getBounds()
    if (Math.abs(cur.x - targetX) > 2 || Math.abs(cur.y - targetY) > 2) {
      dualWin.setPosition(targetX, targetY)
    }
  }
}

function startDualFollowLoop(androidId: string, iosId: string): void {
  stopDualFollowLoop()
  followTimer = setInterval(() => {
    void updateDualToolbarPosition(androidId, iosId)
  }, 120)
}

let openingPromise: Promise<void> | null = null

export function openDualToolbar(androidId: string, iosId: string): Promise<void> {
  if (openingPromise) {
    return openingPromise
  }
  openingPromise = openDualToolbarImpl(androidId, iosId).finally(() => {
    openingPromise = null
  })
  return openingPromise
}

async function openDualToolbarImpl(androidId: string, iosId: string): Promise<void> {
  closeDuplicateDualWindows()

  const androidWin = getMirrorWindow(androidId) ?? (listSessions()[0] ? getMirrorWindow(listSessions()[0].deviceId) : null)
  if (androidWin) {
    attachAndroidMovement(androidWin)
  }

  if (dualWin && !dualWin.isDestroyed()) {
    dualWin.showInactive()
    dualWin.setAlwaysOnTop(true, 'floating')
    if (!followTimer) {
      startDualFollowLoop(androidId, iosId)
    }
    return
  }

  // Close any stray toolbar windows left from an earlier race
  for (const win of createdDualWins) {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
  createdDualWins.clear()

  const androidBounds = getAndroidWindowBounds(androidId)
  const iosBounds = await findMirrorWindowBounds('@iphone-mirroring')

  // MUST have both screens open to show dual toolbar
  if (!androidBounds || !iosBounds) {
    return
  }

  if (dualWin && !(dualWin as BrowserWindow).isDestroyed()) {
    return
  }

  const maxX = Math.max(androidBounds.x + androidBounds.width, iosBounds.x + iosBounds.width)
  const minX = Math.min(androidBounds.x, iosBounds.x)
  const topY = Math.min(androidBounds.y, iosBounds.y)

  const display = screen.getDisplayMatching({
    x: Math.round(maxX - 20),
    y: Math.round(topY + 60),
    width: 40,
    height: 40
  })
  const workArea = display.workArea

  let targetX = Math.round(maxX + 6)
  if (targetX + DOCK_WIDTH > workArea.x + workArea.width - 2) {
    targetX = Math.round(Math.max(workArea.x + 4, minX - DOCK_WIDTH - 6))
  }
  let targetY = Math.round(topY + 60)

  targetX = Math.min(Math.max(workArea.x + 4, targetX), workArea.x + workArea.width - DOCK_WIDTH - 4)
  targetY = Math.min(Math.max(workArea.y + 4, targetY), workArea.y + workArea.height - DOCK_HEIGHT - 4)

  dualWin = new BrowserWindow({
    width: DOCK_WIDTH,
    height: DOCK_HEIGHT,
    x: targetX,
    y: targetY,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: true,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    title: 'Scryno Dual Toolbar',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const win = dualWin
  createdDualWins.add(win)

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(false)

  void win.loadURL(dualToolbarUrl(androidId, iosId))

  startDualFollowLoop(androidId, iosId)

  // When user drops the Dual Toolbar, snap both screens onto that display
  win.on('moved', () => {
    if (win.isDestroyed()) return
    lastUserDragTime = Date.now()
    void onDualWindowDropped(win, androidId)
  })

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.showInactive()
      win.moveTop()
      win.setAlwaysOnTop(true, 'floating')
    }
  })

  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.showInactive()
      win.moveTop()
      win.setAlwaysOnTop(true, 'floating')
    }
  }, 300)

  win.on('closed', () => {
    createdDualWins.delete(win)
    if (dualWin === win) {
      stopDualFollowLoop()
      dualWin = null
    }
  })
}

export async function checkAndOpenDualToolbar(): Promise<void> {
  const androidBounds = getAndroidWindowBounds()
  const iosBounds = await findMirrorWindowBounds('@iphone-mirroring')

  // Both must be visibly on screen
  if (androidBounds !== null && iosBounds !== null) {
    if (!dualWin || dualWin.isDestroyed()) {
      const aId = getConnectedAndroidId()
      await openDualToolbar(aId, '@iphone-mirroring')
    } else if (!dualWin.isVisible()) {
      dualWin.showInactive()
      dualWin.setAlwaysOnTop(true, 'screen-saver', 1)
    }
  } else if (dualWin && !dualWin.isDestroyed() && !isDualRecordingActive()) {
    closeDualToolbar()
  }
}

let watcherBusy = false
let lastLoggedBothOpen: boolean | null = null

export function startDualToolbarWatcher(): void {
  if (watcherTimer) {
    return
  }
  let missingTicks = 0
  watcherTimer = setInterval(() => {
    if (watcherBusy) {
      return
    }
    watcherBusy = true
    void (async () => {
      try {
        closeDuplicateDualWindows()
        const androidBounds = getAndroidWindowBounds()
        if (!androidBounds && (!dualWin || dualWin.isDestroyed())) {
          return
        }
        const iosBounds = await findMirrorWindowBounds('@iphone-mirroring')

        // BOTH must be open and on-screen
        const bothOpen = androidBounds !== null && iosBounds !== null && iosBounds.onScreen !== false

        if (lastLoggedBothOpen !== bothOpen) {
          lastLoggedBothOpen = bothOpen
          console.log(`[DualWatcher] bothOpen=${bothOpen} android=${JSON.stringify(androidBounds)} ios=${JSON.stringify(iosBounds)}`)
        }

        if (bothOpen) {
          missingTicks = 0
          const aId = getConnectedAndroidId()
          const aWin = getMirrorWindow(aId)
          if (aWin) {
            attachAndroidMovement(aWin)
          }
          if (!dualWin || dualWin.isDestroyed()) {
            console.log(`[DualWatcher] Opening dual toolbar for android=${aId}`)
            await openDualToolbar(aId, '@iphone-mirroring')
          } else {
            if (!dualWin.isVisible()) {
              console.log(`[DualWatcher] Showing hidden dual toolbar`)
              dualWin.showInactive()
              dualWin.moveTop()
              dualWin.setAlwaysOnTop(true, 'floating')
            }
            if (!followTimer) {
              startDualFollowLoop(aId, '@iphone-mirroring')
            }
          }
        } else {
          missingTicks += 1
          if (dualWin && !dualWin.isDestroyed()) {
            if (dualWin.isVisible()) {
              dualWin.hide()
            }
            if (missingTicks >= 2 && !isDualRecordingActive()) {
              closeDualToolbar()
            }
          }
        }
      } finally {
        watcherBusy = false
      }
    })()
  }, 400)
}

export function closeDualToolbar(): void {
  stopDualFollowLoop()
  if (dualWin && !dualWin.isDestroyed()) {
    dualWin.close()
    dualWin = null
  }
  closeDuplicateDualWindows()
}

export function isDualToolbarOpen(): boolean {
  return dualWin !== null && !dualWin.isDestroyed()
}
