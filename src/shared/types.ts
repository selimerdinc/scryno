export type DevicePlatform = 'android' | 'ios'

export type DeviceConnectionState = 'device' | 'unauthorized' | 'offline' | 'unknown'

export interface DeviceInfo {
  id: string
  platform: DevicePlatform
  name: string
  model?: string
  product?: string
  state: DeviceConnectionState
  transport?: string
  /** True when adb serial looks like host:port (wireless). */
  wireless?: boolean
  /** iOS: idevicepair validate succeeded. */
  iosPaired?: boolean
  /** iOS: short hint for screenshot / DDI readiness. */
  iosScreenshotHint?: string
}

export interface WirelessEndpointResult {
  ok: true
  endpoint: string | null
  message: string
}

export type WirelessEndpointResponse = WirelessEndpointResult | ApiError

export interface EnableTcpipResult {
  ok: true
  deviceId: string
  port: number
  message: string
}

export type EnableTcpipResponse = EnableTcpipResult | ApiError

export type MirrorSource = 'display' | 'camera' | 'virtual'
export type MirrorOrientation = 'auto' | 'initial' | 'portrait' | 'landscape'

export interface AndroidAppInfo {
  name: string
  packageName: string
}

export interface AndroidAppsResult {
  ok: true
  apps: AndroidAppInfo[]
}

export type AndroidAppsResponse = AndroidAppsResult | ApiError

export interface MirrorOptions {
  maxSize?: number
  bitRate?: number
  maxFps?: number
  /** When true, scrcpy also writes an mp4 under Downloads/Scryno. */
  record?: boolean
  /** What scrcpy mirrors. Default is the phone display. */
  source?: MirrorSource
  /** Camera lens when source is camera. */
  cameraFacing?: 'back' | 'front'
  /** Package or app name started on a virtual display. */
  startApp?: string
  /** Locks capture independently from device rotation. */
  orientation?: MirrorOrientation
  /** Keep the virtual-display app alive by moving it to the phone when mirroring stops. */
  keepVirtualApp?: boolean
  /** Phone audio plays on the Mac. Default on. Requires Android 11+. */
  audio?: boolean
  /** Keep the phone awake while plugged in. Default on. */
  stayAwake?: boolean
  /** Sync clipboard text both ways. Default on. */
  clipboard?: boolean
}

export interface SendFilesResult {
  ok: true
  message: string
}

export interface IosActionResult {
  ok: true
  message: string
}

export type IosActionResponse = IosActionResult | ApiError

export type SendFilesResponse = SendFilesResult | ApiError

export type MirrorInput =
  | {
      kind: 'touch'
      action: number
      x: number
      y: number
      width: number
      height: number
      buttons: number
    }
  | {
      kind: 'scroll'
      x: number
      y: number
      width: number
      height: number
      horizontal: number
      vertical: number
    }
  | { kind: 'key'; action: number; keycode: number; metaState: number }
  | { kind: 'text'; text: string }
  | { kind: 'paste' }
  | { kind: 'back' }
  | { kind: 'notifications' }

export interface MirrorSessionInfo {
  deviceId: string
  pid: number
  startedAt: number
  recordingPath?: string
}

export interface CaptureFileResult {
  ok: true
  path: string
  message: string
  copiedToClipboard?: boolean
}

export type CaptureFileResponse = CaptureFileResult | ApiError

export interface PreviewResult {
  ok: true
  /** Null when the screen is dark (iPhone locked / display off). */
  image: string | null
  locked: boolean
}

export type PreviewResponse = PreviewResult | ApiError

export interface StartMirrorResult {
  ok: true
  session: MirrorSessionInfo
}

export interface StopMirrorResult {
  ok: true
  deviceId: string
}

export interface ApiError {
  ok: false
  code: string
  message: string
}

export type StartMirrorResponse = StartMirrorResult | ApiError
export type StopMirrorResponse = StopMirrorResult | ApiError

export interface ListDevicesResult {
  ok: true
  devices: DeviceInfo[]
  adbPath: string
  iosAvailable?: boolean
  iosMessage?: string
}

export type ListDevicesResponse = ListDevicesResult | ApiError

export interface IosSpikeResult {
  ok: true
  supported: boolean
  hostPlatform: string
  message: string
  devices: DeviceInfo[]
}

export type IosSpikeResponse = IosSpikeResult | ApiError
