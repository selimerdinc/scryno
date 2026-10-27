import { StrictMode, useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import './toolbar.css'
import { IconClose, IconFolder, IconRefresh, IconSparkle } from './components/icons'
import { compositeDualScreenshot } from './utils/dualCompositor'

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

function IconPencil(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m16.5 3.5 4 4L7 21H3v-4L16.5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
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
        if (platform === 'android') {
          void window.scryno.setAndroidAnnotations(deviceId, false)
        }
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
        if (platform === 'android') {
          void window.scryno.setAndroidAnnotations(deviceId, false)
        }
        await window.scryno.revealCapture(result.path)
      } else {
        const result = await window.scryno.startRecording(deviceId)
        if (!result.ok) {
          return
        }
        if (result.stopped) {
          setRecording(false)
          if (platform === 'android') {
            void window.scryno.setAndroidAnnotations(deviceId, false)
          }
          await window.scryno.revealCapture(result.path)
        } else {
          setRecording(true)
        }
      }
    } finally {
      setBusy(false)
    }
  }, [deviceId, recording, platform])

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
        <button
          type="button"
          className="chrome-btn"
          disabled={busy || !deviceId}
          title="Çizim yap / Vurgula"
          aria-label="Çizim yap"
          onClick={() => {
            if (platform === 'android') {
              void window.scryno.toggleAndroidAnnotations(deviceId)
            } else {
              void window.scryno.toggleOverlay(deviceId)
            }
          }}
        >
          <IconPencil />
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

function DualToolbarApp(): JSX.Element {
  const params = new URLSearchParams(window.location.search)
  const androidId = params.get('androidId') || ''
  const iosId = params.get('iosId') || ''

  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [flash, setFlash] = useState(false)
  const [flashErr, setFlashErr] = useState(false)
  const [merging, setMerging] = useState(false)

  useEffect(() => {
    return window.scryno.onToolbarStatus((payload) => {
      setRecording(payload.recording)
      if (payload.kind === 'ok') {
        setFlash(true)
        setTimeout(() => setFlash(false), 500)
      } else if (payload.kind === 'error') {
        setFlashErr(true)
        setTimeout(() => setFlashErr(false), 800)
      }
    })
  }, [])

  useEffect(() => {
    let timer: number | undefined
    if (recording && !merging) {
      timer = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    } else {
      setSeconds(0)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [recording, merging])

  const runDualScreenshot = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const sources = await window.scryno.captureDualSources(androidId, iosId)
      if (sources.ok) {
        const buffer = await compositeDualScreenshot({
          androidImageSrc: sources.androidImage,
          iosImageSrc: sources.iosImage,
          androidLabel: sources.androidName,
          iosLabel: sources.iosName,
          mode: 'mockup'
        })
        const saved = await window.scryno.saveDualScreenshot(buffer)
        if (saved.ok) {
          setFlash(true)
          setTimeout(() => setFlash(false), 500)
          void window.scryno.closeDualAnnotations(androidId, iosId)
          if (saved.path) {
            await window.scryno.revealCapture(saved.path)
          }
        } else {
          setFlashErr(true)
          setTimeout(() => setFlashErr(false), 800)
        }
      } else {
        console.error('[DualScreenshot] Failed:', sources.message)
        setFlashErr(true)
        setTimeout(() => setFlashErr(false), 800)
      }
    } catch (e) {
      console.error('[DualScreenshot] Error:', e)
      setFlashErr(true)
      setTimeout(() => setFlashErr(false), 800)
    } finally {
      setBusy(false)
    }
  }, [androidId, iosId, busy])

  const toggleDualVideo = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      if (recording) {
        setMerging(true)
        const res = await window.scryno.stopDualRecording(androidId, iosId)
        setRecording(false)
        setMerging(false)
        void window.scryno.closeDualAnnotations(androidId, iosId)
        if (res.ok && res.path) {
          await window.scryno.revealCapture(res.path)
        } else {
          setFlashErr(true)
          setTimeout(() => setFlashErr(false), 800)
        }
      } else {
        const res = await window.scryno.startDualRecording(androidId, iosId)
        if (res.ok) {
          setRecording(true)
        } else {
          console.error('[DualVideo] Failed to start:', res.message)
          setFlashErr(true)
          setTimeout(() => setFlashErr(false), 800)
        }
      }
    } catch (e) {
      console.error('[DualVideo] Error:', e)
      setFlashErr(true)
      setTimeout(() => setFlashErr(false), 800)
    } finally {
      setMerging(false)
      setBusy(false)
    }
  }, [androidId, iosId, recording, busy])

  const formatTimer = (s: number) => {
    const mins = String(Math.floor(s / 60)).padStart(2, '0')
    const secs = String(s % 60).padStart(2, '0')
    return `${mins}:${secs}`
  }

  return (
    <div className="dual-chrome vertical">
      <div
        className="dual-chrome-brand"
        title="Birlikte Taşı (Sürükle ya da çift tıklayarak ekranı ortala)"
        onDoubleClick={() => void window.scryno.alignDualMirrors()}
      >
        <div className="dual-drag-handle">
          <span />
          <span />
          <span />
        </div>
        <IconSparkle size={12} />
        <span>Dual</span>
      </div>
      {merging ? (
        <span className="dual-chrome-timer merging" title="Videolar yan yana birleştiriliyor…">
          <span className="mini-spinner" />
        </span>
      ) : recording ? (
        <span className="dual-chrome-timer">{formatTimer(seconds)}</span>
      ) : null}
      <div className="chrome-actions">
        <button
          type="button"
          className={`chrome-btn ${flash ? 'flash-ok' : ''} ${flashErr ? 'flash-err' : ''}`}
          disabled={busy || merging}
          title="Yan yana Screenshot al (Panoya kopyalanır)"
          onClick={() => void runDualScreenshot()}
        >
          <IconCamera />
        </button>
        <button
          type="button"
          className={`chrome-btn ${recording ? 'live' : ''} ${merging ? 'merging' : ''} ${flashErr ? 'flash-err' : ''}`}
          disabled={busy || merging}
          title={
            merging
              ? 'Videolar birleştiriliyor…'
              : recording
                ? 'Kaydı Bitir ve Tek Video Olarak Birleştir'
                : 'Yan yana tek video kaydet'
          }
          onClick={() => void toggleDualVideo()}
        >
          {merging ? <span className="mini-spinner" /> : <IconVideo live={recording} />}
        </button>
        <button
          type="button"
          className="chrome-btn"
          disabled={busy || merging}
          title="Çizim yap / Vurgula (Her iki cihaz)"
          aria-label="Çizim yap"
          onClick={() => {
            void window.scryno.toggleDualAnnotations(androidId, iosId)
          }}
        >
          <IconPencil />
        </button>
        <button
          type="button"
          className="chrome-btn"
          title="İki ekranı ortala ve kenetle"
          aria-label="İki ekranı ortala ve kenetle"
          onClick={() => void window.scryno.alignDualMirrors()}
        >
          <IconRefresh size={14} />
        </button>
        <button
          type="button"
          className="chrome-btn"
          title="İndirilenler/Scryno klasörünü aç"
          onClick={() => void window.scryno.openCaptureDir()}
        >
          <IconFolder size={15} />
        </button>
        <button
          type="button"
          className="chrome-btn chrome-btn-close"
          title="Kapat"
          onClick={() => void window.scryno.closeDualToolbar()}
        >
          <IconClose size={12} />
        </button>
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  const isDual = new URLSearchParams(window.location.search).get('mode') === 'dual'
  createRoot(root).render(
    <StrictMode>
      {isDual ? <DualToolbarApp /> : <ToolbarApp />}
    </StrictMode>
  )
}
