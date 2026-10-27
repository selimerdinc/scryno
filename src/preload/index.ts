import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  AndroidAppsResponse,
  CaptureFileResponse,
  EnableTcpipResponse,
  IosActionResponse,
  IosSpikeResponse,
  ListDevicesResponse,
  MirrorInput,
  MirrorOptions,
  PreviewResponse,
  MirrorSessionInfo,
  SendFilesResponse,
  StartMirrorResponse,
  StopMirrorResponse,
  WirelessEndpointResponse
} from '../shared/types'

export interface ToolbarStatusPayload {
  recording: boolean
  message?: string
  kind?: 'ok' | 'error' | 'info'
}

export interface MirrorPacket {
  config: boolean
  key: boolean
  pts: number
  data: Uint8Array
}

export interface AndroidMirrorApi {
  onVideo: (listener: (packet: MirrorPacket) => void) => () => void
  onAudio: (listener: (packet: MirrorPacket) => void) => () => void
  onRecord: (listener: (action: 'start' | 'stop') => void) => () => void
  onToggleAnnotations: (listener: () => void) => () => void
  onSetAnnotations?: (listener: (payload: { open: boolean }) => void) => () => void
  ready: () => void
  sendInput: (input: MirrorInput) => void
  reportSize: (width: number, height: number) => void
  saveRecording: (data: Uint8Array, extension: string) => Promise<{ ok: boolean }>
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => {
    listener(payload)
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

export interface ScrynoApi {
  androidMirror: AndroidMirrorApi
  listDevices: () => Promise<ListDevicesResponse>
  startMirror: (
    deviceId: string,
    options?: MirrorOptions,
    platform?: 'android' | 'ios',
    label?: string
  ) => Promise<StartMirrorResponse>
  stopMirror: (deviceId: string) => Promise<StopMirrorResponse>
  listSessions: () => Promise<{ ok: true; sessions: MirrorSessionInfo[] }>
  iosSpike: () => Promise<IosSpikeResponse>
  iosPair: (udid: string) => Promise<CaptureFileResponse>
  enlargeIphone: () => Promise<IosActionResponse>
  restoreIphone: (deviceId: string, label?: string) => Promise<IosActionResponse>
  setIosAutoRestore: (deviceId: string, label: string, enabled: boolean) => Promise<IosActionResponse>
  wirelessConnect: (endpoint: string) => Promise<WirelessEndpointResponse>
  wirelessPair: (endpoint: string, pairingCode: string) => Promise<WirelessEndpointResponse>
  wirelessDisconnect: (endpoint?: string) => Promise<WirelessEndpointResponse>
  wirelessEnableTcpip: (deviceId: string, port?: number) => Promise<EnableTcpipResponse>
  listAndroidApps: (deviceId: string) => Promise<AndroidAppsResponse>
  filePath: (file: File) => string
  sendFiles: (deviceId: string, filePaths: string[]) => Promise<SendFilesResponse>
  takeScreenshot: (
    deviceId: string,
    platform: 'android' | 'ios'
  ) => Promise<CaptureFileResponse>
  capturePreview: (deviceId: string, platform: 'android' | 'ios') => Promise<PreviewResponse>
  openCaptureDir: () => Promise<CaptureFileResponse>
  revealCapture: (filePath: string) => Promise<CaptureFileResponse>
  startRecording: (deviceId: string) => Promise<CaptureFileResponse>
  stopRecording: (deviceId: string) => Promise<CaptureFileResponse>
  saveScreenshotData: (data: Uint8Array, deviceId?: string) => Promise<CaptureFileResponse>
  saveRecordingData: (
    data: Uint8Array,
    extension: string,
    deviceId?: string
  ) => Promise<CaptureFileResponse>
  captureDualSources: (
    androidId: string,
    iosId: string,
    androidName?: string,
    iosName?: string
  ) => Promise<import('../shared/types').DualScreenshotRawResponse>
  saveDualScreenshot: (data: Uint8Array) => Promise<CaptureFileResponse>
  startDualRecording: (androidId: string, iosId: string) => Promise<CaptureFileResponse>
  stopDualRecording: (androidId: string, iosId: string) => Promise<CaptureFileResponse>
  openDualToolbar: (androidId: string, iosId: string) => Promise<{ ok: boolean }>
  closeDualToolbar: () => Promise<{ ok: boolean }>
  toggleAndroidAnnotations: (deviceId?: string) => Promise<{ ok: boolean }>
  setAndroidAnnotations: (deviceId: string | undefined, open: boolean) => Promise<boolean>
  toggleDualAnnotations: (androidId?: string, iosId?: string) => Promise<{ ok: boolean; open?: boolean }>
  closeDualAnnotations: (androidId?: string, iosId?: string) => Promise<{ ok: boolean }>
  alignDualMirrors: () => Promise<{ ok: boolean }>
  toggleOverlay: (deviceId: string) => Promise<{ ok: boolean; open?: boolean }>
  setIgnoreMouseEvents: (ignore: boolean, forward?: boolean) => void
  setToolbarOrientation: (
    deviceId: string,
    orientation: 'horizontal' | 'vertical'
  ) => Promise<{ ok: true; orientation: 'horizontal' | 'vertical' } | { ok: false; message: string }>
  onToolbarStatus: (listener: (payload: ToolbarStatusPayload) => void) => () => void
  notifyReady?: () => void
}

const api: ScrynoApi = {
  androidMirror: {
    onVideo: (listener) => subscribe('android-mirror:video', listener),
    onAudio: (listener) => subscribe('android-mirror:audio', listener),
    onRecord: (listener) => subscribe('android-mirror:record', listener),
    onToggleAnnotations: (listener) => subscribe('android-mirror:toggle-annotations', listener),
    onSetAnnotations: (listener) => subscribe('android-mirror:set-annotations', listener),
    ready: () => ipcRenderer.send('android-mirror:ready'),
    sendInput: (input) => ipcRenderer.send('android-mirror:input', input),
    reportSize: (width, height) => ipcRenderer.send('android-mirror:size', width, height),
    saveRecording: (data, extension) => ipcRenderer.invoke('android-mirror:recording', data, extension)
  },
  toggleAndroidAnnotations: (deviceId) => ipcRenderer.invoke('android-mirror:toggle-annotations', deviceId),
  setAndroidAnnotations: (deviceId, open) => ipcRenderer.invoke('android-mirror:set-annotations', deviceId, open),
  toggleDualAnnotations: (androidId, iosId) =>
    ipcRenderer.invoke('dual:toggle-annotations', { androidId, iosId }),
  closeDualAnnotations: (androidId, iosId) =>
    ipcRenderer.invoke('dual:close-annotations', { androidId, iosId }),
  alignDualMirrors: () => ipcRenderer.invoke('dual:align-mirrors'),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  startMirror: (deviceId, options, platform, label) =>
    ipcRenderer.invoke('mirror:start', deviceId, options, platform, label),
  stopMirror: (deviceId) => ipcRenderer.invoke('mirror:stop', deviceId),
  listSessions: () => ipcRenderer.invoke('mirror:sessions'),
  iosSpike: () => ipcRenderer.invoke('ios:spike'),
  iosPair: (udid) => ipcRenderer.invoke('ios:pair', udid),
  enlargeIphone: () => ipcRenderer.invoke('ios:enlarge'),
  restoreIphone: (deviceId, label) => ipcRenderer.invoke('ios:restore', deviceId, label),
  setIosAutoRestore: (deviceId, label, enabled) =>
    ipcRenderer.invoke('ios:auto-restore', deviceId, label, enabled),
  wirelessConnect: (endpoint) => ipcRenderer.invoke('wireless:connect', endpoint),
  wirelessPair: (endpoint, pairingCode) =>
    ipcRenderer.invoke('wireless:pair', endpoint, pairingCode),
  wirelessDisconnect: (endpoint) => ipcRenderer.invoke('wireless:disconnect', endpoint),
  wirelessEnableTcpip: (deviceId, port) => ipcRenderer.invoke('wireless:tcpip', deviceId, port),
  listAndroidApps: (deviceId) => ipcRenderer.invoke('android:list-apps', deviceId),
  filePath: (file) => webUtils.getPathForFile(file),
  sendFiles: (deviceId, filePaths) => ipcRenderer.invoke('android:send-files', deviceId, filePaths),
  takeScreenshot: (deviceId, platform) =>
    ipcRenderer.invoke('media:screenshot', deviceId, platform),
  capturePreview: (deviceId, platform) => ipcRenderer.invoke('media:preview', deviceId, platform),
  openCaptureDir: () => ipcRenderer.invoke('media:open-capture-dir'),
  revealCapture: (filePath) => ipcRenderer.invoke('media:reveal', filePath),
  startRecording: (deviceId) => ipcRenderer.invoke('media:record-start', deviceId),
  stopRecording: (deviceId) => ipcRenderer.invoke('media:record-stop', deviceId),
  saveScreenshotData: (data, deviceId) =>
    ipcRenderer.invoke('media:save-screenshot-data', data, deviceId),
  saveRecordingData: (data, extension, deviceId) =>
    ipcRenderer.invoke('media:save-recording-data', data, extension, deviceId),
  captureDualSources: (androidId, iosId, androidName, iosName) =>
    ipcRenderer.invoke('media:capture-dual-sources', androidId, iosId, androidName, iosName),
  saveDualScreenshot: (data) => ipcRenderer.invoke('media:save-dual-screenshot', data),
  startDualRecording: (androidId, iosId) =>
    ipcRenderer.invoke('media:start-dual-recording', androidId, iosId),
  stopDualRecording: (androidId, iosId) =>
    ipcRenderer.invoke('media:stop-dual-recording', androidId, iosId),
  openDualToolbar: (androidId, iosId) =>
    ipcRenderer.invoke('dual-toolbar:open', androidId, iosId),
  closeDualToolbar: () => ipcRenderer.invoke('dual-toolbar:close'),
  toggleOverlay: (deviceId) => ipcRenderer.invoke('mirror:toggle-overlay', deviceId),
  setIgnoreMouseEvents: (ignore, forward) =>
    ipcRenderer.send('overlay:ignore-mouse-events', ignore, forward),
  setToolbarOrientation: (deviceId, orientation) =>
    ipcRenderer.invoke('toolbar:orientation', deviceId, orientation),
  onToolbarStatus: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: ToolbarStatusPayload): void => {
      listener(payload)
    }
    ipcRenderer.on('toolbar:status', handler)
    return () => {
      ipcRenderer.removeListener('toolbar:status', handler)
    }
  },
  notifyReady: () => ipcRenderer.send('app:ready')
}

contextBridge.exposeInMainWorld('scryno', api)
