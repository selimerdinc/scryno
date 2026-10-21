import { useEffect, useState, type DragEvent, type JSX } from 'react'
import type { DeviceInfo, DevicePlatform, MirrorSessionInfo } from '../../../shared/types'
import { PhoneModel } from './PhoneModel'
import { IconCamera, IconLink, IconPlay, IconStop, IconWifi } from './icons'

interface DeviceCardProps {
  device: DeviceInfo
  session: MirrorSessionInfo | undefined
  busy: boolean
  onStart: (deviceId: string) => void
  onStop: (deviceId: string) => void
  onScreenshot: (deviceId: string, platform: DeviceInfo['platform']) => void
  onEnableTcpip: (deviceId: string) => void
  onPairIos: (udid: string) => void
  onSendFiles?: (deviceId: string, filePaths: string[]) => void
}

type Tone = 'live' | 'ready' | 'warn' | 'off'

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

function stagger(deviceId: string): number {
  let hash = 0
  for (let index = 0; index < deviceId.length; index += 1) {
    hash = (hash + deviceId.charCodeAt(index) * 17) % 1600
  }
  return 700 + hash
}

interface PreviewState {
  image: string | null
  locked: boolean
}

const NO_PREVIEW: PreviewState = { image: null, locked: false }

function usePreview(deviceId: string, platform: DevicePlatform, enabled: boolean): PreviewState {
  const [preview, setPreview] = useState<PreviewState>(NO_PREVIEW)

  useEffect(() => {
    if (!enabled) {
      setPreview(NO_PREVIEW)
      return
    }

    let cancelled = false
    let timer = 0
    let wait = stagger(deviceId)

    const tick = async (): Promise<void> => {
      if (cancelled) {
        return
      }
      if (document.hidden) {
        timer = window.setTimeout(() => void tick(), 4000)
        return
      }
      const result = await window.scryno.capturePreview(deviceId, platform)
      if (cancelled) {
        return
      }
      if (result.ok) {
        setPreview((current) => ({
          image: result.image ?? (result.locked ? null : current.image),
          locked: result.locked
        }))
        wait = result.locked ? 3000 : 4000
      } else {
        wait = Math.min(wait * 2, 20000)
      }
      timer = window.setTimeout(() => void tick(), wait)
    }

    timer = window.setTimeout(() => void tick(), wait)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [deviceId, platform, enabled])

  return preview
}

function useElapsed(startedAt: number | undefined): string {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (startedAt === undefined) {
      return
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  return startedAt === undefined ? '' : formatElapsed(now - startedAt)
}

function describe(device: DeviceInfo, live: boolean, elapsed: string): { tone: Tone; text: string } {
  if (live) {
    return { tone: 'live', text: `Canlı · ${elapsed}` }
  }
  if (device.state === 'unauthorized') {
    return { tone: 'warn', text: 'Telefonda izni onayla' }
  }
  if (device.state !== 'device') {
    return { tone: 'off', text: 'Çevrimdışı' }
  }
  if (device.platform === 'ios' && device.iosPaired === false) {
    return { tone: 'warn', text: 'Eşleştirme gerekli' }
  }
  if (device.platform === 'ios') {
    return { tone: 'ready', text: 'Hazır · iPhone Mirroring' }
  }
  return { tone: 'ready', text: device.wireless ? 'Hazır · Wi‑Fi' : 'Hazır · USB' }
}

export function DeviceCard(props: DeviceCardProps): JSX.Element {
  const { device, session, busy, onStart, onStop, onScreenshot, onEnableTcpip, onPairIos, onSendFiles } =
    props
  const [dragOver, setDragOver] = useState(false)
  const live = Boolean(session)
  const elapsed = useElapsed(session?.startedAt)
  const preview = usePreview(device.id, device.platform, device.state === 'device')
  const status = describe(device, live, elapsed)
  const ready = device.state === 'device'
  const needsIosPair = device.platform === 'ios' && device.iosPaired === false
  const canGoWireless = device.platform === 'android' && ready && !device.wireless && !live
  const subtitle =
    device.model && device.model !== device.name
      ? device.model
      : device.platform === 'ios'
        ? 'Apple iPhone'
        : 'Android cihaz'

  const canDrop = device.platform === 'android' && ready && !busy && Boolean(onSendFiles)

  const onDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!canDrop || !event.dataTransfer.types.includes('Files')) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  const onDragLeave = (event: DragEvent<HTMLElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setDragOver(false)
  }

  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    setDragOver(false)
    if (!canDrop || !onSendFiles) {
      return
    }
    const paths: string[] = []
    for (const file of Array.from(event.dataTransfer.files)) {
      const filePath = window.scryno.filePath(file)
      if (filePath) {
        paths.push(filePath)
      }
    }
    if (paths.length > 0) {
      onSendFiles(device.id, paths)
    }
  }

  return (
    <article
      className={`device-card tone-${status.tone}${dragOver ? ' is-dropping' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <PhoneModel
        platform={device.platform}
        live={live}
        dimmed={!ready}
        caption={live ? 'CANLI' : device.name}
        preview={preview.image}
        locked={preview.locked}
      />

      {dragOver ? (
        <div className="drop-veil">
          Bırak
          <span>APK kurulur, diğer dosyalar İndirilenler’e gider</span>
        </div>
      ) : null}

      <div className="device-body">
        <div className="device-heading">
          <h3 className="device-name" title={device.id}>
            {device.name}
          </h3>
          <p className="device-sub">{subtitle}</p>
        </div>

        <div className={`status-pill tone-${status.tone}`}>
          <span className="status-dot" />
          {status.text}
          {session?.recordingPath ? <span className="rec-chip">REC</span> : null}
        </div>

        <div className="device-actions">
          {live ? (
            <button
              type="button"
              className="btn btn-stop"
              disabled={busy}
              onClick={() => onStop(device.id)}
            >
              <IconStop size={14} />
              Durdur
            </button>
          ) : needsIosPair ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !ready}
              onClick={() => onPairIos(device.id)}
            >
              <IconLink size={15} />
              Eşleştir
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !ready}
              onClick={() => onStart(device.id)}
            >
              <IconPlay size={14} />
              Yansıt
            </button>
          )}

          <button
            type="button"
            className="btn btn-icon"
            disabled={busy || !ready}
            title="Ekran görüntüsü (panoya da kopyalanır)"
            aria-label="Ekran görüntüsü"
            onClick={() => onScreenshot(device.id, device.platform)}
          >
            <IconCamera size={17} />
          </button>

          {canGoWireless ? (
            <button
              type="button"
              className="btn btn-icon"
              disabled={busy}
              title="Kablosuza geçir (adb tcpip 5555)"
              aria-label="Kablosuza geçir"
              onClick={() => onEnableTcpip(device.id)}
            >
              <IconWifi size={17} />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}
