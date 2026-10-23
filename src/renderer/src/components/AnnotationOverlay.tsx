import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { AnnotationShape, AnnotationTool, Point } from '../types/annotation'
import { renderAnnotationShapes } from '../utils/renderAnnotations'

export interface AnnotationOverlayHandle {
  getShapes: () => AnnotationShape[]
  getActiveShape: () => AnnotationShape | null
  undo: () => void
  clear: () => void
  canUndo: boolean
  canClear: boolean
}

interface AnnotationOverlayProps {
  tool: AnnotationTool
  color: string
  strokeWidth: number
  laserMode: boolean
  toDeviceNorm: (clientX: number, clientY: number) => Point | null
  onShapesChange?: (shapes: AnnotationShape[]) => void
}

export const AnnotationOverlay = forwardRef<AnnotationOverlayHandle, AnnotationOverlayProps>(
  function AnnotationOverlay(
    { tool, color, strokeWidth, laserMode, toDeviceNorm, onShapesChange },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [shapes, setShapes] = useState<AnnotationShape[]>([])
    const shapesRef = useRef<AnnotationShape[]>([])
    shapesRef.current = shapes

    const activeShapeRef = useRef<AnnotationShape | null>(null)
    const isDrawingRef = useRef(false)

    const redraw = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) {
        return
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const all = activeShapeRef.current
        ? [...shapesRef.current, activeShapeRef.current]
        : shapesRef.current

      if (all.length > 0) {
        renderAnnotationShapes(ctx, all, canvas.width, canvas.height, {
          fadeDuration: laserMode ? 3000 : 0,
          now: Date.now()
        })
      }
    }, [laserMode])

    // Laser mode animation loop
    useEffect(() => {
      if (!laserMode || shapes.length === 0) {
        return
      }
      let frameId: number
      const tick = (): void => {
        const now = Date.now()
        const unexpired = shapesRef.current.filter((s) => now - s.createdAt < 3000)
        if (unexpired.length !== shapesRef.current.length) {
          setShapes(unexpired)
          onShapesChange?.(unexpired)
        }
        redraw()
        frameId = requestAnimationFrame(tick)
      }
      frameId = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(frameId)
    }, [laserMode, shapes.length, redraw, onShapesChange])

    // Resize observer to keep overlay canvas resolution sharp
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) {
        return
      }
      const sync = (): void => {
        const rect = canvas.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const w = Math.round(rect.width * dpr)
        const h = Math.round(rect.height * dpr)
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
          redraw()
        }
      }
      sync()
      const ro = new ResizeObserver(sync)
      ro.observe(canvas)
      return () => ro.disconnect()
    }, [redraw])

    useEffect(() => {
      redraw()
    }, [shapes, redraw])

    const undo = useCallback(() => {
      setShapes((prev) => {
        const next = prev.slice(0, -1)
        onShapesChange?.(next)
        return next
      })
    }, [onShapesChange])

    const clear = useCallback(() => {
      setShapes([])
      onShapesChange?.([])
    }, [onShapesChange])

    useImperativeHandle(
      ref,
      () => ({
        getShapes: () => shapesRef.current,
        getActiveShape: () => activeShapeRef.current,
        undo,
        clear,
        canUndo: shapes.length > 0,
        canClear: shapes.length > 0
      }),
      [shapes.length, undo, clear]
    )

    const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (tool === 'select') {
        return
      }
      event.preventDefault()
      const point = toDeviceNorm(event.clientX, event.clientY)
      if (!point) {
        return
      }

      isDrawingRef.current = true
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const createdAt = Date.now()

      if (tool === 'pen' || tool === 'highlighter') {
        activeShapeRef.current = {
          type: 'pen',
          id,
          color,
          strokeWidth,
          createdAt,
          points: [point],
          isHighlighter: tool === 'highlighter'
        }
      } else if (tool === 'rect') {
        activeShapeRef.current = {
          type: 'rect',
          id,
          color,
          strokeWidth,
          createdAt,
          start: point,
          end: point
        }
      } else if (tool === 'circle') {
        activeShapeRef.current = {
          type: 'circle',
          id,
          color,
          strokeWidth,
          createdAt,
          start: point,
          end: point
        }
      } else if (tool === 'arrow') {
        activeShapeRef.current = {
          type: 'arrow',
          id,
          color,
          strokeWidth,
          createdAt,
          start: point,
          end: point
        }
      }
      redraw()
    }

    const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (!isDrawingRef.current || !activeShapeRef.current || tool === 'select') {
        return
      }
      event.preventDefault()
      const point = toDeviceNorm(event.clientX, event.clientY)
      if (!point) {
        return
      }

      const current = activeShapeRef.current
      if (current.type === 'pen') {
        current.points.push(point)
      } else {
        current.end = point
      }
      redraw()
    }

    const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (!isDrawingRef.current) {
        return
      }
      isDrawingRef.current = false
      event.preventDefault()

      const finished = activeShapeRef.current
      activeShapeRef.current = null

      if (finished) {
        setShapes((prev) => {
          const next = [...prev, finished]
          onShapesChange?.(next)
          return next
        })
      }
      redraw()
    }

    return (
      <canvas
        ref={canvasRef}
        className={`annotation-canvas ${tool !== 'select' ? 'interactive' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
    )
  }
)
