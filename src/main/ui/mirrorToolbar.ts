import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { isRecording } from '../media/recording'
import {
  findMirrorWindowBounds,
  moveMirrorWindow,
  type MirrorWindowBounds
} from './mirrorWindowBounds'
import {
  closeAllNativeChromes,
  closeNativeChrome,
  hasNativeChrome,
  isNativeChromeAvailable,
  openNativeChrome,
  sendNativeChromeStatus
} from './nativeChrome'

export type ToolbarOrientation = 'horizontal' | 'vertical'

export interface MirrorToolbarOptions {
  label?: string
  platform?: 'android' | 'ios'
  /** Window lookup key for the helper; defaults to the device id (scrcpy window title). */
  windowNeedle?: string
  /** Sit above the mirror window instead of over its title bar (iPhone Mirroring has none). */
  dockAbove?: boolean
}

interface ToolbarState {
  win: BrowserWindow
  orientation: ToolbarOrientation
  /** Vysor pinTitleBar equivalent — chrome stays visible while the session lives. */
  pinTitleBar: boolean
  lastMirror: MirrorWindowBounds | null
  missCount: number
  label: string
  platform: 'android' | 'ios'
  windowNeedle: string
  dockAbove: boolean
  lastPlaced: { x: number; y: number } | null
  draggedAt: number
  moveInFlight: boolean
  pendingMove: { x: number; y: number } | null
  accessibilityWarned: boolean
}

const toolbars = new Map<string, ToolbarState>()
const CHROME_HEIGHT = 40
const MIN_CHROME_WIDTH = 220
const DOCK_GAP = 0
/** Hide chrome only after the scrcpy window is missing for ~1.5s (not on app switch). */
const MISS_HIDE_AFTER = 12
/** While the user drags the chrome, the follow loop must not snap it back to the mirror. */
const DRAG_SETTLE_MS = 450

let followTimer: ReturnType<typeof setInterval> | null = null
let followInFlight = false

function toolbarUrl(deviceId: string, label: string, platform: string): string {
  const query = new URLSearchParams({
    deviceId,
    label,
    platform
  }).toString()
  if (!app?.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/toolbar.html?${query}`
  }
  return `file://${join(__dirname, '../renderer/toolbar.html')}?${query}`
}

function showChrome(state: ToolbarState): void {
  const { win } = state
  if (win.isDestroyed()) {
    return
  }
  if (!win.isVisible()) {
    win.showInactive()
  }
  // Keep above scrcpy (separate process window), like Vysor alwaysOnTop when enabled.
  win.setAlwaysOnTop(true, 'floating')
}

function hideChrome(state: ToolbarState): void {
  const { win } = state
  if (win.isDestroyed() || !win.isVisible()) {
    return
  }
  win.setAlwaysOnTop(false)
  win.hide()
}

function chromeSize(mirror: MirrorWindowBounds): { width: number; height: number } {
  return {
    width: Math.max(MIN_CHROME_WIDTH, Math.round(mirror.width)),
    height: CHROME_HEIGHT
  }
}

function dockOffset(state: ToolbarState): number {
  return state.dockAbove ? -CHROME_HEIGHT : DOCK_GAP
}

function dockPoint(
  mirror: MirrorWindowBounds,
  size: { width: number; height: number },
  offsetY: number
): { x: number; y: number } {
  let x = Math.round(mirror.x + (mirror.width - size.width) / 2)
  let y = Math.round(mirror.y + offsetY)

  const display = screen.getDisplayMatching({
    x: Math.round(mirror.x),
    y: Math.round(mirror.y),
    width: Math.round(mirror.width),
    height: Math.round(mirror.height)
  })
  const area = display.workArea

  x = Math.min(Math.max(area.x + 2, x), area.x + area.width - size.width - 2)
  y = Math.min(Math.max(area.y + 2, y), area.y + area.height - size.height - 2)

  return { x, y }
}

function placeToolbar(state: ToolbarState, mirror: MirrorWindowBounds): void {
  if (state.win.isDestroyed() || (Date.now() - state.draggedAt < DRAG_SETTLE_MS)) {
    return
  }
  const size = chromeSize(mirror)
  const point = dockPoint(mirror, size, dockOffset(state))
  state.lastPlaced = point
  const current = state.win.getBounds()
  if (
    current.x === point.x &&
    current.y === point.y &&
    current.width === size.width &&
    current.height === size.height
  ) {
    return
  }
  state.win.setBounds({
    x: point.x,
    y: point.y,
    width: size.width,
    height: size.height
  })
}

async function flushMirrorMove(deviceId: string, state: ToolbarState): Promise<void> {
  if (state.moveInFlight || !state.pendingMove) {
    return
  }
  const target = state.pendingMove
  state.pendingMove = null
  state.moveInFlight = true
  try {
    const result = await moveMirrorWindow(state.windowNeedle, target.x, target.y)
    if (!result.trusted && !state.accessibilityWarned && !state.win.isDestroyed()) {
      state.accessibilityWarned = true
      state.win.webContents.send('toolbar:status', {
        recording: isRecording(deviceId),
        message: 'Sürüklemek için Sistem Ayarları → Erişilebilirlik izni ver',
        kind: 'error'
      })
    }
  } finally {
    state.moveInFlight = false
    if (state.pendingMove) {
      void flushMirrorMove(deviceId, state)
    }
  }
}

// Dragging the chrome drags the scrcpy window with it, like a native title bar.
function onChromeMoved(deviceId: string, state: ToolbarState): void {
  if (state.win.isDestroyed() || !state.lastMirror) {
    return
  }
  const bounds = state.win.getBounds()
  if (state.lastPlaced && (bounds.x === state.lastPlaced.x) && (bounds.y === state.lastPlaced.y)) {
    return
  }
  state.draggedAt = Date.now()
  state.pendingMove = {
    x: bounds.x - (state.lastMirror.width - bounds.width) / 2,
    y: bounds.y - dockOffset(state)
  }
  void flushMirrorMove(deviceId, state)
}

async function refreshToolbars(): Promise<void> {
  if (toolbars.size === 0 || followInFlight) {
    return
  }
  followInFlight = true
  try {
    for (const [deviceId, state] of toolbars.entries()) {
      const mirror = await findMirrorWindowBounds(state.windowNeedle)
      if (mirror) {
        state.lastMirror = mirror
        state.missCount = 0
        placeToolbar(state, mirror)
        if (state.pinTitleBar) {
          showChrome(state)
        }
        continue
      }

      state.missCount += 1
      if (state.lastMirror && state.missCount < MISS_HIDE_AFTER) {
        // Brief miss (fullscreen animation / Spaces) — keep last dock + visible.
        placeToolbar(state, state.lastMirror)
        if (state.pinTitleBar) {
          showChrome(state)
        }
        continue
      }

      // Mirror window really gone (scrcpy closed).
      hideChrome(state)
    }
  } finally {
    followInFlight = false
  }
}

function ensureFollowWatcher(): void {
  if (followTimer) {
    return
  }
  followTimer = setInterval(() => {
    void refreshToolbars()
  }, 120)
  void refreshToolbars()
}

function stopFollowWatcherIfIdle(): void {
  if (toolbars.size > 0 || !followTimer) {
    return
  }
  clearInterval(followTimer)
  followTimer = null
}

export function showMirrorToolbar(deviceId: string, options: MirrorToolbarOptions = {}): void {
  const label = options.label?.trim() || deviceId
  const platform = options.platform ?? 'android'
  if (isNativeChromeAvailable()) {
    openNativeChrome(deviceId, { needle: options.windowNeedle ?? deviceId, label, platform })
    return
  }
  const existing = toolbars.get(deviceId)
  if (existing && !existing.win.isDestroyed()) {
    existing.label = label
    existing.platform = platform
    existing.windowNeedle = options.windowNeedle ?? deviceId
    existing.dockAbove = options.dockAbove ?? false
    existing.pinTitleBar = true
    existing.missCount = 0
    showChrome(existing)
    void refreshToolbars()
    return
  }

  const display = screen.getPrimaryDisplay()
  const width = 360
  const height = CHROME_HEIGHT
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2)
  const y = Math.round(display.workArea.y + 48)

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: true,
    // macOS panel: floats with the mirror without stealing Dock focus like a normal app window.
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    title: `Scryno chrome — ${deviceId}`,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(false)

  void win.loadURL(toolbarUrl(deviceId, label, platform))

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.showInactive()
      void refreshToolbars()
    }
  })

  win.on('move', () => {
    const state = toolbars.get(deviceId)
    if (state?.win === win) {
      onChromeMoved(deviceId, state)
    }
  })

  win.on('closed', () => {
    toolbars.delete(deviceId)
    stopFollowWatcherIfIdle()
  })

  toolbars.set(deviceId, {
    win,
    orientation: 'horizontal',
    pinTitleBar: true,
    lastMirror: null,
    missCount: 0,
    label,
    platform,
    windowNeedle: options.windowNeedle ?? deviceId,
    dockAbove: options.dockAbove ?? false,
    lastPlaced: null,
    draggedAt: 0,
    moveInFlight: false,
    pendingMove: null,
    accessibilityWarned: false
  })
  ensureFollowWatcher()
}

/** Kept for API compatibility; chrome is always horizontal (Vysor-style). */
export function setToolbarOrientation(
  deviceId: string,
  _orientation: ToolbarOrientation
): { ok: true; orientation: ToolbarOrientation } | { ok: false; message: string } {
  const state = toolbars.get(deviceId)
  if (!state || state.win.isDestroyed()) {
    return { ok: false, message: 'Toolbar yok' }
  }
  state.orientation = 'horizontal'
  void refreshToolbars()
  return { ok: true, orientation: state.orientation }
}

export function setToolbarPinnedVisible(deviceId: string, pinned: boolean): void {
  const state = toolbars.get(deviceId)
  if (!state || state.win.isDestroyed()) {
    return
  }
  state.pinTitleBar = pinned
  if (pinned) {
    showChrome(state)
  }
}

export function getDockedMirrorBounds(deviceId: string): MirrorWindowBounds | null {
  return toolbars.get(deviceId)?.lastMirror ?? null
}

export function closeMirrorToolbar(deviceId: string): void {
  closeNativeChrome(deviceId)
  const state = toolbars.get(deviceId)
  toolbars.delete(deviceId)
  stopFollowWatcherIfIdle()
  if (state && !state.win.isDestroyed()) {
    state.win.close()
  }
}

export function closeAllMirrorToolbars(): void {
  closeAllNativeChromes()
  for (const deviceId of Array.from(toolbars.keys())) {
    closeMirrorToolbar(deviceId)
  }
}

export function broadcastToolbarStatus(
  deviceId: string,
  payload: { recording: boolean; message?: string; kind?: 'ok' | 'error' | 'info' }
): void {
  if (hasNativeChrome(deviceId)) {
    sendNativeChromeStatus(deviceId, payload)
    return
  }
  const state = toolbars.get(deviceId)
  if (!state || state.win.isDestroyed()) {
    return
  }
  // Recording keeps chrome pinned (Vysor pinTitleBar while useful).
  if (payload.recording) {
    state.pinTitleBar = true
    showChrome(state)
  }
  state.win.webContents.send('toolbar:status', payload)
}
