import type { AnnotationShape } from '../types/annotation'

export function renderAnnotationShapes(
  ctx: CanvasRenderingContext2D,
  shapes: AnnotationShape[],
  width: number,
  height: number,
  options?: { fadeDuration?: number; now?: number }
): void {
  if (shapes.length === 0 || width <= 0 || height <= 0) {
    return
  }

  const now = options?.now ?? Date.now()
  const fadeDuration = options?.fadeDuration ?? 0
  const scale = width / 720 // baseline 720p scaling

  for (const shape of shapes) {
    let alpha = 1
    if (fadeDuration > 0) {
      const age = now - shape.createdAt
      if (age > fadeDuration) {
        continue
      }
      if (age > fadeDuration - 800) {
        alpha = Math.max(0, (fadeDuration - age) / 800)
      }
    }

    ctx.save()
    ctx.globalAlpha = alpha

    const sw = Math.max(2, shape.strokeWidth * scale)

    if (shape.type === 'pen') {
      if (shape.points.length < 2) {
        ctx.restore()
        continue
      }
      ctx.strokeStyle = shape.color
      ctx.lineWidth = shape.isHighlighter ? sw * 3.6 : sw
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (shape.isHighlighter) {
        ctx.globalAlpha = alpha * 0.42
      }
      ctx.beginPath()
      ctx.moveTo(shape.points[0].x * width, shape.points[0].y * height)
      for (let i = 1; i < shape.points.length; i += 1) {
        ctx.lineTo(shape.points[i].x * width, shape.points[i].y * height)
      }
      ctx.stroke()
    } else if (shape.type === 'rect') {
      const rx = Math.min(shape.start.x, shape.end.x) * width
      const ry = Math.min(shape.start.y, shape.end.y) * height
      const rw = Math.abs(shape.end.x - shape.start.x) * width
      const rh = Math.abs(shape.end.y - shape.start.y) * height

      if (rw < 2 && rh < 2) {
        ctx.restore()
        continue
      }

      ctx.strokeStyle = shape.color
      ctx.lineWidth = sw
      ctx.lineJoin = 'round'

      const radius = Math.min(10 * scale, Math.min(rw, rh) / 4)
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(rx, ry, rw, rh, radius)
      } else {
        ctx.rect(rx, ry, rw, rh)
      }
      ctx.stroke()
    } else if (shape.type === 'circle') {
      const cx = ((shape.start.x + shape.end.x) / 2) * width
      const cy = ((shape.start.y + shape.end.y) / 2) * height
      const rx = (Math.abs(shape.end.x - shape.start.x) / 2) * width
      const ry = (Math.abs(shape.end.y - shape.start.y) / 2) * height

      if (rx < 2 && ry < 2) {
        ctx.restore()
        continue
      }

      ctx.strokeStyle = shape.color
      ctx.lineWidth = sw
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (shape.type === 'arrow') {
      const x1 = shape.start.x * width
      const y1 = shape.start.y * height
      const x2 = shape.end.x * width
      const y2 = shape.end.y * height

      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy)
      if (len < 6) {
        ctx.restore()
        continue
      }

      ctx.strokeStyle = shape.color
      ctx.fillStyle = shape.color
      ctx.lineWidth = sw
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      // Line stem
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()

      // Arrow head
      const headLen = Math.min(len * 0.45, Math.max(14 * scale, sw * 3.4))
      const angle = Math.atan2(dy, dx)
      const arrowAngle = Math.PI / 6.5 // ~27 degrees

      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(
        x2 - headLen * Math.cos(angle - arrowAngle),
        y2 - headLen * Math.sin(angle - arrowAngle)
      )
      ctx.lineTo(
        x2 - headLen * Math.cos(angle + arrowAngle),
        y2 - headLen * Math.sin(angle + arrowAngle)
      )
      ctx.closePath()
      ctx.fill()
    }

    ctx.restore()
  }
}
