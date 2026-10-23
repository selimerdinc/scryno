export type AnnotationTool = 'select' | 'pen' | 'highlighter' | 'rect' | 'circle' | 'arrow'

export interface Point {
  x: number // 0 to 1 normalized
  y: number // 0 to 1 normalized
}

export interface BaseShape {
  id: string
  color: string
  strokeWidth: number
  createdAt: number
}

export interface PenShape extends BaseShape {
  type: 'pen'
  points: Point[]
  isHighlighter?: boolean
}

export interface RectShape extends BaseShape {
  type: 'rect'
  start: Point
  end: Point
}

export interface CircleShape extends BaseShape {
  type: 'circle'
  start: Point
  end: Point
}

export interface ArrowShape extends BaseShape {
  type: 'arrow'
  start: Point
  end: Point
}

export type AnnotationShape = PenShape | RectShape | CircleShape | ArrowShape

export const ANNOTATION_COLORS = [
  { label: 'Kırmızı', value: '#ef4444' },
  { label: 'Sarı', value: '#facc15' },
  { label: 'Neon Yeşil', value: '#22c55e' },
  { label: 'Canlı Mavi', value: '#3b82f6' },
  { label: 'Beyaz', value: '#ffffff' }
]

export const STROKE_WIDTHS = [
  { label: 'İnce', value: 3 },
  { label: 'Orta', value: 6 },
  { label: 'Kalın', value: 12 }
]
