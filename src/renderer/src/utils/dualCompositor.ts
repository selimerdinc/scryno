export interface DualCompositorOptions {
  androidImageSrc: string
  iosImageSrc: string
  androidLabel?: string
  iosLabel?: string
  mode?: 'mockup' | 'raw'
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = (): void => resolve(img)
    img.onerror = (err): void => reject(err)
    img.src = src
  })
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius)
  } else {
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + width - radius, y)
    ctx.arcTo(x + width, y, x + width, y + radius, radius)
    ctx.lineTo(x + width, y + height - radius)
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius)
    ctx.lineTo(x + radius, y + height)
    ctx.arcTo(x, y + height, x, y + height - radius, radius)
    ctx.lineTo(x, y + radius)
    ctx.arcTo(x, y, x + radius, y, radius)
    ctx.closePath()
  }
}

/**
 * Composites an Android screenshot and an iOS screenshot into a single high-resolution PNG.
 */
export async function compositeDualScreenshot(
  options: DualCompositorOptions
): Promise<Uint8Array> {
  const {
    androidImageSrc,
    iosImageSrc,
    androidLabel = 'Android',
    iosLabel = 'iPhone',
    mode = 'mockup'
  } = options

  const [androidImg, iosImg] = await Promise.all([
    loadImage(androidImageSrc),
    loadImage(iosImageSrc)
  ])

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context oluşturulamadı')
  }

  const screenHeight = 1600
  const androidRatio = androidImg.width / (androidImg.height || 1)
  const iosRatio = iosImg.width / (iosImg.height || 1)

  const androidWidth = Math.round(screenHeight * androidRatio)
  const iosWidth = Math.round(screenHeight * iosRatio)

  if (mode === 'raw') {
    const gap = 36
    const totalW = androidWidth + iosWidth + gap
    const totalH = screenHeight

    canvas.width = totalW
    canvas.height = totalH

    ctx.fillStyle = '#07080c'
    ctx.fillRect(0, 0, totalW, totalH)

    ctx.drawImage(androidImg, 0, 0, androidWidth, totalH)
    ctx.drawImage(iosImg, androidWidth + gap, 0, iosWidth, totalH)
  } else {
    // Premium Presentation Mockup
    const paddingX = 120
    const paddingTop = 160
    const paddingBottom = 160
    const gap = 110

    const totalW = paddingX * 2 + androidWidth + iosWidth + gap
    const totalH = paddingTop + screenHeight + paddingBottom

    canvas.width = totalW
    canvas.height = totalH

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, totalW, totalH)
    bgGrad.addColorStop(0, '#0c0e17')
    bgGrad.addColorStop(0.5, '#07080c')
    bgGrad.addColorStop(1, '#050609')
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, totalW, totalH)

    // Ambient radial glow behind devices
    const glow1 = ctx.createRadialGradient(
      paddingX + androidWidth / 2,
      paddingTop + 400,
      50,
      paddingX + androidWidth / 2,
      paddingTop + 400,
      androidWidth * 1.2
    )
    glow1.addColorStop(0, 'rgba(16, 185, 129, 0.12)') // Android emerald glow
    glow1.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = glow1
    ctx.fillRect(0, 0, totalW, totalH)

    const glow2 = ctx.createRadialGradient(
      paddingX + androidWidth + gap + iosWidth / 2,
      paddingTop + 400,
      50,
      paddingX + androidWidth + gap + iosWidth / 2,
      paddingTop + 400,
      iosWidth * 1.2
    )
    glow2.addColorStop(0, 'rgba(59, 130, 246, 0.14)') // iOS cyan-blue glow
    glow2.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = glow2
    ctx.fillRect(0, 0, totalW, totalH)

    // Header branding
    ctx.save()
    ctx.font = '700 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText('Scryno', paddingX, 90)

    ctx.font = '500 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
    ctx.fillText('Cross-Platform Side-by-Side Capture', paddingX + 130, 90)

    // Timestamp
    const nowStr = new Date().toLocaleDateString('tr-TR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
    ctx.textAlign = 'right'
    ctx.font = '500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.fillText(nowStr, totalW - paddingX, 90)
    ctx.restore()

    // Render Phone 1 (Android)
    const x1 = paddingX
    const yDevices = paddingTop
    const radiusAndroid = 34

    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
    ctx.shadowBlur = 50
    ctx.shadowOffsetY = 28
    ctx.fillStyle = '#000000'
    drawRoundedRect(ctx, x1, yDevices, androidWidth, screenHeight, radiusAndroid)
    ctx.fill()
    ctx.restore()

    ctx.save()
    drawRoundedRect(ctx, x1, yDevices, androidWidth, screenHeight, radiusAndroid)
    ctx.clip()
    ctx.drawImage(androidImg, x1, yDevices, androidWidth, screenHeight)
    ctx.restore()

    // Android screen stroke
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
    ctx.lineWidth = 2
    drawRoundedRect(ctx, x1, yDevices, androidWidth, screenHeight, radiusAndroid)
    ctx.stroke()
    ctx.restore()

    // Render Phone 2 (iOS)
    const x2 = paddingX + androidWidth + gap
    const radiusIos = 44

    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
    ctx.shadowBlur = 50
    ctx.shadowOffsetY = 28
    ctx.fillStyle = '#000000'
    drawRoundedRect(ctx, x2, yDevices, iosWidth, screenHeight, radiusIos)
    ctx.fill()
    ctx.restore()

    ctx.save()
    drawRoundedRect(ctx, x2, yDevices, iosWidth, screenHeight, radiusIos)
    ctx.clip()
    ctx.drawImage(iosImg, x2, yDevices, iosWidth, screenHeight)
    ctx.restore()

    // iOS screen stroke
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
    ctx.lineWidth = 2
    drawRoundedRect(ctx, x2, yDevices, iosWidth, screenHeight, radiusIos)
    ctx.stroke()
    ctx.restore()

    // Device labels below
    const labelY = yDevices + screenHeight + 60
    const badgeH = 46

    // Android Pill
    ctx.save()
    const aLabelText = androidLabel.includes('Android') ? androidLabel : `Android  ·  ${androidLabel}`
    ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    const aTextMetrics = ctx.measureText(aLabelText)
    const aBadgeW = aTextMetrics.width + 56
    const aBadgeX = x1 + (androidWidth - aBadgeW) / 2

    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
    drawRoundedRect(ctx, aBadgeX, labelY, aBadgeW, badgeH, 23)
    ctx.fill()
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.3)'
    ctx.lineWidth = 1.5
    drawRoundedRect(ctx, aBadgeX, labelY, aBadgeW, badgeH, 23)
    ctx.stroke()

    // Green dot
    ctx.fillStyle = '#10b981'
    ctx.beginPath()
    ctx.arc(aBadgeX + 22, labelY + badgeH / 2, 5, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#f3f4f6'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(aLabelText, aBadgeX + 38, labelY + badgeH / 2 + 1)
    ctx.restore()

    // iOS Pill
    ctx.save()
    const iLabelText = iosLabel.includes('iOS') || iosLabel.includes('iPhone') ? iosLabel : `iPhone  ·  ${iosLabel}`
    ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    const iTextMetrics = ctx.measureText(iLabelText)
    const iBadgeW = iTextMetrics.width + 56
    const iBadgeX = x2 + (iosWidth - iBadgeW) / 2

    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
    drawRoundedRect(ctx, iBadgeX, labelY, iBadgeW, badgeH, 23)
    ctx.fill()
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.35)'
    ctx.lineWidth = 1.5
    drawRoundedRect(ctx, iBadgeX, labelY, iBadgeW, badgeH, 23)
    ctx.stroke()

    // Blue dot
    ctx.fillStyle = '#3b82f6'
    ctx.beginPath()
    ctx.arc(iBadgeX + 22, labelY + badgeH / 2, 5, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#f3f4f6'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(iLabelText, iBadgeX + 38, labelY + badgeH / 2 + 1)
    ctx.restore()
  }

  // Convert to PNG Buffer
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG blob üretilemedi'))
        return
      }
      blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))).catch(reject)
    }, 'image/png')
  })
}
