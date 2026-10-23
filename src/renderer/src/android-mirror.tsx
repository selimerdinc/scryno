import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type PointerEvent
} from 'react'
import { createRoot } from 'react-dom/client'
import type { MirrorInput } from '../../shared/types'
import './ios-mirror.css'
import './android-mirror.css'
import './annotation.css'
import { AnnotationOverlay, type AnnotationOverlayHandle } from './components/AnnotationOverlay'
import { AnnotationToolbar } from './components/AnnotationToolbar'
import type { AnnotationShape, AnnotationTool, Point } from './types/annotation'
import { renderAnnotationShapes } from './utils/renderAnnotations'

const ACTION_DOWN = 0
const ACTION_UP = 1
const ACTION_MOVE = 2
const BUTTON_PRIMARY = 1
const KEYCODE_HOME = 3
const KEYCODE_APP_SWITCH = 187
const KEYCODE_A = 29
const KEYCODE_Z = 54
const KEYCODE_CUT = 277
const KEYCODE_COPY = 278
const META_SHIFT = 0x41
const META_ALT = 0x12
const META_CTRL = 0x3000

const KEYCODES: Record<string, number> = {
  Enter: 66,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  Escape: 111,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93
}

const RECORDING_TYPES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm'
]

function readQuery(): { deviceId: string; label: string; control: boolean } {
  const params = new URLSearchParams(window.location.search)
  return {
    deviceId: params.get('deviceId') || '',
    label: params.get('label') || 'Android',
    control: params.get('control') === '1'
  }
}

let liveRecorder: MediaRecorder | null = null

function beginMirrorRecording(canvas: HTMLCanvasElement, audioTracks: MediaStreamTrack[]): void {
  if (liveRecorder && liveRecorder.state === 'recording') {
    return
  }
  const stream = canvas.captureStream(60)
  for (const track of audioTracks) {
    stream.addTrack(track)
  }
  const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
  const chunks: Blob[] = []
  const active = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  active.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  }
  active.onstop = () => {
    if (liveRecorder === active) {
      liveRecorder = null
    }
    const blob = new Blob(chunks, { type: active.mimeType })
    void blob.arrayBuffer().then((buffer) =>
      window.scryno.androidMirror.saveRecording(
        new Uint8Array(buffer),
        active.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
      )
    )
  }
  active.start(1000)
  liveRecorder = active
}

function endMirrorRecording(): void {
  const active = liveRecorder
  if (!active || active.state !== 'recording') {
    return
  }
  liveRecorder = null
  active.stop()
}

function send(input: MirrorInput): void {
  window.scryno.androidMirror.sendInput(input)
}

function pressKey(keycode: number, metaState = 0): void {
  send({ kind: 'key', action: ACTION_DOWN, keycode, metaState })
  send({ kind: 'key', action: ACTION_UP, keycode, metaState })
}

function hex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

function codecFromConfig(data: Uint8Array): string {
  for (let index = 0; index + 4 < data.length; index += 1) {
    const startCode = data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1
    if (startCode && (data[index + 3] & 0x1f) === 7) {
      return `avc1.${hex(data[index + 4])}${hex(data[index + 5])}${hex(data[index + 6])}`
    }
  }
  return 'avc1.42e01f'
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const result = new Uint8Array(first.length + second.length)
  result.set(first, 0)
  result.set(second, first.length)
  return result
}

function IconBack(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 5.5 8.5 12l6.5 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconHome(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="6.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function IconRecents(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
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

function AndroidMirrorApp(): JSX.Element {
  const { deviceId, label, control } = useMemo(() => readQuery(), [])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)
  const [recording, setRecording] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [notice, setNotice] = useState('')

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
  const stageRef = useRef<HTMLDivElement>(null)
  const videoSize = useRef({ width: 0, height: 0 })
  const audioOutput = useRef<MediaStreamAudioDestinationNode | null>(null)
  const pointerDown = useRef(false)

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice((current) => (current === text ? '' : current)), 3000)
  }, [])

  useEffect(() => {
    if (!showAnnotationBar) {
      return
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      if (e.key === 'Escape') {
        setShowAnnotationBar(false)
        overlayRef.current?.clear()
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
  }, [showAnnotationBar])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { desynchronized: true, alpha: false })
    if (!canvas || !context) {
      return
    }
    let decoder: VideoDecoder | null = null
    let pendingConfig: Uint8Array | null = null
    let waitingForKey = true
    let latestFrame: VideoFrame | null = null
    let rafId: number | null = null
    let destroyed = false

    const renderLoop = (): void => {
      if (destroyed) {
        return
      }
      rafId = requestAnimationFrame(renderLoop)
      if (!latestFrame) {
        return
      }
      const frame = latestFrame
      latestFrame = null

      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth
        canvas.height = frame.displayHeight
        const rotated = videoSize.current.width > 0
        videoSize.current = { width: frame.displayWidth, height: frame.displayHeight }
        if (rotated) {
          window.scryno.androidMirror.reportSize(frame.displayWidth, frame.displayHeight)
        }
      }
      context.drawImage(frame, 0, 0)
      frame.close()
      const shapes = shapesRef.current
      const activeShape = overlayRef.current?.getActiveShape()
      const allShapes = activeShape ? [...shapes, activeShape] : shapes
      if (allShapes.length > 0) {
        renderAnnotationShapes(context, allShapes, canvas.width, canvas.height, {
          fadeDuration: laserModeRef.current ? 3000 : 0
        })
      }
      setReady(true)
    }
    rafId = requestAnimationFrame(renderLoop)

    const onFrameDecoded = (frame: VideoFrame): void => {
      // Discard previous unrendered frame to eliminate any buffer queue latency (e.g. during Teams screen share)
      if (latestFrame) {
        latestFrame.close()
      }
      latestFrame = frame
    }

    const off = window.scryno.androidMirror.onVideo((packet) => {
      if (packet.config) {
        pendingConfig = packet.data
        if (latestFrame) {
          latestFrame.close()
          latestFrame = null
        }
        decoder?.close()
        decoder = new VideoDecoder({
          output: onFrameDecoded,
          error: () => {
            waitingForKey = true
          }
        })
        decoder.configure({
          codec: codecFromConfig(packet.data),
          optimizeForLatency: true,
          hardwareAcceleration: 'prefer-hardware'
        })
        waitingForKey = true
        return
      }
      if (!decoder || decoder.state !== 'configured' || (waitingForKey && !packet.key)) {
        return
      }

      // If decoder queue is backing up (e.g. Teams screen sharing GPU contention):
      if (decoder.decodeQueueSize > 2) {
        if (packet.key) {
          decoder.reset()
          decoder.configure({
            codec: codecFromConfig(pendingConfig || packet.data),
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware'
          })
        } else {
          return
        }
      }

      waitingForKey = false
      const data = pendingConfig ? concat(pendingConfig, packet.data) : packet.data
      pendingConfig = null
      decoder.decode(
        new EncodedVideoChunk({ type: packet.key ? 'key' : 'delta', timestamp: packet.pts, data })
      )
    })

    return () => {
      destroyed = true
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      if (latestFrame) {
        latestFrame.close()
        latestFrame = null
      }
      off()
      if (decoder && decoder.state !== 'closed') {
        decoder.close()
      }
    }
  }, [])

  useEffect(() => {
    let audioContext: AudioContext | null = null
    let decoder: AudioDecoder | null = null
    let nextStart = 0

    const play = (data: AudioData): void => {
      if (!audioContext) {
        data.close()
        return
      }
      const buffer = audioContext.createBuffer(data.numberOfChannels, data.numberOfFrames, data.sampleRate)
      for (let channel = 0; channel < data.numberOfChannels; channel += 1) {
        const plane = new Float32Array(data.numberOfFrames)
        data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' })
        buffer.copyToChannel(plane, channel)
      }
      data.close()
      const source = audioContext.createBufferSource()
      source.buffer = buffer
      source.connect(audioContext.destination)
      if (audioOutput.current) {
        source.connect(audioOutput.current)
      }
      // Keep a short cushion so network jitter does not click, and drop it when it drifts too far behind.
      const now = audioContext.currentTime
      if ((nextStart < now + 0.01) || (nextStart > now + 0.15)) {
        nextStart = now + 0.03
      }
      source.start(nextStart)
      nextStart += buffer.duration
    }

    const off = window.scryno.androidMirror.onAudio((packet) => {
      if (packet.config) {
        audioContext ??= new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' })
        audioOutput.current ??= audioContext.createMediaStreamDestination()
        decoder?.close()
        decoder = new AudioDecoder({ output: play, error: () => undefined })
        try {
          decoder.configure({ codec: 'opus', sampleRate: 48_000, numberOfChannels: 2, description: packet.data })
        } catch {
          decoder.configure({ codec: 'opus', sampleRate: 48_000, numberOfChannels: 2 })
        }
        return
      }
      if (decoder?.state === 'configured') {
        decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: packet.pts, data: packet.data }))
      }
    })

    return () => {
      off()
      if (decoder && decoder.state !== 'closed') {
        decoder.close()
      }
      void audioContext?.close()
    }
  }, [])

  useEffect(() => {
    if (liveRecorder?.state === 'recording') {
      setRecording(true)
    }
    return window.scryno.androidMirror.onRecord((action) => {
      const canvas = canvasRef.current
      if (action === 'start' && canvas) {
        beginMirrorRecording(canvas, audioOutput.current?.stream.getAudioTracks() ?? [])
        setRecording(true)
      } else if (action === 'stop') {
        endMirrorRecording()
        setRecording(false)
        overlayRef.current?.clear()
      }
    })
  }, [])

  useEffect(() => {
    return window.scryno.onToolbarStatus((payload) => {
      if (!payload.recording) {
        overlayRef.current?.clear()
      }
      if (
        payload.kind === 'ok' &&
        (payload.message?.includes('Kaydedildi') || payload.message?.includes('Ekran görüntüsü'))
      ) {
        overlayRef.current?.clear()
      }
    })
  }, [])

  useEffect(() => {
    document.title = label
    window.scryno.androidMirror.ready()
  }, [label])

  const toDevice = useCallback(
    (clientX: number, clientY: number, clamp: boolean): { x: number; y: number } | null => {
      const canvas = canvasRef.current
      const { width, height } = videoSize.current
      if (!canvas || !width || !height) {
        return null
      }
      const rect = canvas.getBoundingClientRect()
      const scale = Math.min(rect.width / width, rect.height / height)
      const x = (clientX - rect.left - (rect.width - width * scale) / 2) / scale
      const y = (clientY - rect.top - (rect.height - height * scale) / 2) / scale
      if (clamp) {
        return { x: Math.min(Math.max(x, 0), width - 1), y: Math.min(Math.max(y, 0), height - 1) }
      }
      if ((x < 0) || (y < 0) || (x >= width) || (y >= height)) {
        return null
      }
      return { x, y }
    },
    []
  )

  const toDeviceNorm = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const pt = toDevice(clientX, clientY, true)
      const { width, height } = videoSize.current
      if (!pt || !width || !height) {
        return null
      }
      return {
        x: Math.max(0, Math.min(1, pt.x / width)),
        y: Math.max(0, Math.min(1, pt.y / height))
      }
    },
    [toDevice]
  )

  const onShapesChange = useCallback((shapes: AnnotationShape[]) => {
    shapesRef.current = shapes
    setAnnShapesCount(shapes.length)
  }, [])

  const sendTouch = useCallback(
    (action: number, point: { x: number; y: number }, buttons: number) => {
      const { width, height } = videoSize.current
      send({ kind: 'touch', action, x: point.x, y: point.y, width, height, buttons })
    },
    []
  )

  useEffect(() => {
    const stage = stageRef.current
    if (!control || !stage) {
      return
    }
    const onWheel = (event: WheelEvent): void => {
      if (showAnnotationBar && annTool !== 'select') {
        return
      }
      event.preventDefault()
      const point = toDevice(event.clientX, event.clientY, false)
      if (!point) {
        return
      }
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 1 : 40
      const limit = (value: number): number => Math.max(-16, Math.min(16, value))
      const { width, height } = videoSize.current
      send({
        kind: 'scroll',
        x: point.x,
        y: point.y,
        width,
        height,
        horizontal: limit(-event.deltaX / unit),
        vertical: limit(-event.deltaY / unit)
      })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [control, toDevice, showAnnotationBar, annTool])

  useEffect(() => {
    if (!control) {
      return
    }
    const metaFor = (event: KeyboardEvent): number =>
      (event.shiftKey ? META_SHIFT : 0) | (event.altKey ? META_ALT : 0)

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) {
        return
      }
      if (event.metaKey) {
        const shortcut = event.key.toLowerCase()
        if (shortcut === 'v') {
          send({ kind: 'paste' })
        } else if (shortcut === 'c') {
          pressKey(KEYCODE_COPY)
        } else if (shortcut === 'x') {
          pressKey(KEYCODE_CUT)
        } else if (shortcut === 'a') {
          pressKey(KEYCODE_A, META_CTRL)
        } else if (shortcut === 'z') {
          pressKey(KEYCODE_Z, META_CTRL)
        } else {
          return
        }
        event.preventDefault()
        return
      }
      const keycode = KEYCODES[event.key]
      if (keycode !== undefined) {
        event.preventDefault()
        send({ kind: 'key', action: ACTION_DOWN, keycode, metaState: metaFor(event) })
        return
      }
      if ((event.key.length === 1) && !event.ctrlKey) {
        event.preventDefault()
        send({ kind: 'text', text: event.key })
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      const keycode = KEYCODES[event.key]
      if ((keycode !== undefined) && !event.metaKey) {
        event.preventDefault()
        send({ kind: 'key', action: ACTION_UP, keycode, metaState: metaFor(event) })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [control])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!control || (showAnnotationBar && annTool !== 'select')) {
      return
    }
    if (event.button === 2) {
      send({ kind: 'back' })
      return
    }
    if (event.button === 1) {
      pressKey(KEYCODE_HOME)
      return
    }
    const point = toDevice(event.clientX, event.clientY, false)
    if (event.button !== 0 || !point) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerDown.current = true
    sendTouch(ACTION_DOWN, point, BUTTON_PRIMARY)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!pointerDown.current) {
      return
    }
    const point = toDevice(event.clientX, event.clientY, true)
    if (point) {
      sendTouch(ACTION_MOVE, point, BUTTON_PRIMARY)
    }
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!pointerDown.current) {
      return
    }
    pointerDown.current = false
    const point = toDevice(event.clientX, event.clientY, true)
    if (point) {
      sendTouch(ACTION_UP, point, 0)
    }
  }

  const takeShot = useCallback(async () => {
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
              showNotice('Ekran görüntüsü kaydedildi ve panoya kopyalandı')
              overlayRef.current?.clear()
              return
            }
          }
        }
      }

      const result = await window.scryno.takeScreenshot(deviceId, 'android')
      if (result.ok) {
        setFlash(true)
        window.setTimeout(() => setFlash(false), 500)
        showNotice('Ekran görüntüsü kaydedildi ve panoya kopyalandı')
        overlayRef.current?.clear()
      } else {
        showNotice(result.message)
      }
    } finally {
      setBusy(false)
    }
  }, [deviceId, showNotice])

  const toggleRecord = useCallback(async () => {
    setBusy(true)
    try {
      if (recording) {
        const result = await window.scryno.stopRecording(deviceId)
        overlayRef.current?.clear()
        if (result.ok) {
          void window.scryno.revealCapture(result.path)
        } else {
          showNotice(result.message)
        }
      } else {
        const result = await window.scryno.startRecording(deviceId)
        if (!result.ok) {
          showNotice(result.message)
        } else if (result.stopped) {
          setRecording(false)
          overlayRef.current?.clear()
          void window.scryno.revealCapture(result.path)
        }
      }
    } finally {
      setBusy(false)
    }
  }, [deviceId, recording, showNotice])

  const onDrop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setDropping(false)
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.scryno.filePath(file))
      .filter(Boolean)
    if (paths.length === 0) {
      return
    }
    showNotice('Telefona gönderiliyor…')
    const result = await window.scryno.sendFiles(deviceId, paths)
    showNotice(result.message)
  }

  return (
    <div className="ios-mirror">
      <header className="ios-bar">
        <span className="ios-label android-label" title={label}>
          {label}
        </span>
        <div className="ios-spacer" />
        {control ? (
          <>
            <button type="button" className="ios-btn" title="Geri" aria-label="Geri" onClick={() => send({ kind: 'back' })}>
              <IconBack />
            </button>
            <button type="button" className="ios-btn" title="Ana ekran" aria-label="Ana ekran" onClick={() => pressKey(KEYCODE_HOME)}>
              <IconHome />
            </button>
            <button
              type="button"
              className="ios-btn"
              title="Son uygulamalar"
              aria-label="Son uygulamalar"
              onClick={() => pressKey(KEYCODE_APP_SWITCH)}
            >
              <IconRecents />
            </button>
            <span className="android-divider" />
          </>
        ) : null}
        <button
          type="button"
          className={`ios-btn ${showAnnotationBar ? 'live' : ''}`}
          disabled={busy}
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
          disabled={busy}
          title="Ekran görüntüsü (pano + İndirilenler)"
          aria-label="Ekran görüntüsü"
          onClick={() => void takeShot()}
        >
          <IconCamera />
        </button>
        <button
          type="button"
          className={`ios-btn ${recording ? 'live' : ''}`}
          disabled={busy}
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
      </header>
      <div
        ref={stageRef}
        className={`ios-stage android-stage ${control ? 'is-interactive' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
        onDragOver={(event) => {
          event.preventDefault()
          setDropping(true)
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => void onDrop(event)}
      >
        <canvas ref={canvasRef} className={`ios-screen ${ready ? 'ready' : ''}`} />
        <AnnotationOverlay
          ref={overlayRef}
          tool={showAnnotationBar ? annTool : 'select'}
          color={annColor}
          strokeWidth={annWidth}
          laserMode={annLaser}
          toDeviceNorm={toDeviceNorm}
          onShapesChange={onShapesChange}
        />
        {!ready ? <div className="ios-loading">Ekran bağlanıyor…</div> : null}
        {dropping ? <div className="android-drop">Bırak · APK kurulur, diğer dosyalar İndirilenler’e gider</div> : null}
        {notice ? <div className="android-notice">{notice}</div> : null}
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
      <AndroidMirrorApp />
    </StrictMode>
  )
}
