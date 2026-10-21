import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import './ios-mirror.css'

function readQuery(): { port: string; label: string; deviceId: string } {
  const params = new URLSearchParams(window.location.search)
  return {
    port: params.get('port') || '',
    label: params.get('label') || 'iPhone',
    deviceId: params.get('deviceId') || ''
  }
}

function IconCamera(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 7.2 10.1 5.8h3.8L15 7.2h2.2A2.2 2.2 0 0 1 19.4 9.4v7A2.2 2.2 0 0 1 17.2 18.6H6.8A2.2 2.2 0 0 1 4.6 16.4v-7A2.2 2.2 0 0 1 6.8 7.2H9Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.8" r="2.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function IconVideo({ live }: { live: boolean }): JSX.Element {
  if (live) {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.8" y="7" width="11.5" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15.5 10.2 20 7.8v8.4l-4.5-2.4V10.2Z" fill="currentColor" />
    </svg>
  )
}

function IconFolder(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4l1.6 1.8h7.4A1.5 1.5 0 0 1 20 9.3v8.2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-10Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IosMirrorApp(): JSX.Element {
  const { port, label, deviceId } = useMemo(() => readQuery(), [])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)
  const [recording, setRecording] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Drawing each JPEG onto a canvas keeps the previous frame visible while the next one decodes,
  // so the mirror reads as motion instead of a frame-by-frame slideshow.
  useEffect(() => {
    if (!port) {
      return
    }
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }
    const decoder = new Image()
    let stopped = false
    let drawing = false
    let pendingUrl = ''

    const paint = (): void => {
      if (!decoder.naturalWidth || stopped) {
        return
      }
      if (canvas.width !== decoder.naturalWidth || canvas.height !== decoder.naturalHeight) {
        canvas.width = decoder.naturalWidth
        canvas.height = decoder.naturalHeight
      }
      context.drawImage(decoder, 0, 0)
      setLoaded(true)
    }

    const pump = (): void => {
      if (stopped || drawing || !pendingUrl) {
        return
      }
      drawing = true
      const url = pendingUrl
      pendingUrl = ''
      decoder.onload = () => {
        URL.revokeObjectURL(url)
        paint()
        drawing = false
        pump()
      }
      decoder.onerror = () => {
        URL.revokeObjectURL(url)
        drawing = false
        pump()
      }
      decoder.src = url
    }

    const source = new EventSource(`http://127.0.0.1:${port}/`)
    source.onmessage = (event: MessageEvent<string>) => {
      pendingUrl = event.data
      pump()
    }
    source.onerror = () => {
      source.close()
    }

    return () => {
      stopped = true
      source.close()
      if (pendingUrl) {
        URL.revokeObjectURL(pendingUrl)
      }
    }
  }, [port])

  const takeShot = useCallback(async () => {
    if (!deviceId) {
      return
    }
    setBusy(true)
    try {
      const result = await window.scryno.takeScreenshot(deviceId, 'ios')
      if (result.ok) {
        setFlash(true)
        window.setTimeout(() => setFlash(false), 500)
      }
    } finally {
      setBusy(false)
    }
  }, [deviceId])

  const toggleRecord = useCallback(async () => {
    if (!deviceId) {
      return
    }
    setBusy(true)
    try {
      if (recording) {
        await window.scryno.stopRecording(deviceId)
        setRecording(false)
      } else {
        const result = await window.scryno.startRecording(deviceId)
        setRecording(result.ok)
      }
    } finally {
      setBusy(false)
    }
  }, [deviceId, recording])

  return (
    <div className="ios-mirror">
      <header className="ios-bar">
        <div className="ios-spacer" />
        <button
          type="button"
          className={`ios-btn ${flash ? 'flash-ok' : ''}`}
          disabled={busy || !deviceId}
          title="Screenshot (pano + İndirilenler)"
          aria-label="Screenshot"
          onClick={() => void takeShot()}
        >
          <IconCamera />
        </button>
        <button
          type="button"
          className={`ios-btn ${recording ? 'live' : ''}`}
          disabled={busy || !deviceId}
          title={recording ? 'Kaydı bitir' : 'Video kaydet'}
          aria-label={recording ? 'Kaydı bitir' : 'Video kaydet'}
          onClick={() => void toggleRecord()}
        >
          <IconVideo live={recording} />
        </button>
        <button
          type="button"
          className="ios-btn"
          title="Kayıt klasörü"
          aria-label="Kayıt klasörü"
          onClick={() => void window.scryno.openCaptureDir()}
        >
          <IconFolder />
        </button>
        <span className="ios-label" title={label}>
          {label}
        </span>
      </header>
      <div className="ios-stage">
        <canvas ref={canvasRef} className={`ios-screen ${loaded ? 'ready' : ''}`} />
        {!loaded ? <div className="ios-loading">Ekran bağlanıyor…</div> : null}
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <IosMirrorApp />
    </StrictMode>
  )
}
