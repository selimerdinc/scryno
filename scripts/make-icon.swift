import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Usage: swift scripts/make-icon.swift <out.png> [size]
// Draws the Scryno app icon: a tilted phone casting its screen onto a glowing display.

let arguments = Array(CommandLine.arguments.dropFirst())
let outPath = arguments.first ?? "icon.png"
let size = CGFloat(Double(arguments.dropFirst().first ?? "1024") ?? 1024)
let unit = size / 1024

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
  let r = CGFloat((hex >> 16) & 0xff) / 255
  let g = CGFloat((hex >> 8) & 0xff) / 255
  let b = CGFloat(hex & 0xff) / 255
  return CGColor(srgbRed: r, green: g, blue: b, alpha: alpha)
}

func gradient(_ colors: [CGColor], _ locations: [CGFloat]) -> CGGradient {
  CGGradient(
    colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
    colors: colors as CFArray,
    locations: locations
  )!
}

func rounded(_ rect: CGRect, _ radius: CGFloat) -> CGPath {
  CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

let space = CGColorSpace(name: CGColorSpace.sRGB)!
let pixels = Int(size)
let context = CGContext(
  data: nil,
  width: pixels,
  height: pixels,
  bitsPerComponent: 8,
  bytesPerRow: 0,
  space: space,
  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
)!

context.scaleBy(x: unit, y: unit)
// Flip to a top-left origin so the layout reads like the design grid.
context.translateBy(x: 0, y: 1024)
context.scaleBy(x: 1, y: -1)

// macOS icon grid: 824pt rounded tile centred on a 1024 canvas.
let tile = CGRect(x: 100, y: 92, width: 824, height: 824)
let tilePath = rounded(tile, 186)

context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: 18), blur: 40, color: rgb(0x000000, 0.45))
context.addPath(tilePath)
context.setFillColor(rgb(0x0b0d16))
context.fillPath()
context.restoreGState()

context.saveGState()
context.addPath(tilePath)
context.clip()
context.drawLinearGradient(
  gradient([rgb(0x20244a), rgb(0x0c0e1c), rgb(0x06070d)], [0, 0.55, 1]),
  start: CGPoint(x: 512, y: tile.minY),
  end: CGPoint(x: 512, y: tile.maxY),
  options: []
)
context.drawRadialGradient(
  gradient([rgb(0x7b7cff, 0.55), rgb(0x7b7cff, 0)], [0, 1]),
  startCenter: CGPoint(x: 300, y: 230),
  startRadius: 0,
  endCenter: CGPoint(x: 300, y: 230),
  endRadius: 520,
  options: []
)
context.drawRadialGradient(
  gradient([rgb(0x38e0c8, 0.38), rgb(0x38e0c8, 0)], [0, 1]),
  startCenter: CGPoint(x: 780, y: 800),
  startRadius: 0,
  endCenter: CGPoint(x: 780, y: 800),
  endRadius: 480,
  options: []
)

// Projected display behind the phone.
let display = CGRect(x: 438, y: 250, width: 330, height: 470)
context.saveGState()
context.translateBy(x: display.midX, y: display.midY)
context.concatenate(CGAffineTransform(a: 1, b: -0.12, c: 0, d: 1, tx: 0, ty: 0))
context.translateBy(x: -display.midX, y: -display.midY)
let displayPath = rounded(display, 54)
context.saveGState()
context.setShadow(offset: .zero, blur: 70, color: rgb(0x38e0c8, 0.75))
context.addPath(displayPath)
context.setFillColor(rgb(0x0f2a3a, 0.9))
context.fillPath()
context.restoreGState()
context.saveGState()
context.addPath(displayPath)
context.clip()
context.drawLinearGradient(
  gradient([rgb(0x38e0c8, 0.55), rgb(0x7b7cff, 0.35), rgb(0x3ddc84, 0.25)], [0, 0.6, 1]),
  start: CGPoint(x: display.minX, y: display.minY),
  end: CGPoint(x: display.maxX, y: display.maxY),
  options: []
)
context.restoreGState()
context.addPath(displayPath)
context.setStrokeColor(rgb(0xbff8ee, 0.75))
context.setLineWidth(6)
context.strokePath()
context.restoreGState()

// Light beam from the phone to the display.
context.saveGState()
let beam = CGMutablePath()
beam.move(to: CGPoint(x: 470, y: 330))
beam.addLine(to: CGPoint(x: 600, y: 300))
beam.addLine(to: CGPoint(x: 600, y: 690))
beam.addLine(to: CGPoint(x: 470, y: 650))
beam.closeSubpath()
context.addPath(beam)
context.clip()
context.drawLinearGradient(
  gradient([rgb(0xffffff, 0.22), rgb(0xffffff, 0)], [0, 1]),
  start: CGPoint(x: 470, y: 480),
  end: CGPoint(x: 620, y: 480),
  options: []
)
context.restoreGState()

// Phone, tilted toward the viewer.
let phone = CGRect(x: 236, y: 214, width: 296, height: 596)
context.saveGState()
context.translateBy(x: phone.midX, y: phone.midY)
context.rotate(by: -0.14)
context.concatenate(CGAffineTransform(a: 1, b: 0.06, c: 0, d: 1, tx: 0, ty: 0))
context.translateBy(x: -phone.midX, y: -phone.midY)

let body = rounded(phone, 64)
context.saveGState()
context.setShadow(offset: CGSize(width: 18, height: 30), blur: 50, color: rgb(0x000000, 0.65))
context.addPath(body)
context.setFillColor(rgb(0x2a2e3a))
context.fillPath()
context.restoreGState()

// Side thickness for a 3D read.
context.saveGState()
context.addPath(rounded(phone.offsetBy(dx: 14, dy: 10), 64))
context.setFillColor(rgb(0x14161d))
context.fillPath()
context.restoreGState()

context.saveGState()
context.addPath(body)
context.clip()
context.drawLinearGradient(
  gradient([rgb(0x8a91a3), rgb(0x2b2f3a), rgb(0x1a1c24), rgb(0x6b7183)], [0, 0.35, 0.7, 1]),
  start: CGPoint(x: phone.minX, y: phone.minY),
  end: CGPoint(x: phone.maxX, y: phone.maxY),
  options: []
)
context.restoreGState()

let screen = phone.insetBy(dx: 16, dy: 16)
let screenPath = rounded(screen, 50)
context.saveGState()
context.addPath(screenPath)
context.clip()
context.setFillColor(rgb(0x05060a))
context.fill(screen)
context.drawLinearGradient(
  gradient([rgb(0x2a1f6e), rgb(0x141a3a)], [0, 1]),
  start: CGPoint(x: screen.minX, y: screen.minY),
  end: CGPoint(x: screen.maxX, y: screen.maxY),
  options: []
)
let blobs: [(CGPoint, CGFloat, UInt32)] = [
  (CGPoint(x: screen.minX + 60, y: screen.minY + 90), 300, 0x7b7cff),
  (CGPoint(x: screen.maxX - 30, y: screen.midY - 40), 260, 0x38e0c8),
  (CGPoint(x: screen.minX + 90, y: screen.maxY - 80), 280, 0xff7bb5),
  (CGPoint(x: screen.maxX - 40, y: screen.maxY - 30), 220, 0x3ddc84)
]
for (center, radius, color) in blobs {
  context.drawRadialGradient(
    gradient([rgb(color, 0.95), rgb(color, 0)], [0, 1]),
    startCenter: center,
    startRadius: 0,
    endCenter: center,
    endRadius: radius,
    options: []
  )
}
context.drawRadialGradient(
  gradient([rgb(0x000000, 0), rgb(0x000000, 0.45)], [0.35, 1]),
  startCenter: CGPoint(x: screen.midX, y: screen.midY),
  startRadius: 0,
  endCenter: CGPoint(x: screen.midX, y: screen.midY),
  endRadius: 360,
  options: []
)
// Glass glare.
let glare = CGMutablePath()
glare.move(to: CGPoint(x: screen.minX, y: screen.minY + 120))
glare.addLine(to: CGPoint(x: screen.minX + 180, y: screen.minY))
glare.addLine(to: CGPoint(x: screen.minX + 300, y: screen.minY))
glare.addLine(to: CGPoint(x: screen.minX, y: screen.minY + 330))
glare.closeSubpath()
context.addPath(glare)
context.setFillColor(rgb(0xffffff, 0.16))
context.fillPath()
context.restoreGState()

// Dynamic island.
context.addPath(rounded(CGRect(x: phone.midX - 52, y: screen.minY + 22, width: 104, height: 30), 15))
context.setFillColor(rgb(0x000000))
context.fillPath()

context.addPath(body)
context.setStrokeColor(rgb(0xffffff, 0.35))
context.setLineWidth(3)
context.strokePath()
context.restoreGState()

context.restoreGState()

// Tile rim highlight.
context.addPath(rounded(tile.insetBy(dx: 1.5, dy: 1.5), 185))
context.setStrokeColor(rgb(0xffffff, 0.14))
context.setLineWidth(3)
context.strokePath()

let image = context.makeImage()!
let url = URL(fileURLWithPath: outPath) as CFURL
let destination = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
CGImageDestinationFinalize(destination)
print(outPath)
