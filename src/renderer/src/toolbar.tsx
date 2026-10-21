import { StrictMode, useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import './toolbar.css'

function readParams(): { deviceId: string; label: string; platform: 'android' | 'ios' } {
  const params = new URLSearchParams(window.location.search)
  const platform = params.get('platform') === 'ios' ? 'ios' : 'android'
  const deviceId = params.get('deviceId') || ''
  const label = params.get('label') || deviceId || 'Device'
  return { deviceId, label, platform }
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
      <rect
        x="3.8"
        y="7"
        width="11.5"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M15.5 10.2 20 7.8v8.4l-4.5-2.4V10.2Z" fill="currentColor" />
    </svg>
  )
}

function IconAudio(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.8 12v-.2a7.2 7.2 0 0 1 14.4 0V12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M7.2 12v1.4a4.8 4.8 0 0 0 9.6 0V12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M12 18.2v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IconFrame(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 4.8H5.2A1.2 1.2 0 0 0 4 6v2.8M16 4.8h2.8A1.2 1.2 0 0 1 20 6v2.8M8 19.2H5.2A1.2 1.2 0 0 1 4 18v-2.8M16 19.2h2.8A1.2 1.2 0 0 0 20 18v-2.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconGear(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.8v2.1M12 18.1v2.1M3.8 12h2.1M18.1 12h2.1M6.2 6.2l1.5 1.5M16.3 16.3l1.5 1.5M17.8 6.2l-1.5 1.5M7.7 16.3l-1.5 1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ToolbarApp(): JSX.Element {
  const { deviceId, label, platform } = useMemo(() => readParams(), [])
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    return window.scryno.onToolbarStatus((payload) => {
      setRecording(payload.recording)
      if (payload.kind === 'ok') {
        setFlash(true)
        window.setTimeout(() => setFlash(false), 500)
      }
    })
  }, [])

  const runScreenshot = useCallback(async () => {
    if (!deviceId) {
      return
    }
    setBusy(true)
    try {
      const result = await window.scryno.takeScreenshot(deviceId, platform)
      if (result.ok) {
        setFlash(true)
        window.setTimeout(() => setFlash(false), 500)
      }
    } finally {
      setBusy(false)
    }
  }, [deviceId, platform])

  const toggleRecord = useCallback(async () => {
    if (!deviceId) {
      return
    }
    setBusy(true)
    try {
      if (recording) {
        const result = await window.scryno.stopRecording(deviceId)
        if (!result.ok) {
          return
        }
        setRecording(false)
        await window.scryno.revealCapture(result.path)
      } else {
        const result = await window.scryno.startRecording(deviceId)
        if (!result.ok) {
          return
        }
        if (result.stopped) {
          setRecording(false)
          await window.scryno.revealCapture(result.path)
        } else {
          setRecording(true)
        }
      }
    } finally {
      setBusy(false)
    }
  }, [deviceId, recording])

  const openCaptures = useCallback(async () => {
    await window.scryno.openCaptureDir()
  }, [])

  return (
    <div className="chrome" title={deviceId || 'Scryno'}>
      <div className="chrome-spacer" />
      <div className="chrome-actions">
        <button
          type="button"
          className={`chrome-btn ${flash ? 'flash-ok' : ''}`}
          disabled={busy || !deviceId}
          title="Screenshot"
          aria-label="Screenshot"
          onClick={() => void runScreenshot()}
        >
          <IconCamera />
        </button>
        <button
          type="button"
          className={`chrome-btn ${recording ? 'live' : ''}`}
          disabled={busy || !deviceId}
          title={recording ? 'Kaydı bitir' : 'Video kaydet'}
          aria-label={recording ? 'Kaydı bitir' : 'Video kaydet'}
          onClick={() => void toggleRecord()}
        >
          <IconVideo live={recording} />
        </button>
        <button type="button" className="chrome-btn" disabled title="Ses (yakında)" aria-label="Ses">
          <IconAudio />
        </button>
        <button
          type="button"
          className="chrome-btn"
          disabled
          title="Tam ekran (yakında)"
          aria-label="Tam ekran"
        >
          <IconFrame />
        </button>
        <button
          type="button"
          className="chrome-btn"
          title="Kayıt klasörü"
          aria-label="Ayarlar / kayıt klasörü"
          onClick={() => void openCaptures()}
        >
          <IconGear />
        </button>
      </div>
      <div className="chrome-label" title={label}>
        {label}
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ToolbarApp />
    </StrictMode>
  )
}
