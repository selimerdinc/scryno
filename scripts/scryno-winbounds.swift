import ApplicationServices
import CoreGraphics
import Foundation

// Usage:
//   scryno-winbounds <needle>              → prints bounds JSON of the mirror window
//                                            (needle "@iphone-mirroring" targets iPhone Mirroring)
//   scryno-winbounds move <needle> <x> <y> → moves the mirror window (needs Accessibility)

struct Bounds: Codable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct Match: Codable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let owner: String
  let name: String
  let pid: Int32
}

struct MoveResult: Codable {
  let ok: Bool
  let trusted: Bool
}

// Special needle: dock to macOS's own iPhone Mirroring window instead of scrcpy.
let iphoneMirroringNeedle = "@iphone-mirroring"

let arguments = Array(CommandLine.arguments.dropFirst())
let command = arguments.first ?? ""
let isMove = command == "move"
let isSize = command == "size"
let isLarger = command == "larger"
let needle = (isLarger
  ? iphoneMirroringNeedle
  : (isMove || isSize ? arguments.dropFirst().first : arguments.first)) ?? ""

func readBounds(_ raw: [String: Any]) -> Bounds? {
  guard let dict = raw[kCGWindowBounds as String] as? [String: Any] else {
    return nil
  }
  let x = (dict["X"] as? NSNumber)?.doubleValue ?? 0
  let y = (dict["Y"] as? NSNumber)?.doubleValue ?? 0
  let width = (dict["Width"] as? NSNumber)?.doubleValue ?? 0
  let height = (dict["Height"] as? NSNumber)?.doubleValue ?? 0
  if width < 180 || height < 180 {
    return nil
  }
  return Bounds(x: x, y: y, width: width, height: height)
}

func findMirror() -> Match? {
  let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
  guard let info = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    return nil
  }

  var titleMatches: [Match] = []
  var scrcpyMatches: [Match] = []

  for window in info {
    let layer = (window[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
    if layer != 0 {
      continue
    }

    let owner = (window[kCGWindowOwnerName as String] as? String) ?? ""
    let name = (window[kCGWindowName as String] as? String) ?? ""
    let ownerLower = owner.lowercased()
    let pid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0

    if ownerLower.contains("electron") || ownerLower.contains("scryno") {
      continue
    }

    guard let bounds = readBounds(window) else {
      continue
    }

    let match = Match(
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      owner: owner,
      name: name,
      pid: pid
    )

    if needle == iphoneMirroringNeedle {
      if owner == "iPhone Mirroring" {
        titleMatches.append(match)
      }
      continue
    }

    if !needle.isEmpty && (name.contains(needle) || name.localizedCaseInsensitiveContains("Scryno")) {
      titleMatches.append(match)
    }

    if ownerLower.contains("scrcpy") || ownerLower.contains("sdl") {
      scrcpyMatches.append(match)
    }
  }

  func largest(_ items: [Match]) -> Match? {
    items.max { ($0.width * $0.height) < ($1.width * $1.height) }
  }

  return largest(titleMatches) ?? largest(scrcpyMatches)
}

func printJSON<T: Encodable>(_ value: T) {
  if let data = try? JSONEncoder().encode(value), let line = String(data: data, encoding: .utf8) {
    print(line)
  } else {
    print("{}")
  }
}

func moveMirror(_ mirror: Match, to point: CGPoint) -> MoveResult {
  let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
  guard AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary) else {
    return MoveResult(ok: false, trusted: false)
  }

  let app = AXUIElementCreateApplication(mirror.pid)
  var windowsRef: CFTypeRef?
  guard
    AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef) == .success,
    let windows = windowsRef as? [AXUIElement]
  else {
    return MoveResult(ok: false, trusted: true)
  }

  // Pick the AX window closest to the CG bounds we matched.
  var target: AXUIElement?
  var bestDistance = Double.greatestFiniteMagnitude
  for window in windows {
    var positionRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionRef) == .success,
      let positionValue = positionRef
    else {
      continue
    }
    var position = CGPoint.zero
    AXValueGetValue(positionValue as! AXValue, .cgPoint, &position)
    let distance = abs(Double(position.x) - mirror.x) + abs(Double(position.y) - mirror.y)
    if distance < bestDistance {
      bestDistance = distance
      target = window
    }
  }

  guard let window = target else {
    return MoveResult(ok: false, trusted: true)
  }

  var newPosition = point
  guard let value = AXValueCreate(.cgPoint, &newPosition) else {
    return MoveResult(ok: false, trusted: true)
  }
  let status = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, value)
  return MoveResult(ok: status == .success, trusted: true)
}

func axWindow(pid: pid_t, near mirror: Match) -> AXUIElement? {
  let app = AXUIElementCreateApplication(pid)
  var windowsRef: CFTypeRef?
  guard
    AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef) == .success,
    let windows = windowsRef as? [AXUIElement]
  else {
    return nil
  }
  var target: AXUIElement?
  var bestDistance = Double.greatestFiniteMagnitude
  for window in windows {
    var positionRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionRef) == .success,
      let positionValue = positionRef
    else {
      continue
    }
    var position = CGPoint.zero
    AXValueGetValue(positionValue as! AXValue, .cgPoint, &position)
    let distance = abs(Double(position.x) - mirror.x) + abs(Double(position.y) - mirror.y)
    if distance < bestDistance {
      bestDistance = distance
      target = window
    }
  }
  return target
}

func resizeMirror(_ mirror: Match, to size: CGSize) -> MoveResult {
  guard AXIsProcessTrusted() else {
    return MoveResult(ok: false, trusted: false)
  }
  guard let window = axWindow(pid: mirror.pid, near: mirror) else {
    return MoveResult(ok: false, trusted: true)
  }
  var newSize = size
  guard let value = AXValueCreate(.cgSize, &newSize) else {
    return MoveResult(ok: false, trusted: true)
  }
  let status = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, value)
  return MoveResult(ok: status == .success, trusted: true)
}

func iphoneMirroringPid() -> pid_t? {
  let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
  guard let info = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    return nil
  }
  for window in info {
    let owner = (window[kCGWindowOwnerName as String] as? String) ?? ""
    if owner == "iPhone Mirroring" {
      return (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
    }
  }
  return nil
}

/// iPhone Mirroring ignores AX size. Its View menu has one larger step.
func enlargeIphoneMirroring() -> Bool {
  guard let pid = iphoneMirroringPid() else {
    return false
  }
  let app = AXUIElementCreateApplication(pid)
  var menuRef: CFTypeRef?
  guard AXUIElementCopyAttributeValue(app, kAXMenuBarAttribute as CFString, &menuRef) == .success,
    let menu = menuRef
  else {
    return false
  }

  func findItem(_ element: AXUIElement) -> AXUIElement? {
    var titleRef: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &titleRef)
    if (titleRef as? String) == "Larger" {
      return element
    }
    var childrenRef: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef)
    for child in (childrenRef as? [AXUIElement]) ?? [] {
      if let found = findItem(child) {
        return found
      }
    }
    return nil
  }

  guard let item = findItem(menu as! AXUIElement) else {
    return false
  }
  return AXUIElementPerformAction(item, kAXPressAction as CFString) == .success
}

if isLarger {
  _ = enlargeIphoneMirroring()
  usleep(250_000)
  if let chosen = findMirror() {
    printJSON(chosen)
  } else {
    print("{}")
  }
} else if isSize {
  let rest = Array(arguments.dropFirst(2))
  guard
    rest.count >= 2,
    let width = Double(rest[0]),
    let height = Double(rest[1]),
    let mirror = findMirror()
  else {
    printJSON(MoveResult(ok: false, trusted: true))
    exit(0)
  }
  let result = resizeMirror(mirror, to: CGSize(width: width, height: height))
  usleep(150_000)
  if result.ok, let chosen = findMirror() {
    printJSON(chosen)
  } else {
    printJSON(result)
  }
} else if isMove {
  let rest = Array(arguments.dropFirst(2))
  guard
    rest.count >= 2,
    let x = Double(rest[0]),
    let y = Double(rest[1]),
    let mirror = findMirror()
  else {
    printJSON(MoveResult(ok: false, trusted: true))
    exit(0)
  }
  printJSON(moveMirror(mirror, to: CGPoint(x: x, y: y)))
} else if let chosen = findMirror() {
  printJSON(chosen)
} else {
  print("{}")
}
