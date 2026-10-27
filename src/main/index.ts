import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { listAndroidApps, listAndroidDevices, sendFilesToAndroid } from './android/adb'
import {
  getSession,
  isMirrorRecording,
  killOrphanedScrcpy,
  listSessions,
  setMirrorFocusHandler,
  setSessionExitListener,
  startMirrorRecording,
  startScrcpySession,
  stopAllSessions,
  stopMirrorRecording,
  stopScrcpySession,
  isAndroidAnnotationsOpen,
  setAndroidAnnotations
} from './android/scrcpySession'
import {
  connectWireless,
  disconnectWireless,
  enableTcpip,
  pairWireless
} from './android/wireless'
import { listIosDevices } from './ios/devices'
import { runIosSpike } from './ios/iosSpike'
import {
  getIosFrameHub,
  isIosMirroring,
  isIphoneMirroringSession,
  listIosMirrorSessions,
  restoreIosMirror,
  setIosAutoRestore,
  startIosMirror,
  stopAllIosMirrors,
  stopIosMirror
} from './ios/mirror'
import { isIosRecording, listIosRecordings, startIosRecording, stopIosRecording } from './ios/recording'
import {
  activateIphoneMirroring,
  captureIphoneMirroringScreenshot,
  enlargeIphoneMirroring,
  isIphoneMirroringRecording,
  listIphoneMirroringRecordings,
  startIphoneMirroringRecording,
  stopIphoneMirroringRecording
} from './ios/iphoneMirroring'
import { execFileSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { unlink, writeFile } from 'fs/promises'
import { requestIosPair } from './ios/readiness'
import { probeUsbmux } from './ios/usbmux'
import { getCaptureDir, makeCapturePath } from './media/capturePaths'
import {
  isRecording,
  listAdbRecordings,
  startAdbRecording,
  stopAdbRecording,
  stopAllAdbRecordings
} from './media/recording'
import { copyImageFileToClipboard } from './media/clipboardImage'
import { captureDevicePreview } from './media/preview'
import { takeAndroidScreenshot, takeIosScreenshot } from './media/screenshot'
import { resolveBinary } from './paths'
import { captureDualRawSources, saveDualScreenshot } from './media/dualCapture'
import {
  clearDualRecordingActive,
  isDualRecordingActive,
  mergeDualVideos,
  preserveDualSources,
  setDualRecordingActive
} from './media/dualVideo'
import {
  broadcastToolbarStatus,
  closeAllMirrorToolbars,
  closeMirrorToolbar,
  setToolbarOrientation,
  type ToolbarOrientation
} from './ui/mirrorToolbar'
import {
  checkAndOpenDualToolbar,
  closeDualToolbar,
  getAndroidWindowBounds,
  isDualToolbarOpen,
  openDualToolbar,
  startDualToolbarWatcher
} from './ui/dualToolbar'
import { findMirrorWindowBounds } from './ui/mirrorWindowBounds'

// Ensure standard macOS bin paths (Homebrew, /usr/local/bin) are in PATH for child processes
if (process.platform === 'darwin') {
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin']
  const currentPath = process.env.PATH || ''
  const missing = extraPaths.filter((p) => !currentPath.includes(p) && existsSync(p))
  if (missing.length > 0) {
    process.env.PATH = `${missing.join(':')}:${currentPath}`
  }
}
import {
  setChromeActionHandler,
  setChromeActivateHandler,
  setChromeReadyHandler,
  type ChromeAction
} from './ui/nativeChrome'
import {
  toggleMirrorOverlay,
  closeMirrorOverlay,
  closeAllMirrorOverlays,
  isMirrorOverlayOpen
} from './ui/mirrorOverlay'
import { alignMirrorWindows, bringAllMirrorsToFront } from './ui/mirrorLayout'
import type { ApiError, DeviceInfo, MirrorOptions } from '../shared/types'

const isDev = !app?.isPackaged

function toApiError(error: unknown, fallbackCode: string): ApiError {
  const err = error as { code?: string; message?: string }
  return {
    ok: false,
    code: err.code || fallbackCode,
    message: err.message || 'Bilinmeyen hata'
  }
}

let mainWindow: BrowserWindow | null = null
let alignTimer: ReturnType<typeof setTimeout> | null = null

function scheduleMirrorAlign(): void {
  if (alignTimer) {
    clearTimeout(alignTimer)
  }
  alignTimer = setTimeout(() => {
    alignTimer = null
    void (async () => {
      await alignMirrorWindows()
      await checkAndOpenDualToolbar()
    })()
  }, 350)
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    show: false,
    title: 'Scryno',
    autoHideMenuBar: true,
    backgroundColor: '#07080c',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const win = mainWindow

  win.once('ready-to-show', () => {
    win.show()
  })

  // Prevent window staying hidden if ready-to-show is delayed by macOS WindowServer
  const showFallback = setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      win.show()
    }
  }, 2500)

  win.webContents.on('did-finish-load', () => {
    clearTimeout(showFallback)
  })

  win.webContents.on('did-fail-load', () => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (isDev && rendererUrl) {
      setTimeout(() => {
        if (win && !win.isDestroyed()) {
          void win.loadURL(rendererUrl)
        }
      }, 400)
    }
  })

  // Closing the hub closes the Android window and iPhone Mirroring with it.
  // Quitting iPhone Mirroring hands focus back, which would reopen the hub.
  win.on('close', () => {
    ignoreNextActivate = true
    void closeCompanionMirrors()
  })

  win.on('closed', () => {
    clearTimeout(showFallback)
    if (mainWindow === win) {
      mainWindow = null
    }
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function resolveTargetDeviceId(deviceId?: string): string {
  if (!deviceId || deviceId === 'android') {
    const s = listSessions()
    if (s.length > 0) return s[0].deviceId
    try {
      const adb = resolveBinary('adb')
      const out = execFileSync(adb, ['devices'], { encoding: 'utf8', timeout: 2000 })
      const lines = out.split('\n').filter((l) => l.includes('\tdevice'))
      if (lines.length > 0) {
        return lines[0].split('\t')[0].trim()
      }
    } catch {
      // ignore
    }
    return 'android'
  }
  if (!deviceId || deviceId === 'ios') {
    const s = listIosMirrorSessions()
    if (s.length > 0) return s[0].deviceId
    return '@iphone-mirroring'
  }
  return deviceId
}

function isIphoneTarget(deviceId: string): boolean {
  if (isIphoneMirroringSession(deviceId)) return true
  const norm = deviceId.toLowerCase()
  if (
    deviceId === 'ios' ||
    deviceId === '@iphone-mirroring' ||
    norm.includes('ios') ||
    norm.includes('iphone')
  ) {
    return true
  }
  if (isIphoneMirroringRecording(deviceId)) return true
  return false
}

interface RecentRecording {
  path: string
  platform: 'android' | 'ios'
  deviceId: string
  timestamp: number
}

let recentRecordings: RecentRecording[] = []

async function maybeAutoMergeRecentRecordings(newRec: RecentRecording): Promise<string | null> {
  const now = Date.now()
  recentRecordings = recentRecordings.filter((r) => now - r.timestamp < 30000 && r.path !== newRec.path)

  const otherIdx = recentRecordings.findIndex(
    (r) => r.platform !== newRec.platform && existsSync(r.path)
  )

  if (otherIdx !== -1) {
    const otherRec = recentRecordings[otherIdx]
    recentRecordings.splice(otherIdx, 1)

    const androidPath = newRec.platform === 'android' ? newRec.path : otherRec.path
    const iosPath = newRec.platform === 'ios' ? newRec.path : otherRec.path

    if (existsSync(androidPath) && existsSync(iosPath)) {
      try {
        console.log(`[AutoMerge] Merging dual recordings: ${androidPath} + ${iosPath}`)
        const merged = await mergeDualVideos(androidPath, iosPath)
        try {
          if (existsSync(androidPath)) await unlink(androidPath)
          if (existsSync(iosPath)) await unlink(iosPath)
        } catch {
          // Ignore unlink errors
        }

        shell.showItemInFolder(merged.path)
        broadcastToolbarStatus(newRec.deviceId, {
          recording: false,
          message: 'Yan yana tek video kaydedildi!',
          kind: 'ok'
        })
        broadcastToolbarStatus(otherRec.deviceId, {
          recording: false,
          message: 'Yan yana tek video kaydedildi!',
          kind: 'ok'
        })
        return merged.path
      } catch (err) {
        console.error('[AutoMerge] Failed to auto-merge dual videos:', err)
      }
    }
  }

  recentRecordings.push(newRec)
  return null
}

function isRecordingFor(deviceId: string): boolean {
  const targetId = resolveTargetDeviceId(deviceId)
  return (
    isIphoneMirroringRecording(targetId) ||
    isIosRecording(targetId) ||
    isMirrorRecording(targetId) ||
    isRecording(targetId)
  )
}

async function stopMirrorFor(deviceId: string): Promise<void> {
  closeMirrorOverlay(deviceId)
  if (isIosMirroring(deviceId)) {
    stopIosMirror(deviceId)
    return
  }
  if (isMirrorRecording(deviceId)) {
    try {
      const result = await stopMirrorRecording(deviceId)
      shell.showItemInFolder(result.path)
    } catch {
      // Best-effort save before closing mirror.
    }
  }
  if (isRecording(deviceId)) {
    try {
      await stopAdbRecording(deviceId)
    } catch {
      // Best-effort stop before closing mirror.
    }
  }
  stopScrcpySession(deviceId)
  closeMirrorToolbar(deviceId)
  const remainingAndroid = listSessions()
  const remainingIos = listIosMirrorSessions()
  if (remainingAndroid.length === 0 || remainingIos.length === 0) {
    closeDualToolbar()
  }
}

async function screenshotFor(
  deviceId: string,
  platform: DeviceInfo['platform']
): Promise<{ path: string; message: string; copiedToClipboard: boolean }> {
  const targetId = resolveTargetDeviceId(deviceId)
  const result = (isIphoneMirroringSession(targetId) || isIphoneTarget(targetId))
    ? await captureIphoneMirroringScreenshot()
    : platform === 'ios'
      ? await takeIosScreenshot(targetId)
      : await takeAndroidScreenshot(targetId)

  const copiedToClipboard = copyImageFileToClipboard(result.path)

  if (isIphoneMirroringSession(targetId) || isIphoneTarget(targetId) || platform === 'ios') {
    closeMirrorOverlay(deviceId)
    closeMirrorOverlay(targetId)
    closeMirrorOverlay('@iphone-mirroring')
  } else {
    void setAndroidAnnotations(targetId, false)
    if (deviceId !== targetId) {
      void setAndroidAnnotations(deviceId, false)
    }
  }

  broadcastToolbarStatus(deviceId, {
    recording: isRecordingFor(deviceId),
    message: copiedToClipboard ? 'Kaydedildi · panoya kopyalandı' : 'Ekran görüntüsü kaydedildi',
    kind: 'ok'
  })
  return {
    path: result.path,
    message: copiedToClipboard
      ? `Screenshot kaydedildi ve panoya kopyalandı: ${result.path}`
      : `Screenshot kaydedildi: ${result.path}`,
    copiedToClipboard
  }
}

function startRecordingFor(deviceId: string, isDual = false): void {
  const targetId = resolveTargetDeviceId(deviceId)
  console.log(`[Recording] startRecordingFor target=${targetId}, isDual=${isDual}, isIphone=${isIphoneTarget(targetId)}`)
  const iosHub = getIosFrameHub(targetId)
  if (isIphoneTarget(targetId)) {
    startIphoneMirroringRecording(targetId, isDual)
  } else if (iosHub) {
    startIosRecording(targetId, iosHub, isDual)
  } else if (getSession(targetId)) {
    startMirrorRecording(targetId, isDual)
  } else {
    startAdbRecording(targetId, isDual)
  }
  const msg = isDual ? 'Dual kayıt başladı' : 'Kayıt başladı'
  broadcastToolbarStatus(deviceId, { recording: true, message: msg, kind: 'info' })
  if (targetId !== deviceId) {
    broadcastToolbarStatus(targetId, { recording: true, message: msg, kind: 'info' })
  }
}

async function stopRecordingFor(deviceId: string, isDual = false): Promise<{ path: string }> {
  const targetId = resolveTargetDeviceId(deviceId)
  console.log(`[Recording] stopRecordingFor target=${targetId}, isDual=${isDual}, isIphone=${isIphoneTarget(targetId)}`)
  try {
    const result = isIphoneTarget(targetId)
      ? await stopIphoneMirroringRecording(targetId)
      : isIosRecording(targetId)
        ? await stopIosRecording(targetId)
        : isMirrorRecording(targetId)
          ? await stopMirrorRecording(targetId)
          : await stopAdbRecording(targetId)

    if (!isDual && !isDualRecordingActive()) {
      closeAllMirrorOverlays()
      void setAndroidAnnotations(targetId, false)
      if (deviceId !== targetId) {
        void setAndroidAnnotations(deviceId, false)
      }
      broadcastToolbarStatus(deviceId, {
        recording: false,
        message: 'Kayıt İndirilenler’e alındı',
        kind: 'ok'
      })
      if (targetId !== deviceId) {
        broadcastToolbarStatus(targetId, {
          recording: false,
          message: 'Kayıt İndirilenler’e alındı',
          kind: 'ok'
        })
      }

      const platform: 'android' | 'ios' =
        isIphoneTarget(targetId) || isIosRecording(targetId) || isIosMirroring(targetId)
          ? 'ios'
          : 'android'

      const mergedPath = await maybeAutoMergeRecentRecordings({
        path: result.path,
        platform,
        deviceId: targetId,
        timestamp: Date.now()
      })

      if (mergedPath) {
        return { path: mergedPath }
      }
    }

    return result
  } catch (error) {
    broadcastToolbarStatus(deviceId, {
      recording: false,
      message: 'Kayıt durdurulamadı',
      kind: 'error'
    })
    throw error
  }
}

const recordingBusy = new Set<string>()

function handleChromeAction(deviceId: string, action: ChromeAction): void {
  const platform: DeviceInfo['platform'] = isIosMirroring(deviceId) ? 'ios' : 'android'
  const run = async (): Promise<void> => {
    switch (action) {
      case 'screenshot':
        await screenshotFor(deviceId, platform)
        break
      case 'record':
        if (recordingBusy.has(deviceId)) {
          break
        }
        recordingBusy.add(deviceId)
        try {
          if (isRecordingFor(deviceId)) {
            broadcastToolbarStatus(deviceId, {
              recording: false,
              message: 'Kayıt durduruluyor…',
              kind: 'info'
            })
            const result = await stopRecordingFor(deviceId)
            shell.showItemInFolder(result.path)
          } else {
            startRecordingFor(deviceId)
          }
        } finally {
          setTimeout(() => recordingBusy.delete(deviceId), 1200)
        }
        break
      case 'folder':
        await shell.openPath(getCaptureDir())
        break
      case 'draw':
        await toggleMirrorOverlay(
          deviceId,
          isIphoneMirroringSession(deviceId) ? '@iphone-mirroring' : deviceId
        )
        break
      case 'close':
        await stopMirrorFor(deviceId)
        break
    }
  }
  run().catch((error: unknown) => {
    broadcastToolbarStatus(deviceId, {
      recording: isRecordingFor(deviceId),
      message: (error as { message?: string }).message || 'İşlem başarısız',
      kind: 'error'
    })
  })
}

function registerIpc(): void {
  ipcMain.handle('devices:list', async () => {
    try {
      let androidDevices: DeviceInfo[] = []
      let adbPath = 'adb'
      let androidError: string | undefined

      try {
        const android = await listAndroidDevices()
        androidDevices = android.devices
        adbPath = android.adbPath
      } catch (error) {
        const err = error as { message?: string }
        androidError = err.message || 'Android cihaz listesi alınamadı'
      }

      const ios = await listIosDevices()
      const usbmux = await probeUsbmux()
      const devices: DeviceInfo[] = [...androidDevices, ...ios.devices]
      const iosMessage =
        ios.available === false
          ? ios.message
          : ios.devices.length === 0
            ? ios.message || (usbmux.available ? undefined : usbmux.message)
            : undefined

      if (devices.length === 0 && androidError && !ios.available) {
        return {
          ok: false as const,
          code: 'LIST_DEVICES_FAILED',
          message: [androidError, ios.message].filter(Boolean).join(' · ')
        }
      }

      return {
        ok: true as const,
        devices,
        adbPath,
        iosAvailable: ios.available,
        iosMessage
      }
    } catch (error) {
      return toApiError(error, 'LIST_DEVICES_FAILED')
    }
  })

  ipcMain.handle(
    'mirror:start',
    async (
      _event,
      deviceId: string,
      options?: MirrorOptions,
      platform?: DeviceInfo['platform'],
      label?: string
    ) => {
      try {
        if (!deviceId || typeof deviceId !== 'string') {
          return {
            ok: false as const,
            code: 'INVALID_DEVICE',
            message: 'Geçersiz cihaz kimliği'
          }
        }
        if (platform === 'ios') {
          const session = await startIosMirror(deviceId, label)
          scheduleMirrorAlign()
          void checkAndOpenDualToolbar()
          return { ok: true as const, session }
        }
        const session = await startScrcpySession(deviceId, options ?? {}, label || deviceId)
        scheduleMirrorAlign()
        void checkAndOpenDualToolbar()
        return { ok: true as const, session }
      } catch (error) {
        return toApiError(error, 'START_MIRROR_FAILED')
      }
    }
  )

  ipcMain.handle('mirror:stop', async (_event, deviceId: string) => {
    try {
      await stopMirrorFor(deviceId)
      return { ok: true as const, deviceId }
    } catch (error) {
      return toApiError(error, 'STOP_MIRROR_FAILED')
    }
  })

  ipcMain.handle('mirror:sessions', async () => {
    return { ok: true as const, sessions: [...listSessions(), ...listIosMirrorSessions()] }
  })

  ipcMain.handle('ios:spike', async () => {
    try {
      return await runIosSpike()
    } catch (error) {
      return toApiError(error, 'IOS_SPIKE_FAILED')
    }
  })

  ipcMain.handle('ios:enlarge', async () => {
    try {
      const result = await enlargeIphoneMirroring()
      return { ok: true as const, message: result.message }
    } catch (error) {
      return toApiError(error, 'IOS_ENLARGE_FAILED')
    }
  })

  ipcMain.handle(
    'ios:auto-restore',
    async (_event, deviceId: string, label: string, enabled: boolean) => {
      if (!deviceId || typeof deviceId !== 'string') {
        return {
          ok: false as const,
          code: 'INVALID_DEVICE',
          message: 'Geçersiz iOS cihaz kimliği'
        }
      }
      setIosAutoRestore(deviceId, typeof label === 'string' ? label : '', enabled === true)
      return { ok: true as const, message: enabled ? 'Kopunca geri getirme açık' : 'Kopunca geri getirme kapalı' }
    }
  )

  ipcMain.handle('ios:restore', async (_event, deviceId: string, label?: string) => {
    try {
      if (!deviceId || typeof deviceId !== 'string') {
        return {
          ok: false as const,
          code: 'INVALID_DEVICE',
          message: 'Geçersiz iOS cihaz kimliği'
        }
      }
      const result = await restoreIosMirror(deviceId, label)
      return { ok: true as const, message: result.message }
    } catch (error) {
      return toApiError(error, 'IOS_RESTORE_FAILED')
    }
  })

  ipcMain.handle('ios:pair', async (_event, udid: string) => {
    try {
      if (!udid || typeof udid !== 'string') {
        return {
          ok: false as const,
          code: 'INVALID_DEVICE',
          message: 'Geçersiz iOS cihaz kimliği'
        }
      }
      const result = await requestIosPair(udid)
      return { ok: true as const, path: udid, message: result.message }
    } catch (error) {
      return toApiError(error, 'IOS_PAIR_FAILED')
    }
  })

  ipcMain.handle('wireless:connect', async (_event, endpoint: string) => {
    try {
      const result = await connectWireless(endpoint)
      return { ok: true as const, endpoint: result.endpoint, message: result.message }
    } catch (error) {
      return toApiError(error, 'WIRELESS_CONNECT_FAILED')
    }
  })

  ipcMain.handle('wireless:pair', async (_event, endpoint: string, pairingCode: string) => {
    try {
      const result = await pairWireless(endpoint, pairingCode)
      return { ok: true as const, endpoint: result.endpoint, message: result.message }
    } catch (error) {
      return toApiError(error, 'WIRELESS_PAIR_FAILED')
    }
  })

  ipcMain.handle('wireless:disconnect', async (_event, endpoint?: string) => {
    try {
      const result = await disconnectWireless(endpoint)
      return { ok: true as const, endpoint: result.endpoint, message: result.message }
    } catch (error) {
      return toApiError(error, 'WIRELESS_DISCONNECT_FAILED')
    }
  })

  ipcMain.handle('android:send-files', async (_event, deviceId: string, filePaths: string[]) => {
    try {
      return await sendFilesToAndroid(deviceId, filePaths)
    } catch (error) {
      return toApiError(error, 'SEND_FILES_FAILED')
    }
  })

  ipcMain.handle('android:list-apps', async (_event, deviceId: string) => {
    try {
      return await listAndroidApps(deviceId)
    } catch (error) {
      return toApiError(error, 'APPS_LIST_FAILED')
    }
  })

  ipcMain.handle('wireless:tcpip', async (_event, deviceId: string, port?: number) => {
    try {
      const result = await enableTcpip(deviceId, port ?? 5555)
      return {
        ok: true as const,
        deviceId: result.deviceId,
        port: result.port,
        message: result.message
      }
    } catch (error) {
      return toApiError(error, 'WIRELESS_TCPIP_FAILED')
    }
  })

  ipcMain.handle(
    'media:screenshot',
    async (_event, deviceId: string, platform: DeviceInfo['platform']) => {
      try {
        if (!deviceId || typeof deviceId !== 'string') {
          return {
            ok: false as const,
            code: 'INVALID_DEVICE',
            message: 'Geçersiz cihaz kimliği'
          }
        }

        const result = await screenshotFor(deviceId, platform)
        return { ok: true as const, ...result }
      } catch (error) {
        return toApiError(error, 'SCREENSHOT_FAILED')
      }
    }
  )

  ipcMain.handle(
    'media:preview',
    async (_event, deviceId: string, platform: DeviceInfo['platform']) => {
      if (!deviceId || (platform !== 'android' && platform !== 'ios')) {
        return { ok: false as const, code: 'INVALID_DEVICE', message: 'Geçersiz cihaz' }
      }
      const preview = await captureDevicePreview(deviceId, platform)
      if (!preview) {
        return { ok: false as const, code: 'PREVIEW_EMPTY', message: 'Önizleme alınamadı' }
      }
      return { ok: true as const, image: preview.image, locked: preview.locked }
    }
  )

  ipcMain.handle('media:record-start', async (_event, deviceId: string) => {
    try {
      if (!deviceId || typeof deviceId !== 'string') {
        return {
          ok: false as const,
          code: 'INVALID_DEVICE',
          message: 'Geçersiz cihaz kimliği'
        }
      }
      if (isRecordingFor(deviceId)) {
        const result = await stopRecordingFor(deviceId)
        return {
          ok: true as const,
          stopped: true,
          path: result.path,
          message: `Kayıt kaydedildi: ${result.path}`
        }
      }
      startRecordingFor(deviceId)
      return {
        ok: true as const,
        path: getCaptureDir(),
        message: 'Kayıt başladı (bitince İndirilenler/Scryno’ya iner)'
      }
    } catch (error) {
      return toApiError(error, 'RECORD_START_FAILED')
    }
  })

  ipcMain.handle('media:record-stop', async (_event, deviceId: string) => {
    try {
      if (!deviceId || typeof deviceId !== 'string') {
        return {
          ok: false as const,
          code: 'INVALID_DEVICE',
          message: 'Geçersiz cihaz kimliği'
        }
      }
      const result = await stopRecordingFor(deviceId)
      return {
        ok: true as const,
        path: result.path,
        message: `Kayıt kaydedildi: ${result.path}`
      }
    } catch (error) {
      return toApiError(error, 'RECORD_STOP_FAILED')
    }
  })

  ipcMain.handle(
    'media:save-screenshot-data',
    async (_event, data: Uint8Array, deviceId?: string) => {
      try {
        const outPath = makeCapturePath('screenshot', 'png')
        await writeFile(outPath, Buffer.from(data))
        const copiedToClipboard = copyImageFileToClipboard(outPath)
        if (deviceId) {
          broadcastToolbarStatus(deviceId, {
            recording: isRecordingFor(deviceId),
            message: copiedToClipboard
              ? 'Kaydedildi · panoya kopyalandı'
              : 'Ekran görüntüsü kaydedildi',
            kind: 'ok'
          })
        }
        return {
          ok: true as const,
          path: outPath,
          message: copiedToClipboard
            ? `Screenshot kaydedildi ve panoya kopyalandı: ${outPath}`
            : `Screenshot kaydedildi: ${outPath}`,
          copiedToClipboard
        }
      } catch (error) {
        return toApiError(error, 'SCREENSHOT_SAVE_FAILED')
      }
    }
  )

  ipcMain.handle(
    'media:save-recording-data',
    async (_event, data: Uint8Array, extension: string, deviceId?: string) => {
      try {
        const ext = extension === 'mp4' ? 'mp4' : 'webm'
        const outPath = makeCapturePath('recording', ext)
        await writeFile(outPath, Buffer.from(data))
        if (deviceId) {
          broadcastToolbarStatus(deviceId, {
            recording: isRecordingFor(deviceId),
            message: 'Video kaydedildi',
            kind: 'ok'
          })
        }
        return {
          ok: true as const,
          path: outPath,
          message: `Video kaydedildi: ${outPath}`,
          stopped: true
        }
      } catch (error) {
        return toApiError(error, 'RECORD_SAVE_FAILED')
      }
    }
  )

  ipcMain.handle(
    'media:capture-dual-sources',
    async (_event, androidId: string, iosId: string, androidName?: string, iosName?: string) => {
      try {
        return await captureDualRawSources(androidId, iosId, androidName, iosName)
      } catch (error) {
        return toApiError(error, 'DUAL_CAPTURE_FAILED')
      }
    }
  )

  ipcMain.handle('media:save-dual-screenshot', async (_event, data: Uint8Array) => {
    try {
      return await saveDualScreenshot(data)
    } catch (error) {
      return toApiError(error, 'DUAL_SAVE_FAILED')
    }
  })

  const discardTemp = async (path?: string): Promise<void> => {
    if (path && existsSync(path)) {
      try {
        await unlink(path)
      } catch {
        try {
          rmSync(path, { force: true })
        } catch {
          // ignore
        }
      }
    }
  }

  let dualStopping: Promise<unknown> | null = null

  const stopDualAndMerge = async (androidId: string, iosId: string) => {
    if (dualStopping) {
      return dualStopping
    }
    const targetAndroid = resolveTargetDeviceId(androidId)
    const targetIos = resolveTargetDeviceId(iosId)
    dualStopping = (async () => {
      let androidPath: string | undefined
      let iosPath: string | undefined
      try {
        console.log(`[DualRecording] Stopping recordings: android=${targetAndroid}, ios=${targetIos}...`)
        closeAllMirrorOverlays()
        await setAndroidAnnotations(targetAndroid, false)
        const [androidRes, iosRes] = await Promise.allSettled([
          stopRecordingFor(targetAndroid, true),
          stopRecordingFor(targetIos, true)
        ])
        if (androidRes.status === 'rejected') {
          console.error('[DualRecording] Android stop failed:', androidRes.reason)
        }
        if (iosRes.status === 'rejected') {
          console.error('[DualRecording] iOS stop failed:', iosRes.reason)
        }
        androidPath = androidRes.status === 'fulfilled' ? androidRes.value.path : undefined
        iosPath = iosRes.status === 'fulfilled' ? iosRes.value.path : undefined
        if (!androidPath || !iosPath) {
          throw new Error(
            `Kayıtlardan biri alınamadı: android=${androidPath ? 'ok' : 'hata'}, ios=${iosPath ? 'ok' : 'hata'}`
          )
        }

        console.log(`[DualRecording] Merging ${androidPath} and ${iosPath}...`)
        const merged = await mergeDualVideos(androidPath, iosPath)
        console.log(`[DualRecording] Merged successfully: ${merged.path}`)
        shell.showItemInFolder(merged.path)
        for (const id of [targetAndroid, targetIos, androidId, iosId]) {
          broadcastToolbarStatus(id, {
            recording: false,
            message: 'Yan yana tek video kaydedildi!',
            kind: 'ok'
          })
        }
        return {
          ok: true as const,
          path: merged.path,
          message: `Yan yana tek video kaydedildi: ${merged.path}`,
          stopped: true
        }
      } catch (error) {
        console.error('[DualRecording] Merge failed:', error)
        const saved = preserveDualSources([androidPath, iosPath])
        androidPath = undefined
        iosPath = undefined
        if (saved.length > 0) {
          shell.showItemInFolder(saved[0])
          for (const id of [targetAndroid, targetIos, androidId, iosId]) {
            broadcastToolbarStatus(id, {
              recording: false,
              message: 'Birleştirilemedi · ayrı kayıtlar kaydedildi',
              kind: 'error'
            })
          }
          const base = (error as { message?: string }).message || 'Birleştirme başarısız'
          return toApiError(
            Object.assign(new Error(`${base} · Ayrı kayıtlar kaydedildi: ${saved.join(', ')}`), {
              code: 'DUAL_RECORD_STOP_FAILED'
            }),
            'DUAL_RECORD_STOP_FAILED'
          )
        }
        return toApiError(error, 'DUAL_RECORD_STOP_FAILED')
      } finally {
        await discardTemp(androidPath)
        await discardTemp(iosPath)
        clearDualRecordingActive()
        dualStopping = null
      }
    })()
    return dualStopping
  }

  ipcMain.handle('media:dual-recording-state', () => ({
    recording: isDualRecordingActive() || dualStopping !== null
  }))

  ipcMain.handle(
    'media:start-dual-recording',
    async (_event, androidId: string, iosId: string) => {
      const targetAndroid = resolveTargetDeviceId(androidId)
      const targetIos = resolveTargetDeviceId(iosId)
      // Single source of truth lives here; a stale toolbar click turns into a stop.
      if (isDualRecordingActive()) {
        return stopDualAndMerge(targetAndroid, targetIos)
      }
      setDualRecordingActive(targetAndroid, targetIos)
      let androidStarted = false
      try {
        console.log(`[DualRecording] Starting dual recording for ${targetAndroid} and ${targetIos}...`)
        if (isIphoneTarget(targetIos)) {
          void activateIphoneMirroring().catch(() => undefined)
        }
        startRecordingFor(targetAndroid, true)
        androidStarted = true
        startRecordingFor(targetIos, true)
        return { ok: true as const, path: '', message: 'Eşzamanlı kayıt başladı' }
      } catch (error) {
        console.error('[DualRecording] Start failed:', error)
        if (androidStarted) {
          const res = await stopRecordingFor(targetAndroid, true).catch(() => null)
          await discardTemp(res?.path)
        }
        clearDualRecordingActive()
        return toApiError(error, 'DUAL_RECORD_START_FAILED')
      }
    }
  )

  ipcMain.handle(
    'media:stop-dual-recording',
    async (_event, androidId: string, iosId: string) => {
      if (!isDualRecordingActive() && !dualStopping) {
        return { ok: true as const, path: '', message: 'Aktif dual kayıt yok', stopped: true }
      }
      return stopDualAndMerge(androidId, iosId)
    }
  )

  ipcMain.handle('dual-toolbar:open', async (_event, androidId: string, iosId: string) => {
    try {
      await openDualToolbar(androidId, iosId)
      return { ok: true as const }
    } catch (error) {
      return toApiError(error, 'DUAL_TOOLBAR_OPEN_FAILED')
    }
  })

  ipcMain.handle('dual-toolbar:close', async () => {
    closeDualToolbar()
    return { ok: true as const }
  })

  const toggleDualAnnotations = async (androidId?: string, iosId?: string) => {
    const isAndroidOpen = await isAndroidAnnotationsOpen(androidId)
    const resolvedIos = iosId && isIphoneMirroringSession(iosId) ? '@iphone-mirroring' : (iosId || '@iphone-mirroring')
    const isIosOpen = isMirrorOverlayOpen(resolvedIos)

    if (isAndroidOpen && isIosOpen) {
      await setAndroidAnnotations(androidId, false)
      closeAllMirrorOverlays()
      return { ok: true, open: false }
    }

    if (!isAndroidOpen) {
      await setAndroidAnnotations(androidId, true)
    }
    if (!isIosOpen) {
      await toggleMirrorOverlay(resolvedIos, '@iphone-mirroring')
    }
    return { ok: true, open: true }
  }

  const closeDualAnnotations = async (androidId?: string, _iosId?: string) => {
    await setAndroidAnnotations(androidId, false)
    closeAllMirrorOverlays()
    return { ok: true }
  }

  ipcMain.handle('dual:toggle-annotations', async (_event, payload?: { androidId?: string; iosId?: string }) => {
    return toggleDualAnnotations(payload?.androidId, payload?.iosId)
  })

  ipcMain.handle('dual:close-annotations', async (_event, payload?: { androidId?: string; iosId?: string }) => {
    return closeDualAnnotations(payload?.androidId, payload?.iosId)
  })

  ipcMain.handle('dual:align-mirrors', async () => {
    await alignMirrorWindows()
    return { ok: true }
  })

  ipcMain.handle('media:open-capture-dir', async () => {
    try {
      const dir = getCaptureDir()
      const openError = await shell.openPath(dir)
      if (openError) {
        return { ok: false as const, code: 'OPEN_PATH_FAILED', message: openError }
      }
      return { ok: true as const, path: dir, message: dir }
    } catch (error) {
      return toApiError(error, 'OPEN_PATH_FAILED')
    }
  })

  ipcMain.handle('media:reveal', async (_event, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return {
          ok: false as const,
          code: 'INVALID_PATH',
          message: 'Geçersiz dosya yolu'
        }
      }
      shell.showItemInFolder(filePath)
      return { ok: true as const, path: filePath, message: filePath }
    } catch (error) {
      return toApiError(error, 'REVEAL_FAILED')
    }
  })

  ipcMain.handle(
    'toolbar:orientation',
    async (_event, deviceId: string, orientation: ToolbarOrientation) => {
      if (!deviceId || (orientation !== 'horizontal' && orientation !== 'vertical')) {
        return { ok: false as const, message: 'Geçersiz istek' }
      }
      return setToolbarOrientation(deviceId, orientation)
    }
  )

  ipcMain.handle('mirror:toggle-overlay', async (_event, deviceId: string) => {
    return toggleMirrorOverlay(
      deviceId,
      isIphoneMirroringSession(deviceId) ? '@iphone-mirroring' : deviceId
    )
  })

  ipcMain.on('overlay:ignore-mouse-events', (event, ignore: boolean, forward?: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, { forward: Boolean(forward) })
    }
  })

  ipcMain.on('app:ready', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed() && !win.isVisible()) {
      win.show()
    }
  })
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) {
    return
  }
  if (process.platform === 'win32') {
    app.setAppUserModelId('app.scryno.desktop')
  }
  app.setAboutPanelOptions({
    applicationName: 'Scryno',
    applicationVersion: app.getVersion(),
    copyright: 'Ücretsiz Android ve iPhone yansıtma'
  })
  if ((process.platform === 'darwin') && !app.isPackaged) {
    app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  }

  killOrphanedScrcpy()
  setSessionExitListener((deviceId) => {
    if (isRecording(deviceId)) {
      void stopAdbRecording(deviceId).catch(() => undefined)
    }
    closeMirrorToolbar(deviceId)
    const remainingAndroid = listSessions()
    const remainingIos = listIosMirrorSessions()
    if (remainingAndroid.length === 0 || remainingIos.length === 0) {
      closeDualToolbar()
    }
  })

  setChromeActionHandler(handleChromeAction)
  setChromeActivateHandler((deviceId) => {
    void bringAllMirrorsToFront(deviceId)
  })
  setMirrorFocusHandler((deviceId) => {
    void bringAllMirrorsToFront(deviceId)
  })
  setChromeReadyHandler((deviceId) => {
    broadcastToolbarStatus(deviceId, { recording: isRecordingFor(deviceId) })
  })
  registerIpc()
  startDualToolbarWatcher()
  createWindow()

  app.on('activate', () => {
    if (ignoreNextActivate) {
      ignoreNextActivate = false
      return
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

const EXIT_FINALIZE_TIMEOUT_MS = 12_000
let finalizingRecordings: Promise<void> | null = null

/** Stops every active recording and keeps the files (temp dual parts move to Downloads/Scryno). */
function finalizeRecordingsBeforeExit(): Promise<void> {
  if (finalizingRecordings) {
    return finalizingRecordings
  }
  const tasks: Array<Promise<{ path: string }>> = []
  for (const session of listSessions()) {
    if (isMirrorRecording(session.deviceId)) {
      tasks.push(stopMirrorRecording(session.deviceId))
    }
  }
  for (const id of listAdbRecordings()) {
    tasks.push(stopAdbRecording(id))
  }
  for (const id of listIosRecordings()) {
    tasks.push(stopIosRecording(id))
  }
  for (const id of listIphoneMirroringRecordings()) {
    tasks.push(stopIphoneMirroringRecording(id))
  }
  if (tasks.length === 0) {
    return Promise.resolve()
  }
  console.log(`[Exit] Finalizing ${tasks.length} active recording(s)…`)
  const settled = Promise.allSettled(tasks).then((results) => {
    const paths = results
      .filter((r): r is PromiseFulfilledResult<{ path: string }> => r.status === 'fulfilled')
      .map((r) => r.value.path)
    preserveDualSources(paths)
    clearDualRecordingActive()
  })
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, EXIT_FINALIZE_TIMEOUT_MS))
  finalizingRecordings = Promise.race([settled, timeout]).finally(() => {
    finalizingRecordings = null
  })
  return finalizingRecordings
}

async function closeCompanionMirrors(): Promise<void> {
  try {
    await finalizeRecordingsBeforeExit()
  } catch {
    // Best-effort; teardown continues regardless.
  }
  closeAllMirrorOverlays()
  stopAllAdbRecordings()
  closeAllMirrorToolbars()
  stopAllSessions()
  return stopAllIosMirrors()
}

let quitting = false
let ignoreNextActivate = false

app.on('window-all-closed', () => {
  const openWindows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
  if (openWindows.length > 0) {
    return
  }
  if (process.platform !== 'darwin') {
    void closeCompanionMirrors().finally(() => app.quit())
  }
})

app.on('before-quit', (event) => {
  if (quitting) {
    return
  }
  event.preventDefault()
  quitting = true
  void closeCompanionMirrors().finally(() => app.quit())
})
