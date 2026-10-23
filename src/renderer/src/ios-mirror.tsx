import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import './ios-mirror.css'
import './annotation.css'
import { AnnotationOverlay, type AnnotationOverlayHandle } from './components/AnnotationOverlay'
import { AnnotationToolbar } from './components/AnnotationToolbar'
import type { AnnotationShape, AnnotationTool, Point } from './types/annotation'
import { renderAnnotationShapes } from './utils/renderAnnotations'

const RECORDING_TYPES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm'
]

let liveRecorder: MediaRecorder | null = null

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

function IconDraw(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m14 6 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IosMirrorApp(): JSX.Element {
  const { port, label, deviceId } = useMemo(() => readQuery(), [])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)
  const [recording, setRecording] = useState(false)

  const [showAnnotationBar, setShowAnnotationBar] = useState(false)
  const [annTool, setAnnTool] = useState<AnnotationTool>('pen')
  const [annColor, setAnnColor] = useState('#ef4444')
  const [annWidth, setAnnWidth] = useState(6)
  const [annLaser, setAnnLaser] = useState(false)
  const [annShapesCount, setAnnShapesCount] = useState(0)

  const overlayRef = useRef<AnnotationOverlayHandle>(null)
  const shapesRef = useRef<AnnotationShape[]>([])
  const laserModeRef = useRef(false)
  laserModeRef.current = annLaser

  const canvasRef = useRef<HTMLCanvasElement>(null)

  const onShapesChange = useCallback((shapes: AnnotationShape[]) => {
    shapesRef.current = shapes
    setAnnShapesCount(shapes.length)
  }, [])

  const toDeviceNorm = useCallback((clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current
    if (!canvas || !canvas.width || !canvas.height) {
      return null
    }
    const rect = canvas.getBoundingClientRect()
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height)
    const x = (clientX - rect.left - (rect.width - canvas.width * scale) / 2) / scale
    const y = (clientY - rect.top - (rect.height - canvas.height * scale) / 2) / scale
    return {
      x: Math.max(0, Math.min(1, x / canvas.width)),
      y: Math.max(0, Math.min(1, y / canvas.height))
    }
  }, [])

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
      const shapes = shapesRef.current
      const activeShape = overlayRef.current?.getActiveShape()
      const allShapes = activeShape ? [...shapes, activeShape] : shapes
      if (allShapes.length > 0) {
        renderAnnotationShapes(context, allShapes, canvas.width, canvas.height, {
          fadeDuration: laserModeRef.current ? 3000 : 0
        })
      }
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

  useEffect(() => {
    return window.scryno.onToolbarStatus((payload) => {
      if (!payload.recording) {
        overlayRef.current?.clear()
      }
    })
  }, [])

  const takeShot = useCallback(async () => {
    if (!deviceId) {
      return
    }
    setBusy(true)
    try {
      const canvas = canvasRef.current
      const shapes = overlayRef.current?.getShapes() ?? []
      const activeShape = overlayRef.current?.getActiveShape()
      const allShapes = activeShape ? [...shapes, activeShape] : shapes

      if (canvas && canvas.width > 0 && canvas.height > 0) {
        const off = document.createElement('canvas')
        off.width = canvas.width
        off.height = canvas.height
        const offCtx = off.getContext('2d')
        if (offCtx) {
          offCtx.drawImage(canvas, 0, 0)
          if (allShapes.length > 0) {
            renderAnnotationShapes(offCtx, allShapes, off.width, off.height)
          }
          const blob = await new Promise<Blob | null>((resolve) =>
            off.toBlob(resolve, 'image/png')
          )
          if (blob) {
            const buffer = new Uint8Array(await blob.arrayBuffer())
            const result = await window.scryno.saveScreenshotData(buffer, deviceId)
            if (result.ok) {
              setFlash(true)
              window.setTimeout(() => setFlash(false), 500)
              overlayRef.current?.clear()
              return
            }
          }
        }
      }

      const result = await window.scryno.takeScreenshot(deviceId, 'ios')
      if (result.ok) {
        setFlash(true)
        window.setTimeout(() => setFlash(false), 500)
        overlayRef.current?.clear()
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
        overlayRef.current?.clear()
        if (liveRecorder && liveRecorder.state === 'recording') {
          liveRecorder.stop()
          setRecording(false)
          return
        }
        await window.scryno.stopRecording(deviceId)
        setRecording(false)
      } else {
        const canvas = canvasRef.current
        if (canvas && canvas.width > 0 && typeof MediaRecorder !== 'undefined') {
          const stream = canvas.captureStream(30)
          const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
          const chunks: Blob[] = []
          const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
          rec.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunks.push(event.data)
            }
          }
          rec.onstop = () => {
            if (liveRecorder === rec) {
              liveRecorder = null
            }
            const blob = new Blob(chunks, { type: rec.mimeType })
            void blob.arrayBuffer().then((buffer) =>
              window.scryno
                .saveRecordingData(
                  new Uint8Array(buffer),
                  rec.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm',
                  deviceId
                )
                .then((res) => {
                  if (res.ok) {
                    void window.scryno.revealCapture(res.path)
                  }
                })
            )
          }
          rec.start(1000)
          liveRecorder = rec
          setRecording(true)
          return
        }

        const result = await window.scryno.startRecording(deviceId)
        if (result.ok && result.stopped) {
          setRecording(false)
          void window.scryno.revealCapture(result.path)
        } else {
          setRecording(result.ok)
        }
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
          className={`ios-btn ${showAnnotationBar ? 'live' : ''}`}
          disabled={busy || !deviceId}
          title={showAnnotationBar ? 'Çizim çubuğunu gizle' : 'Çizim & Vurgu Araçları'}
          aria-label="Çizim Araçları"
          onClick={() => {
            setShowAnnotationBar((prev) => {
              const next = !prev
              if (next && annTool === 'select') {
                setAnnTool('pen')
              }
              return next
            })
          }}
        >
          <IconDraw />
        </button>
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
        <AnnotationOverlay
          ref={overlayRef}
          tool={showAnnotationBar ? annTool : 'select'}
          color={annColor}
          strokeWidth={annWidth}
          laserMode={annLaser}
          toDeviceNorm={toDeviceNorm}
          onShapesChange={onShapesChange}
        />
        {!loaded ? <div className="ios-loading">Ekran bağlanıyor…</div> : null}
      </div>
      {showAnnotationBar ? (
        <AnnotationToolbar
          tool={annTool}
          onSelectTool={setAnnTool}
          color={annColor}
          onSelectColor={setAnnColor}
          strokeWidth={annWidth}
          onSelectStrokeWidth={setAnnWidth}
          laserMode={annLaser}
          onToggleLaserMode={() => setAnnLaser((prev) => !prev)}
          onUndo={() => overlayRef.current?.undo()}
          canUndo={annShapesCount > 0}
          onClear={() => overlayRef.current?.clear()}
          canClear={annShapesCount > 0}
          onSnapshot={() => void takeShot()}
          onClose={() => {
            setShowAnnotationBar(false)
            setAnnTool('select')
          }}
        />
      ) : null}
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
