import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import './annotation.css'
import { AnnotationOverlay, type AnnotationOverlayHandle } from './components/AnnotationOverlay'
import { AnnotationToolbar } from './components/AnnotationToolbar'
import type { AnnotationShape, AnnotationTool, Point } from './types/annotation'
import { renderAnnotationShapes } from './utils/renderAnnotations'

function readQuery(): { deviceId: string; label: string } {
  const params = new URLSearchParams(window.location.search)
  return {
    deviceId: params.get('deviceId') || '',
    label: params.get('label') || 'iPhone'
  }
}

function OverlayApp(): JSX.Element {
  const { deviceId } = useMemo(() => readQuery(), [])
  // Start with 'rect' so user can draw immediately, or switch to 'select' to control the phone
  const [annTool, setAnnTool] = useState<AnnotationTool>('rect')
  const [annColor, setAnnColor] = useState('#ef4444')
  const [annWidth, setAnnWidth] = useState(6)
  const [annLaser, setAnnLaser] = useState(false)
  const [annShapesCount, setAnnShapesCount] = useState(0)

  const overlayRef = useRef<AnnotationOverlayHandle>(null)
  const shapesRef = useRef<AnnotationShape[]>([])

  // Manage click-through: when tool is 'select', allow mouse clicks to pass through to the iPhone Mirroring window
  useEffect(() => {
    if (annTool === 'select') {
      window.scryno.setIgnoreMouseEvents(true, true)
    } else {
      window.scryno.setIgnoreMouseEvents(false)
    }
  }, [annTool])

  const onShapesChange = useCallback((shapes: AnnotationShape[]) => {
    shapesRef.current = shapes
    setAnnShapesCount(shapes.length)
  }, [])

  const toDeviceNorm = useCallback((clientX: number, clientY: number): Point | null => {
    return {
      x: Math.max(0, Math.min(1, clientX / window.innerWidth)),
      y: Math.max(0, Math.min(1, clientY / window.innerHeight))
    }
  }, [])

  const handleClose = useCallback(() => {
    overlayRef.current?.clear()
    window.scryno.setIgnoreMouseEvents(false)
    void window.scryno.toggleOverlay(deviceId)
  }, [deviceId])

  const takeSnapshot = useCallback(async () => {
    if (!deviceId) {
      return
    }
    try {
      await window.scryno.takeScreenshot(deviceId, 'ios')
    } catch {
      // Ignore
    }
  }, [deviceId])

  const wasRecordingRef = useRef<boolean | null>(null)

  useEffect(() => {
    return window.scryno.onToolbarStatus((payload) => {
      if (typeof payload.recording === 'boolean') {
        if (wasRecordingRef.current === true && !payload.recording) {
          overlayRef.current?.clear()
        }
        wasRecordingRef.current = payload.recording
      }
      if (
        payload.kind === 'ok' &&
        (payload.message?.includes('Kaydedildi') || payload.message?.includes('Ekran görüntüsü'))
      ) {
        overlayRef.current?.clear()
      }
    })
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      if (e.key === 'Escape') {
        handleClose()
      } else if (e.key === 't' || e.key === 'T' || e.key === 'v' || e.key === 'V' || e.key === ' ') {
        setAnnTool('select')
      } else if (e.key === 'r' || e.key === 'R') {
        setAnnTool('rect')
      } else if (e.key === 'p' || e.key === 'P') {
        setAnnTool('pen')
      } else if (e.key === 'h' || e.key === 'H') {
        setAnnTool('highlighter')
      } else if (e.key === 'c' || e.key === 'C') {
        overlayRef.current?.clear()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        overlayRef.current?.undo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Clipped specifically to iPhone screen curve so drawings never spill outside the phone */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 54,
          overflow: 'hidden'
        }}
      >
        <AnnotationOverlay
          ref={overlayRef}
          tool={annTool}
          color={annColor}
          strokeWidth={annWidth}
          laserMode={annLaser}
          toDeviceNorm={toDeviceNorm}
          onShapesChange={onShapesChange}
        />
      </div>
      <div
        onMouseEnter={() => window.scryno.setIgnoreMouseEvents(false)}
        onMouseLeave={() => {
          if (annTool === 'select') {
            window.scryno.setIgnoreMouseEvents(true, true)
          }
        }}
      >
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
          onSnapshot={() => void takeSnapshot()}
          onClose={handleClose}
        />
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <OverlayApp />
    </StrictMode>
  )
}
