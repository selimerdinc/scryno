import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { DeviceCard } from './components/DeviceCard'
import { Drawer } from './components/Drawer'
import { IosControls, type IosOptions } from './components/IosControls'
import { IosGuide } from './components/IosGuide'
import { PlatformSection } from './components/PlatformSection'
import { QualityControl } from './components/QualityControl'
import { WirelessPanel } from './components/WirelessPanel'
import { IconFolder, IconRefresh, IconShield, IconWifi } from './components/icons'
import type { DeviceInfo, MirrorOptions, MirrorSessionInfo } from '../../shared/types'
import logoUrl from './assets/logo.png'

type ToastKind = 'ok' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  text: string
}

type DrawerKind = 'wireless' | 'ios' | null

const MIRROR_OPTIONS_KEY = 'scryno.android.mirror-options'
const IOS_OPTIONS_KEY = 'scryno.ios.mirror-options'

const DEFAULT_IOS_OPTIONS: IosOptions = {
  enlargeOnStart: true,
  recordOnStart: false,
  restoreOnClose: true
}

function loadIosOptions(): IosOptions {
  try {
    const raw = localStorage.getItem(IOS_OPTIONS_KEY)
    if (!raw) {
      return DEFAULT_IOS_OPTIONS
    }
    const stored = JSON.parse(raw) as Partial<IosOptions>
    return {
      enlargeOnStart:
        typeof stored.enlargeOnStart === 'boolean'
          ? stored.enlargeOnStart
          : DEFAULT_IOS_OPTIONS.enlargeOnStart,
      // Otomatik kayıt default olarak her zaman kapalı başlar
      recordOnStart: false,
      restoreOnClose:
        typeof stored.restoreOnClose === 'boolean'
          ? stored.restoreOnClose
          : DEFAULT_IOS_OPTIONS.restoreOnClose
    }
  } catch {
    return DEFAULT_IOS_OPTIONS
  }
}

const DEFAULT_MIRROR_OPTIONS: MirrorOptions = {
  maxSize: 1280,
  bitRate: 8_000_000,
  maxFps: 60,
  record: false,
  source: 'display',
  cameraFacing: 'back',
  startApp: '',
  orientation: 'auto',
  keepVirtualApp: false,
  audio: true,
  stayAwake: true,
  clipboard: true
}

function loadMirrorOptions(): MirrorOptions {
  try {
    const stored = JSON.parse(localStorage.getItem(MIRROR_OPTIONS_KEY) ?? '{}') as MirrorOptions &
      Record<string, unknown>
    for (const removed of [
      'keepDeviceAudio',
      'turnScreenOff',
      'powerOffOnClose',
      'showTouches',
      'alwaysOnTop'
    ]) {
      delete stored[removed]
    }
    return {
      ...DEFAULT_MIRROR_OPTIONS,
      ...stored,
      // Otomatik kayıt default olarak her zaman kapalı başlar
      record: false
    }
  } catch {
    return DEFAULT_MIRROR_OPTIONS
  }
}

export default function App(): JSX.Element {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [sessions, setSessions] = useState<MirrorSessionInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [adbPath, setAdbPath] = useState('')
  const [adbError, setAdbError] = useState('')
  const [iosNote, setIosNote] = useState('')
  const [iosAvailable, setIosAvailable] = useState(false)
  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastSeq = useRef(0)
  const [options, setOptions] = useState<MirrorOptions>(loadMirrorOptions)
  const [iosOptions, setIosOptions] = useState<IosOptions>(loadIosOptions)

  const notify = useCallback((kind: ToastKind, text: string) => {
    toastSeq.current += 1
    const id = toastSeq.current
    setToasts((current) => [...current.slice(-2), { id, kind, text }])
    window.setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      kind === 'error' ? 7000 : 4000
    )
  }, [])

  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.deviceId, session])),
    [sessions]
  )

  const androidDevices = useMemo(
    () => devices.filter((device) => device.platform === 'android'),
    [devices]
  )

  const iosDevices = useMemo(() => devices.filter((device) => device.platform === 'ios'), [devices])

  const firstUsbAndroidId = useMemo(
    () =>
      androidDevices.find((device) => device.state === 'device' && !device.wireless)?.id ?? null,
    [androidDevices]
  )

  const nameOf = useCallback(
    (deviceId: string) => devices.find((device) => device.id === deviceId)?.name ?? deviceId,
    [devices]
  )

  const refreshSessions = useCallback(async () => {
    const result = await window.scryno.listSessions()
    if (result.ok) {
      setSessions(result.sessions)
    }
  }, [])

  const refreshDevices = useCallback(async () => {
    setRefreshing(true)
    try {
      const result = await window.scryno.listDevices()
      if (!result.ok) {
        setDevices([])
        setAdbError(result.message)
        return
      }
      setAdbError('')
      setAdbPath(result.adbPath)
      setDevices(result.devices)
      setIosNote(result.iosMessage ?? '')
      setIosAvailable(Boolean(result.iosAvailable))
    } finally {
      await refreshSessions()
      setLoaded(true)
      setRefreshing(false)
    }
  }, [refreshSessions])

  const runAction = useCallback(
    async (action: () => Promise<{ ok: boolean; message?: string }>, success?: string) => {
      setBusy(true)
      try {
        const result = await action()
        if (!result.ok) {
          notify('error', result.message ?? 'İşlem başarısız.')
          return false
        }
        if (success ?? result.message) {
          notify('ok', (success ?? result.message) as string)
        }
        return true
      } finally {
        setBusy(false)
      }
    },
    [notify]
  )

  const startMirror = useCallback(
    async (deviceId: string) => {
      const device = devices.find((item) => item.id === deviceId)
      const ok = await runAction(
        () => window.scryno.startMirror(deviceId, options, device?.platform, device?.name),
        `${nameOf(deviceId)} yansıtılıyor`
      )
      if (ok) {
        await refreshSessions()
      }
      if (ok && device?.platform === 'ios') {
        if (iosOptions.enlargeOnStart) {
          await runAction(() => window.scryno.enlargeIphone())
        }
        if (iosOptions.recordOnStart) {
          const recording = await window.scryno.startRecording(deviceId)
          if (!recording.ok) {
            notify('error', recording.message)
          }
        }
      }
    },
    [devices, options, iosOptions, nameOf, runAction, refreshSessions, notify]
  )

  const stopMirror = useCallback(
    async (deviceId: string) => {
      const ok = await runAction(
        () => window.scryno.stopMirror(deviceId),
        `${nameOf(deviceId)} yansıtması durdu`
      )
      if (ok) {
        await refreshSessions()
      }
    },
    [nameOf, runAction, refreshSessions]
  )

  const takeScreenshot = useCallback(
    async (deviceId: string, platform: DeviceInfo['platform']) => {
      setBusy(true)
      try {
        const result = await window.scryno.takeScreenshot(deviceId, platform)
        if (!result.ok) {
          notify('error', result.message)
          return
        }
        notify('ok', result.message)
        await window.scryno.revealCapture(result.path)
      } finally {
        setBusy(false)
      }
    },
    [notify]
  )

  const wirelessConnect = useCallback(
    async (endpoint: string) => {
      if (await runAction(() => window.scryno.wirelessConnect(endpoint))) {
        await refreshDevices()
      }
    },
    [runAction, refreshDevices]
  )

  const wirelessDisconnect = useCallback(
    async (endpoint?: string) => {
      if (await runAction(() => window.scryno.wirelessDisconnect(endpoint))) {
        await refreshDevices()
      }
    },
    [runAction, refreshDevices]
  )

  const pairIos = useCallback(
    async (udid: string) => {
      if (await runAction(() => window.scryno.iosPair(udid))) {
        await refreshDevices()
      }
    },
    [runAction, refreshDevices]
  )

  const openCaptureDir = useCallback(async () => {
    const result = await window.scryno.openCaptureDir()
    if (!result.ok) {
      notify('error', result.message)
    }
  }, [notify])

  const closeDrawer = useCallback(() => setDrawer(null), [])

  useEffect(() => {
    localStorage.setItem(MIRROR_OPTIONS_KEY, JSON.stringify(options))
  }, [options])

  useEffect(() => {
    localStorage.setItem(IOS_OPTIONS_KEY, JSON.stringify(iosOptions))
  }, [iosOptions])

  useEffect(() => {
    const device = iosDevices.find((item) => item.state === 'device')
    if (!device) {
      return
    }
    void window.scryno.setIosAutoRestore(device.id, device.name, iosOptions.restoreOnClose)
  }, [iosDevices, iosOptions.restoreOnClose])

  useEffect(() => {
    const blockFileNavigation = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
      }
    }
    window.addEventListener('dragover', blockFileNavigation)
    window.addEventListener('drop', blockFileNavigation)
    return () => {
      window.removeEventListener('dragover', blockFileNavigation)
      window.removeEventListener('drop', blockFileNavigation)
    }
  }, [])

  useEffect(() => {
    window.scryno?.notifyReady?.()
  }, [])

  useEffect(() => {
    void refreshDevices()
    const timer = window.setInterval(() => {
      void refreshDevices()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refreshDevices])

  const renderCards = (list: DeviceInfo[]): JSX.Element[] =>
    list.map((device) => (
      <DeviceCard
        key={device.id}
        device={device}
        session={sessionsById.get(device.id)}
        busy={busy}
        onStart={(deviceId) => void startMirror(deviceId)}
        onStop={(deviceId) => void stopMirror(deviceId)}
        onScreenshot={(deviceId, platform) => void takeScreenshot(deviceId, platform)}
        onEnableTcpip={(deviceId) =>
          void runAction(() => window.scryno.wirelessEnableTcpip(deviceId))
        }
        onPairIos={(udid) => void pairIos(udid)}
        onSendFiles={
          device.platform === 'android'
            ? (deviceId, filePaths) =>
                void runAction(() => window.scryno.sendFiles(deviceId, filePaths))
            : undefined
        }
      />
    ))

  const liveIn = (list: DeviceInfo[]): number =>
    list.filter((device) => sessionsById.has(device.id)).length

  return (
    <div className="app">
      <div className="aurora" aria-hidden="true" />

      <header className="titlebar">
        <div className="brand">
          <img className="brand-mark" src={logoUrl} alt="" aria-hidden="true" draggable={false} />
          <div>
            <h1>Scryno</h1>
            <p>Android ve iPhone yansıtma</p>
          </div>
        </div>

        <div className="titlebar-actions">
          {sessions.length > 0 ? (
            <div className="live-summary">
              <span className="status-dot" />
              {sessions.length} canlı oturum
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            title="İndirilenler/Scryno klasörünü aç"
            onClick={() => void openCaptureDir()}
          >
            <IconFolder size={16} />
            Kayıtlar
          </button>
          <button
            type="button"
            className={`btn btn-icon${refreshing ? ' spinning' : ''}`}
            title="Cihazları yenile"
            aria-label="Cihazları yenile"
            onClick={() => void refreshDevices()}
          >
            <IconRefresh size={16} />
          </button>
        </div>
      </header>

      <main className="hub">
        {!loaded ? (
          <div className="hub-loading">
            <div className="loader" />
            Cihazlar aranıyor…
          </div>
        ) : (
          <>
            <PlatformSection
              platform="android"
              title="Android"
              tagline="Scryno penceresinde · 60 fps · tam kontrol"
              count={androidDevices.length}
              liveCount={liveIn(androidDevices)}
              actions={
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setDrawer('wireless')}
                >
                  <IconWifi size={16} />
                  Kablosuz bağlan
                </button>
              }
              footer={
                <QualityControl
                  options={options}
                  busy={busy}
                  deviceId={androidDevices.find((device) => device.state === 'device')?.id ?? null}
                  onChange={setOptions}
                />
              }
              empty={
                <>
                  <div className="ghost-phone" />
                  <h3>Android cihaz bağlı değil</h3>
                  <p>USB hata ayıklamayı açıp kabloyla bağla ya da aynı Wi‑Fi üzerinden bağlan.</p>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setDrawer('wireless')}
                  >
                    <IconWifi size={16} />
                    Kablosuz bağlan
                  </button>
                </>
              }
            >
              {renderCards(androidDevices)}
            </PlatformSection>

            <PlatformSection
              platform="ios"
              title="iPhone"
              tagline="iPhone Mirroring · dokunmatik ve klavye"
              count={iosDevices.length}
              liveCount={liveIn(iosDevices)}
              actions={
                <button type="button" className="btn btn-ghost" onClick={() => setDrawer('ios')}>
                  <IconShield size={16} />
                  Kurulum
                </button>
              }
              footer={
                iosDevices.length > 0 ? (
                  <IosControls
                    busy={busy}
                    ready={iosDevices.some((device) => device.state === 'device')}
                    options={iosOptions}
                    onChange={setIosOptions}
                    onEnlarge={() => void runAction(() => window.scryno.enlargeIphone())}
                    onRestore={() => {
                      const device =
                        iosDevices.find(
                          (item) => sessionsById.has(item.id) && item.state === 'device'
                        ) ?? iosDevices.find((item) => item.state === 'device')
                      if (!device) {
                        return
                      }
                      void (async () => {
                        if (
                          await runAction(() => window.scryno.restoreIphone(device.id, device.name))
                        ) {
                          await refreshSessions()
                        }
                      })()
                    }}
                  />
                ) : undefined
              }
              empty={
                <>
                  <div className="ghost-phone" />
                  <h3>iPhone bağlı değil</h3>
                  <p>Kabloyla bağla ve telefonda “Bu bilgisayara güven” dokun.</p>
                  <button type="button" className="btn btn-ghost" onClick={() => setDrawer('ios')}>
                    <IconShield size={16} />
                    Kurulum rehberi
                  </button>
                </>
              }
            >
              {renderCards(iosDevices)}
            </PlatformSection>
          </>
        )}
      </main>

      <footer className="statusbar">
        <span className={`diag ${adbError ? 'bad' : 'good'}`} title={adbError || adbPath}>
          <span className="diag-dot" />
          ADB {adbError ? 'bulunamadı' : 'hazır'}
        </span>
        <span className={`diag ${iosAvailable ? 'good' : 'bad'}`} title={iosNote}>
          <span className="diag-dot" />
          iOS araçları {iosAvailable ? 'hazır' : 'eksik'}
        </span>
        <span className="diag muted">Kayıtlar · İndirilenler/Scryno</span>
      </footer>

      <Drawer
        open={drawer === 'wireless'}
        title="Kablosuz bağlan"
        subtitle="Telefon ve Mac aynı Wi‑Fi ağında olmalı."
        onClose={closeDrawer}
      >
        <WirelessPanel
          busy={busy}
          selectedUsbDeviceId={firstUsbAndroidId}
          onConnect={(endpoint) => void wirelessConnect(endpoint)}
          onPair={(endpoint, code) =>
            void runAction(() => window.scryno.wirelessPair(endpoint, code))
          }
          onDisconnect={(endpoint) => void wirelessDisconnect(endpoint)}
          onEnableTcpip={(deviceId) =>
            void runAction(() => window.scryno.wirelessEnableTcpip(deviceId))
          }
        />
      </Drawer>

      <Drawer
        open={drawer === 'ios'}
        title="iPhone kurulumu"
        subtitle="Bir kez yapılır, sonra tek tıkla yansıt."
        onClose={closeDrawer}
      >
        <IosGuide
          busy={busy}
          iosAvailable={iosAvailable}
          iosDevices={iosDevices}
          onPair={(udid) => void pairIos(udid)}
        />
      </Drawer>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`}>
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  )
}
