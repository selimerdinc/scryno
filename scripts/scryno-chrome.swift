import AppKit
import ApplicationServices

// Native title bar that docks above a mirror window (scrcpy or iPhone Mirroring).
//
// Usage: scryno-chrome --needle <title-needle|@iphone-mirroring> --label <name> --platform <android|ios>
// stdout (JSON lines): {"event":"ready"} {"event":"action","name":"screenshot|record|folder|close"}
//                      {"event":"trust","trusted":true|false}
// stdin  (JSON lines): {"recording":bool,"message":string,"kind":"ok|error|info"}

let iphoneMirroringNeedle = "@iphone-mirroring"
let barHeight: CGFloat = 40
let lostHideDelay: TimeInterval = 1.5
let ownPid = ProcessInfo.processInfo.processIdentifier

struct Options {
  var needle = ""
  var label = "Scryno"
  var platform = "android"
}

func parseOptions() -> Options {
  var options = Options()
  let argv = CommandLine.arguments
  var index = 1
  while index < argv.count {
    let value = (index + 1 < argv.count) ? argv[index + 1] : ""
    switch argv[index] {
    case "--needle":
      options.needle = value
      index += 2
    case "--label":
      options.label = value
      index += 2
    case "--platform":
      options.platform = value
      index += 2
    default:
      index += 1
    }
  }
  return options
}

func emit(_ payload: [String: Any]) {
  guard
    let data = try? JSONSerialization.data(withJSONObject: payload),
    let line = String(data: data, encoding: .utf8)
  else {
    return
  }
  FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

// MARK: - Target window

struct Target {
  let windowID: CGWindowID
  let pid: pid_t
  /// Top-left origin, global display coordinates (CoreGraphics space).
  var frame: CGRect
}

func readFrame(_ raw: [String: Any]) -> CGRect? {
  guard let dict = raw[kCGWindowBounds as String] as? NSDictionary,
    let rect = CGRect(dictionaryRepresentation: dict)
  else {
    return nil
  }
  return rect
}

func frameIsOnADisplay(_ frame: CGRect) -> Bool {
  let cocoa = cocoaRect(frame)
  return NSScreen.screens.contains { $0.frame.intersects(cocoa) }
}

func findTarget(needle: String) -> Target? {
  // optionAll: a window dragged onto another display can report isOnscreen=false
  // while still sitting on that display. On-screen matches win; the rest are fallback.
  let options = CGWindowListOption(arrayLiteral: .excludeDesktopElements)
  guard let info = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    return nil
  }
  var best: Target?
  var fallback: Target?
  for window in info {
    let layer = (window[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
    let pid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0
    guard layer == 0, pid != ownPid, let frame = readFrame(window), frame.width >= 160, frame.height >= 160 else {
      continue
    }
    guard frameIsOnADisplay(frame) else {
      continue
    }
    let owner = (window[kCGWindowOwnerName as String] as? String) ?? ""
    let name = (window[kCGWindowName as String] as? String) ?? ""
    let windowID = (window[kCGWindowNumber as String] as? NSNumber)?.uint32Value ?? 0
    let target = Target(windowID: windowID, pid: pid, frame: frame)
    let onScreen = (window[kCGWindowIsOnscreen as String] as? Bool) == true
    let slot = onScreen ? best : fallback

    if needle == iphoneMirroringNeedle {
      if owner == "iPhone Mirroring" && !name.contains("Welcome") && slot == nil {
        if onScreen {
          best = target
        } else if best == nil {
          fallback = target
        }
      }
      continue
    }
    if !needle.isEmpty && name.contains(needle) {
      if onScreen && best == nil {
        best = target
      } else if !onScreen && best == nil && fallback == nil {
        fallback = target
      }
    } else if owner.lowercased().contains("scrcpy") && fallback == nil && best == nil {
      fallback = target
    }
  }
  return best ?? fallback
}

func refreshTarget(_ target: Target) -> Target? {
  guard
    let info = CGWindowListCopyWindowInfo([.optionIncludingWindow], target.windowID) as? [[String: Any]],
    let raw = info.first,
    let frame = readFrame(raw),
    frameIsOnADisplay(frame)
  else {
    return nil
  }
  var updated = target
  updated.frame = frame
  return updated
}

func primaryHeight() -> CGFloat {
  NSScreen.screens.first?.frame.height ?? 0
}

func cocoaRect(_ rect: CGRect) -> NSRect {
  NSRect(x: rect.minX, y: primaryHeight() - rect.maxY, width: rect.width, height: rect.height)
}

/// Usable area of a screen in CoreGraphics space (origin top-left, y down).
func cgVisible(_ screen: NSScreen) -> CGRect {
  let visible = screen.visibleFrame
  return CGRect(
    x: visible.minX,
    y: primaryHeight() - visible.maxY,
    width: visible.width,
    height: visible.height
  )
}

func screen(containing point: CGPoint) -> NSScreen? {
  let cocoa = CGPoint(x: point.x, y: primaryHeight() - point.y)
  if let hit = NSScreen.screens.first(where: { $0.frame.contains(cocoa) }) {
    return hit
  }
  return NSScreen.screens.min { lhs, rhs in
    let lc = CGPoint(x: lhs.frame.midX, y: lhs.frame.midY)
    let rc = CGPoint(x: rhs.frame.midX, y: rhs.frame.midY)
    let ld = hypot(lc.x - cocoa.x, lc.y - cocoa.y)
    let rd = hypot(rc.x - cocoa.x, rc.y - cocoa.y)
    return ld < rd
  }
}

/// Keeps the window inside the screen the drag bar is on.
/// A tall window's center can still be on the screen below, so the bar — not the center —
/// decides which display it may enter.
func clampOrigin(_ origin: CGPoint, size: CGSize) -> CGPoint {
  let bar = CGPoint(x: origin.x + size.width / 2, y: origin.y - barHeight / 2)
  let center = CGPoint(x: origin.x + size.width / 2, y: origin.y + size.height / 2)
  guard let display = screen(containing: bar) ?? screen(containing: center) ?? NSScreen.main else {
    return origin
  }
  let visible = cgVisible(display)
  var x = origin.x
  var y = origin.y
  let minY = visible.minY + barHeight
  let maxY = visible.maxY - size.height
  let minX = visible.minX
  let maxX = visible.maxX - size.width
  y = minY <= maxY ? min(max(y, minY), maxY) : minY
  x = minX <= maxX ? min(max(x, minX), maxX) : minX
  return CGPoint(x: x, y: y)
}

// MARK: - Accessibility mover

final class WindowMover {
  private var element: AXUIElement?
  private var elementPid: pid_t = 0
  private var prompted = false

  func isTrusted(prompt: Bool) -> Bool {
    let shouldPrompt = prompt && !prompted
    if shouldPrompt {
      prompted = true
    }
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    return AXIsProcessTrustedWithOptions([key: shouldPrompt] as CFDictionary)
  }

  private func resolve(_ target: Target) -> AXUIElement? {
    if let element, elementPid == target.pid {
      return element
    }
    let app = AXUIElementCreateApplication(target.pid)
    var windowsRef: CFTypeRef?
    guard
      AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef) == .success,
      let windows = windowsRef as? [AXUIElement]
    else {
      return nil
    }
    var chosen: AXUIElement?
    var bestDistance = CGFloat.greatestFiniteMagnitude
    for window in windows {
      var positionRef: CFTypeRef?
      guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionRef) == .success,
        let positionValue = positionRef
      else {
        continue
      }
      var position = CGPoint.zero
      AXValueGetValue(positionValue as! AXValue, .cgPoint, &position)
      let distance = abs(position.x - target.frame.minX) + abs(position.y - target.frame.minY)
      if distance < bestDistance {
        bestDistance = distance
        chosen = window
      }
    }
    element = chosen
    elementPid = target.pid
    return chosen
  }

  @discardableResult
  func move(_ target: Target, to point: CGPoint) -> Bool {
    for attempt in 0..<2 {
      guard let window = resolve(target) else {
        return false
      }
      var position = point
      guard let value = AXValueCreate(.cgPoint, &position) else {
        return false
      }
      if AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, value) == .success {
        return true
      }
      if attempt == 0 {
        element = nil
      }
    }
    return false
  }
}

// MARK: - Views

final class ChromePanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

final class IconButton: NSButton {
  private var trackingArea: NSTrackingArea?
  var tint: NSColor = NSColor(white: 1, alpha: 0.86) {
    didSet { contentTintColor = tint }
  }

  init(symbol: String, tip: String, target: AnyObject, action: Selector) {
    super.init(frame: NSRect(x: 0, y: 0, width: 30, height: 28))
    setSymbol(symbol)
    toolTip = tip
    self.target = target
    self.action = action
    isBordered = false
    imagePosition = .imageOnly
    contentTintColor = tint
    wantsLayer = true
    layer?.cornerRadius = 7
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: 30),
      heightAnchor.constraint(equalToConstant: 28)
    ])
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  func setSymbol(_ symbol: String) {
    let config = NSImage.SymbolConfiguration(pointSize: 14, weight: .medium)
    image = NSImage(systemSymbolName: symbol, accessibilityDescription: toolTip)?
      .withSymbolConfiguration(config)
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea {
      removeTrackingArea(trackingArea)
    }
    let area = NSTrackingArea(
      rect: bounds,
      options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
      owner: self
    )
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) {
    layer?.backgroundColor = NSColor(white: 1, alpha: 0.12).cgColor
  }

  override func mouseExited(with event: NSEvent) {
    layer?.backgroundColor = nil
  }
}

final class CloseButton: NSButton {
  private var trackingArea: NSTrackingArea?

  init(target: AnyObject, action: Selector) {
    super.init(frame: NSRect(x: 0, y: 0, width: 13, height: 13))
    self.target = target
    self.action = action
    toolTip = "Yansıtmayı kapat"
    isBordered = false
    imagePosition = .imageOnly
    let config = NSImage.SymbolConfiguration(pointSize: 7, weight: .black)
    image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Kapat")?
      .withSymbolConfiguration(config)
    contentTintColor = .clear
    wantsLayer = true
    layer?.cornerRadius = 6.5
    layer?.backgroundColor = NSColor(srgbRed: 1, green: 0.373, blue: 0.341, alpha: 1).cgColor
    layer?.borderWidth = 0.5
    layer?.borderColor = NSColor(white: 0, alpha: 0.25).cgColor
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: 13),
      heightAnchor.constraint(equalToConstant: 13)
    ])
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea {
      removeTrackingArea(trackingArea)
    }
    let area = NSTrackingArea(
      rect: bounds,
      options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
      owner: self
    )
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) {
    contentTintColor = NSColor(white: 0, alpha: 0.6)
  }

  override func mouseExited(with event: NSEvent) {
    contentTintColor = .clear
  }
}

protocol DragSurfaceDelegate: AnyObject {
  func dragBegan()
  func dragMoved(by delta: CGPoint)
  func dragEnded()
}

final class DragSurface: NSVisualEffectView {
  weak var delegate: DragSurfaceDelegate?
  private var startMouse = CGPoint.zero

  override var mouseDownCanMoveWindow: Bool { false }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    startMouse = NSEvent.mouseLocation
    delegate?.dragBegan()
  }

  override func mouseDragged(with event: NSEvent) {
    let now = NSEvent.mouseLocation
    delegate?.dragMoved(by: CGPoint(x: now.x - startMouse.x, y: now.y - startMouse.y))
  }

  override func mouseUp(with event: NSEvent) {
    delegate?.dragEnded()
  }
}

// MARK: - Controller

final class ChromeController: NSObject, DragSurfaceDelegate {
  private let options: Options
  private let panel: ChromePanel
  private let surface = DragSurface()
  private let titleLabel = NSTextField(labelWithString: "")
  private let recordingDot = NSView()
  private let recordingTime = NSTextField(labelWithString: "00:00")
  private let flashView = NSView()
  private var recordButton: IconButton!
  private let mover = WindowMover()

  private var target: Target?
  private var lostSince: Date?
  private var lastSearch = Date.distantPast
  private var floating = false
  private var dragging = false
  private var dragPanelOrigin = CGPoint.zero
  private var dragTargetOrigin = CGPoint.zero
  private var announcedReady = false
  private var recordingStartedAt: Date?
  private var messageGeneration = 0

  init(options: Options) {
    self.options = options
    panel = ChromePanel(
      contentRect: NSRect(x: 0, y: 0, width: 360, height: barHeight),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    super.init()
    buildPanel()
  }

  private func buildPanel() {
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.level = .normal
    panel.hidesOnDeactivate = false
    panel.isMovable = false
    panel.becomesKeyOnlyIfNeeded = true
    panel.collectionBehavior = [.managed, .fullScreenAuxiliary]
    panel.appearance = NSAppearance(named: .darkAqua)

    surface.delegate = self
    surface.material = .hudWindow
    surface.blendingMode = .behindWindow
    surface.state = .active
    surface.wantsLayer = true
    surface.layer?.cornerRadius = 12
    surface.layer?.maskedCorners = [.layerMinXMaxYCorner, .layerMaxXMaxYCorner]
    surface.layer?.masksToBounds = true
    panel.contentView = surface

    let tint = NSView()
    tint.wantsLayer = true
    tint.layer?.backgroundColor = NSColor(srgbRed: 0.05, green: 0.06, blue: 0.09, alpha: 0.55).cgColor
    pin(tint, in: surface)

    let highlight = NSView()
    highlight.wantsLayer = true
    highlight.layer?.backgroundColor = NSColor(white: 1, alpha: 0.10).cgColor
    highlight.translatesAutoresizingMaskIntoConstraints = false
    surface.addSubview(highlight)

    let separator = NSView()
    separator.wantsLayer = true
    separator.layer?.backgroundColor = NSColor(white: 0, alpha: 0.45).cgColor
    separator.translatesAutoresizingMaskIntoConstraints = false
    surface.addSubview(separator)

    NSLayoutConstraint.activate([
      highlight.topAnchor.constraint(equalTo: surface.topAnchor),
      highlight.leadingAnchor.constraint(equalTo: surface.leadingAnchor, constant: 12),
      highlight.trailingAnchor.constraint(equalTo: surface.trailingAnchor, constant: -12),
      highlight.heightAnchor.constraint(equalToConstant: 1),
      separator.bottomAnchor.constraint(equalTo: surface.bottomAnchor),
      separator.leadingAnchor.constraint(equalTo: surface.leadingAnchor),
      separator.trailingAnchor.constraint(equalTo: surface.trailingAnchor),
      separator.heightAnchor.constraint(equalToConstant: 1)
    ])

    let close = CloseButton(target: self, action: #selector(onClose))

    let glyph = NSImageView()
    let glyphName = options.platform == "ios" ? "iphone" : "smartphone"
    glyph.image = NSImage(systemSymbolName: glyphName, accessibilityDescription: nil)
      ?? NSImage(systemSymbolName: "iphone", accessibilityDescription: nil)
    glyph.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
    glyph.contentTintColor = options.platform == "ios"
      ? NSColor(srgbRed: 0.62, green: 0.70, blue: 1, alpha: 1)
      : NSColor(srgbRed: 0.24, green: 0.86, blue: 0.52, alpha: 1)

    titleLabel.stringValue = options.label
    titleLabel.font = .systemFont(ofSize: 12.5, weight: .semibold)
    titleLabel.textColor = NSColor(white: 1, alpha: 0.92)
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.maximumNumberOfLines = 1
    titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    titleLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)

    recordingDot.wantsLayer = true
    recordingDot.layer?.cornerRadius = 3.5
    recordingDot.layer?.backgroundColor = NSColor.systemRed.cgColor
    recordingDot.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      recordingDot.widthAnchor.constraint(equalToConstant: 7),
      recordingDot.heightAnchor.constraint(equalToConstant: 7)
    ])
    recordingTime.font = .monospacedDigitSystemFont(ofSize: 11.5, weight: .semibold)
    recordingTime.textColor = NSColor(srgbRed: 1, green: 0.55, blue: 0.6, alpha: 1)
    recordingDot.isHidden = true
    recordingTime.isHidden = true

    let spacer = NSView()
    spacer.setContentHuggingPriority(.init(1), for: .horizontal)
    spacer.setContentCompressionResistancePriority(.init(1), for: .horizontal)

    let camera = IconButton(symbol: "camera", tip: "Ekran görüntüsü", target: self, action: #selector(onScreenshot))
    recordButton = IconButton(symbol: "record.circle", tip: "Video kaydet", target: self, action: #selector(onRecord))
    let folder = IconButton(symbol: "folder", tip: "Kayıt klasörü", target: self, action: #selector(onFolder))

    let stack = NSStackView(views: [close, glyph, titleLabel, recordingDot, recordingTime, spacer, camera, recordButton, folder])
    stack.orientation = .horizontal
    stack.alignment = .centerY
    stack.spacing = 6
    stack.setCustomSpacing(12, after: close)
    stack.setCustomSpacing(5, after: recordingDot)
    stack.setCustomSpacing(2, after: camera)
    stack.setCustomSpacing(2, after: recordButton)
    stack.edgeInsets = NSEdgeInsets(top: 0, left: 13, bottom: 1, right: 7)
    stack.translatesAutoresizingMaskIntoConstraints = false
    surface.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: surface.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: surface.trailingAnchor),
      stack.topAnchor.constraint(equalTo: surface.topAnchor),
      stack.bottomAnchor.constraint(equalTo: surface.bottomAnchor)
    ])

    flashView.wantsLayer = true
    flashView.layer?.backgroundColor = NSColor.white.cgColor
    flashView.alphaValue = 0
    pin(flashView, in: surface)
  }

  private func pin(_ view: NSView, in parent: NSView) {
    view.translatesAutoresizingMaskIntoConstraints = false
    parent.addSubview(view)
    NSLayoutConstraint.activate([
      view.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
      view.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
      view.topAnchor.constraint(equalTo: parent.topAnchor),
      view.bottomAnchor.constraint(equalTo: parent.bottomAnchor)
    ])
  }

  func start() {
    emit(["event": "trust", "trusted": mover.isTrusted(prompt: false)])
    let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
      self?.tick()
    }
    RunLoop.main.add(timer, forMode: .common)
    let clock = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
      self?.updateRecordingClock()
    }
    RunLoop.main.add(clock, forMode: .common)
    tick()
  }

  // MARK: Follow loop

  private func tick() {
    if dragging {
      return
    }

    if let current = target, let refreshed = refreshTarget(current) {
      target = refreshed
      lostSince = nil
      place(over: refreshed)
      updateLevel(for: refreshed)
      return
    }

    let now = Date()
    if now.timeIntervalSince(lastSearch) > 0.25 {
      lastSearch = now
      if let found = findTarget(needle: options.needle) {
        let firstSighting = target == nil
        target = found
        lostSince = nil
        if firstSighting {
          makeRoomForBar(found)
        }
        place(over: found)
        updateLevel(for: found)
        if !announcedReady {
          announcedReady = true
          emit(["event": "ready"])
        }
        return
      }
    }

    if lostSince == nil {
      lostSince = now
    }
    if let since = lostSince, now.timeIntervalSince(since) > lostHideDelay {
      target = nil
      panel.orderOut(nil)
    }
  }

  /// The bar sits above the window; nudge it down only within the screen it is already on.
  private func makeRoomForBar(_ found: Target) {
    let fitted = clampOrigin(found.frame.origin, size: found.frame.size)
    guard fitted != found.frame.origin, mover.isTrusted(prompt: false) else {
      return
    }
    mover.move(found, to: fitted)
    if let refreshed = refreshTarget(found) {
      target = refreshed
    }
  }

  private func barFrame(for frame: CGRect) -> NSRect {
    cocoaRect(CGRect(x: frame.minX, y: frame.minY - barHeight, width: frame.width, height: barHeight))
  }

  private func place(over found: Target) {
    let frame = barFrame(for: found.frame)
    if panel.frame != frame {
      panel.setFrame(frame, display: true)
    }
    if !panel.isVisible {
      panel.orderFront(nil)
      panel.order(.above, relativeTo: Int(found.windowID))
    }
  }

  private func updateLevel(for found: Target) {
    let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let shouldFloat = (front == found.pid) || (front == ownPid)
    if shouldFloat == floating {
      return
    }
    floating = shouldFloat
    panel.level = shouldFloat ? .floating : .normal
    if !shouldFloat {
      panel.order(.above, relativeTo: Int(found.windowID))
    }
  }

  // MARK: Drag

  func dragBegan() {
    guard let current = target else {
      return
    }
    if !mover.isTrusted(prompt: true) {
      showMessage("Sürüklemek için Erişilebilirlik izni ver", kind: "error")
      emit(["event": "trust", "trusted": false])
      return
    }
    dragging = true
    dragPanelOrigin = panel.frame.origin
    dragTargetOrigin = current.frame.origin
  }

  func dragMoved(by delta: CGPoint) {
    guard dragging, var current = target else {
      return
    }
    let desired = CGPoint(x: dragTargetOrigin.x + delta.x, y: dragTargetOrigin.y - delta.y)
    let targetPoint = clampOrigin(desired, size: current.frame.size)
    let applied = CGPoint(x: targetPoint.x - dragTargetOrigin.x, y: targetPoint.y - dragTargetOrigin.y)

    panel.setFrameOrigin(NSPoint(x: dragPanelOrigin.x + applied.x, y: dragPanelOrigin.y - applied.y))
    mover.move(current, to: targetPoint)
    current.frame.origin = targetPoint
    target = current
  }

  func dragEnded() {
    dragging = false
    tick()
  }

  // MARK: Actions

  @objc private func onClose() {
    emit(["event": "action", "name": "close"])
  }

  @objc private func onScreenshot() {
    flash()
    emit(["event": "action", "name": "screenshot"])
  }

  @objc private func onRecord() {
    emit(["event": "action", "name": "record"])
  }

  @objc private func onFolder() {
    emit(["event": "action", "name": "folder"])
  }

  private func flash() {
    flashView.alphaValue = 0.35
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.35
      flashView.animator().alphaValue = 0
    }
  }

  // MARK: Status from Electron

  func apply(status: [String: Any]) {
    if let recording = status["recording"] as? Bool {
      setRecording(recording)
    }
    if let message = status["message"] as? String, !message.isEmpty {
      showMessage(message, kind: (status["kind"] as? String) ?? "info")
    }
  }

  private func setRecording(_ recording: Bool) {
    if recording == (recordingStartedAt != nil) {
      return
    }
    recordingStartedAt = recording ? Date() : nil
    recordingDot.isHidden = !recording
    recordingTime.isHidden = !recording
    recordButton.setSymbol(recording ? "stop.circle.fill" : "record.circle")
    recordButton.tint = recording ? .systemRed : NSColor(white: 1, alpha: 0.86)
    recordButton.toolTip = recording ? "Kaydı bitir" : "Video kaydet"

    recordingDot.layer?.removeAllAnimations()
    if recording {
      let pulse = CABasicAnimation(keyPath: "opacity")
      pulse.fromValue = 1
      pulse.toValue = 0.25
      pulse.duration = 0.8
      pulse.autoreverses = true
      pulse.repeatCount = .infinity
      recordingDot.layer?.add(pulse, forKey: "pulse")
    }
    updateRecordingClock()
  }

  private func updateRecordingClock() {
    guard let startedAt = recordingStartedAt else {
      return
    }
    let total = Int(Date().timeIntervalSince(startedAt))
    recordingTime.stringValue = String(format: "%02d:%02d", total / 60, total % 60)
  }

  private func showMessage(_ message: String, kind: String) {
    messageGeneration += 1
    let generation = messageGeneration
    titleLabel.stringValue = message
    switch kind {
    case "ok":
      titleLabel.textColor = NSColor(srgbRed: 0.45, green: 0.92, blue: 0.62, alpha: 1)
    case "error":
      titleLabel.textColor = NSColor(srgbRed: 1, green: 0.55, blue: 0.55, alpha: 1)
    default:
      titleLabel.textColor = NSColor(white: 1, alpha: 0.7)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) { [weak self] in
      guard let self, generation == self.messageGeneration else {
        return
      }
      self.titleLabel.stringValue = self.options.label
      self.titleLabel.textColor = NSColor(white: 1, alpha: 0.92)
    }
  }
}

// MARK: - Main

let options = parseOptions()
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = ChromeController(options: options)
controller.start()

FileHandle.standardInput.readabilityHandler = { handle in
  let data = handle.availableData
  if data.isEmpty {
    handle.readabilityHandler = nil
    DispatchQueue.main.async {
      NSApp.terminate(nil)
    }
    return
  }
  let lines = String(decoding: data, as: UTF8.self).split(separator: "\n")
  for line in lines {
    guard
      let json = try? JSONSerialization.jsonObject(with: Data(line.utf8)),
      let status = json as? [String: Any]
    else {
      continue
    }
    DispatchQueue.main.async {
      if status["quit"] as? Bool == true {
        NSApp.terminate(nil)
        return
      }
      controller.apply(status: status)
    }
  }
}

app.run()
