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
  setToolbarOrientation: (
    deviceId: string,
    orientation: 'horizontal' | 'vertical'
  ) => Promise<{ ok: true; orientation: 'horizontal' | 'vertical' } | { ok: false; message: string }>
  onToolbarStatus: (listener: (payload: ToolbarStatusPayload) => void) => () => void
}

const api: ScrynoApi = {
  androidMirror: {
    onVideo: (listener) => subscribe('android-mirror:video', listener),
    onAudio: (listener) => subscribe('android-mirror:audio', listener),
    onRecord: (listener) => subscribe('android-mirror:record', listener),
    ready: () => ipcRenderer.send('android-mirror:ready'),
    sendInput: (input) => ipcRenderer.send('android-mirror:input', input),
    reportSize: (width, height) => ipcRenderer.send('android-mirror:size', width, height),
    saveRecording: (data, extension) => ipcRenderer.invoke('android-mirror:recording', data, extension)
  },
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
  }
}

contextBridge.exposeInMainWorld('scryno', api)
