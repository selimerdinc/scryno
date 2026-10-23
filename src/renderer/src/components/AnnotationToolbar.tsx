import { type JSX } from 'react'
import {
  ANNOTATION_COLORS,
  STROKE_WIDTHS,
  type AnnotationTool
} from '../types/annotation'

interface AnnotationToolbarProps {
  tool: AnnotationTool
  onSelectTool: (tool: AnnotationTool) => void
  color: string
  onSelectColor: (color: string) => void
  strokeWidth: number
  onSelectStrokeWidth: (width: number) => void
  laserMode: boolean
  onToggleLaserMode: () => void
  onUndo: () => void
  canUndo: boolean
  onClear: () => void
  canClear: boolean
  onSnapshot?: () => void
  onClose: () => void
}

function IconTouch(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 8.5V4.5a2 2 0 1 0-4 0v7M10 10V6.5a2 2 0 1 0-4 0v8M14 9a2 2 0 0 1 4 0v3.5M18 12.5a2 2 0 0 1 4 0V15a7 7 0 0 1-7 7H11a7 7 0 0 1-7-7v-3.5a2 2 0 0 1 4 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconPen(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconHighlighter(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m9 11-6 6v3h3l6-6M13.5 6.5l4 4M17 3l4 4-8.5 8.5-4-4L17 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18 19h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IconRect(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="4"
        y="5"
        width="16"
        height="14"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function IconCircle(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function IconArrow(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 17L17 7M17 7H9M17 7V15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconLaser(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13 2 4 14h7l-2 8 11-12h-7l2-8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconUndo(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 9h12a5 5 0 0 1 5 5v1a5 5 0 0 1-5 5H8M3 9l4-4M3 9l4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconTrash(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

function IconClose(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M18 6 6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AnnotationToolbar({
  tool,
  onSelectTool,
  color,
  onSelectColor,
  strokeWidth,
  onSelectStrokeWidth,
  laserMode,
  onToggleLaserMode,
  onUndo,
  canUndo,
  onClear,
  canClear,
  onSnapshot,
  onClose
}: AnnotationToolbarProps): JSX.Element {
  return (
    <div className="annotation-toolbar" role="toolbar" aria-label="Ekran Çizim Araçları">
      {/* Tool Buttons */}
      <div className="annotation-group">
        <button
          type="button"
          className={`ann-btn ann-touch-btn ${tool === 'select' ? 'active is-touch' : ''}`}
          title="👆 Telefonu Yönet & Ekranı Kaydır (Kısayol: Space veya T)"
          aria-label="Telefonu Yönet"
          onClick={() => onSelectTool('select')}
        >
          <IconTouch />
        </button>
        <button
          type="button"
          className={`ann-btn ${tool === 'rect' ? 'active' : ''}`}
          title="Kare / Dikdörtgen Kutu (Kısayol: R)"
          aria-label="Kare Çerçeve"
          onClick={() => onSelectTool('rect')}
        >
          <IconRect />
        </button>
        <button
          type="button"
          className={`ann-btn ${tool === 'pen' ? 'active' : ''}`}
          title="Serbest Kalem (Kısayol: P)"
          aria-label="Serbest Kalem"
          onClick={() => onSelectTool('pen')}
        >
          <IconPen />
        </button>
        <button
          type="button"
          className={`ann-btn ${tool === 'highlighter' ? 'active' : ''}`}
          title="Fosforlu Vurgulayıcı (Kısayol: H)"
          aria-label="Fosforlu Vurgulayıcı"
          onClick={() => onSelectTool('highlighter')}
        >
          <IconHighlighter />
        </button>
        <button
          type="button"
          className={`ann-btn ${tool === 'circle' ? 'active' : ''}`}
          title="Daire / Yuvarlak Vurgu"
          aria-label="Daire Vurgu"
          onClick={() => onSelectTool('circle')}
        >
          <IconCircle />
        </button>
        <button
          type="button"
          className={`ann-btn ${tool === 'arrow' ? 'active' : ''}`}
          title="Ok İşareti"
          aria-label="Ok İşareti"
          onClick={() => onSelectTool('arrow')}
        >
          <IconArrow />
        </button>
      </div>

      <div className="annotation-sep" />

      {/* Color Palette */}
      <div className="annotation-group">
        {ANNOTATION_COLORS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`ann-color-btn ${color === item.value ? 'selected' : ''}`}
            style={{ backgroundColor: item.value, color: item.value }}
            title={item.label}
            aria-label={item.label}
            onClick={() => onSelectColor(item.value)}
          />
        ))}
      </div>

      <div className="annotation-sep" />

      {/* Stroke Widths */}
      <div className="annotation-group">
        {STROKE_WIDTHS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`ann-width-btn ${strokeWidth === item.value ? 'selected' : ''}`}
            title={`Kalınlık: ${item.label}`}
            aria-label={`Kalınlık: ${item.label}`}
            onClick={() => onSelectStrokeWidth(item.value)}
          >
            <span
              className="ann-dot"
              style={{
                width: `${Math.max(4, item.value + 1)}px`,
                height: `${Math.max(4, item.value + 1)}px`
              }}
            />
          </button>
        ))}
      </div>

      <div className="annotation-sep" />

      {/* Laser / Auto-fade Toggle */}
      <button
        type="button"
        className={`ann-btn ${laserMode ? 'laser-active' : ''}`}
        title={laserMode ? 'Lazer / Geçici Çizim Açık (3 sn sonra silinir)' : 'Lazer Modu (Geçici Çizim)'}
        aria-label="Lazer Modu"
        onClick={onToggleLaserMode}
      >
        <IconLaser />
      </button>

      {/* Undo & Clear */}
      <button
        type="button"
        className="ann-btn"
        disabled={!canUndo}
        title="Geri Al"
        aria-label="Geri Al"
        onClick={onUndo}
      >
        <IconUndo />
      </button>
      <button
        type="button"
        className="ann-btn"
        disabled={!canClear}
        title="Tüm Çizimleri Temizle"
        aria-label="Temizle"
        onClick={onClear}
      >
        <IconTrash />
      </button>

      {/* Instant Snapshot with Drawing */}
      {onSnapshot ? (
        <>
          <div className="annotation-sep" />
          <button
            type="button"
            className="ann-btn"
            title="Çizimlerle Birlikte Screenshot Al"
            aria-label="Screenshot Al"
            onClick={onSnapshot}
          >
            <IconCamera />
          </button>
        </>
      ) : null}

      <button
        type="button"
        className="ann-close-btn"
        title="Çizim Çubuğunu Gizle"
        aria-label="Kapat"
        onClick={onClose}
      >
        <IconClose />
      </button>
    </div>
  )
}
