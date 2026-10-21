import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { listAndroidApps, listAndroidDevices, sendFilesToAndroid } from './android/adb'
import {
  getSession,
  isMirrorRecording,
  killOrphanedScrcpy,
  listSessions,
  setSessionExitListener,
  startMirrorRecording,
  startScrcpySession,
  stopAllSessions,
  stopMirrorRecording,
  stopScrcpySession
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
import { isIosRecording, startIosRecording, stopIosRecording } from './ios/recording'
import {
  captureIphoneMirroringScreenshot,
  enlargeIphoneMirroring,
  isIphoneMirroringRecording,
  startIphoneMirroringRecording,
  stopIphoneMirroringRecording
} from './ios/iphoneMirroring'
import { requestIosPair } from './ios/readiness'
import { probeUsbmux } from './ios/usbmux'
import { getCaptureDir } from './media/capturePaths'
import {
  isRecording,
  startAdbRecording,
  stopAdbRecording,
  stopAllAdbRecordings
} from './media/recording'
import { copyImageFileToClipboard } from './media/clipboardImage'
import { captureDevicePreview } from './media/preview'
import { takeAndroidScreenshot, takeIosScreenshot } from './media/screenshot'
import {
  broadcastToolbarStatus,
  closeAllMirrorToolbars,
  closeMirrorToolbar,
  setToolbarOrientation,
  type ToolbarOrientation
} from './ui/mirrorToolbar'
import { setChromeActionHandler, type ChromeAction } from './ui/nativeChrome'
import { alignMirrorWindows } from './ui/mirrorLayout'
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
    void alignMirrorWindows()
  }, 900)
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

  win.on('ready-to-show', () => {
    win.show()
  })

  // Closing the hub closes the Android window and iPhone Mirroring with it.
  // Quitting iPhone Mirroring hands focus back, which would reopen the hub.
  win.on('close', () => {
    ignoreNextActivate = true
    void closeCompanionMirrors()
  })

  win.on('closed', () => {
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

function isRecordingFor(deviceId: string): boolean {
  return (
    isIphoneMirroringRecording(deviceId) ||
    isIosRecording(deviceId) ||
    isMirrorRecording(deviceId) ||
    isRecording(deviceId)
  )
}

async function stopMirrorFor(deviceId: string): Promise<void> {
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
}

async function screenshotFor(
  deviceId: string,
  platform: DeviceInfo['platform']
): Promise<{ path: string; message: string; copiedToClipboard: boolean }> {
  const result = isIphoneMirroringSession(deviceId)
    ? await captureIphoneMirroringScreenshot()
    : platform === 'ios'
      ? await takeIosScreenshot(deviceId)
      : await takeAndroidScreenshot(deviceId)

  const copiedToClipboard = copyImageFileToClipboard(result.path)
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

function startRecordingFor(deviceId: string): void {
  const iosHub = getIosFrameHub(deviceId)
  if (isIphoneMirroringSession(deviceId)) {
    startIphoneMirroringRecording(deviceId)
  } else if (iosHub) {
    startIosRecording(deviceId, iosHub)
  } else if (getSession(deviceId)) {
    startMirrorRecording(deviceId)
  } else {
    startAdbRecording(deviceId)
  }
  broadcastToolbarStatus(deviceId, { recording: true, message: 'Kayıt başladı', kind: 'info' })
}

async function stopRecordingFor(deviceId: string): Promise<{ path: string }> {
  try {
    const result = isIphoneMirroringRecording(deviceId)
      ? await stopIphoneMirroringRecording(deviceId)
      : isIosRecording(deviceId)
        ? await stopIosRecording(deviceId)
        : isMirrorRecording(deviceId)
          ? await stopMirrorRecording(deviceId)
          : await stopAdbRecording(deviceId)
    broadcastToolbarStatus(deviceId, {
      recording: false,
      message: 'Kayıt İndirilenler’e alındı',
      kind: 'ok'
    })
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

function handleChromeAction(deviceId: string, action: ChromeAction): void {
  const platform: DeviceInfo['platform'] = isIosMirroring(deviceId) ? 'ios' : 'android'
  const run = async (): Promise<void> => {
    switch (action) {
      case 'screenshot':
        await screenshotFor(deviceId, platform)
        break
      case 'record':
        if (isRecordingFor(deviceId)) {
          const result = await stopRecordingFor(deviceId)
          shell.showItemInFolder(result.path)
        } else {
          startRecordingFor(deviceId)
        }
        break
      case 'folder':
        await shell.openPath(getCaptureDir())
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
          return { ok: true as const, session }
        }
        const session = await startScrcpySession(deviceId, options ?? {}, label || deviceId)
        scheduleMirrorAlign()
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
  })

  setChromeActionHandler(handleChromeAction)
  registerIpc()
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

function closeCompanionMirrors(): Promise<void> {
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
