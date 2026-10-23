import AppKit
import AVFoundation
import Foundation
import ScreenCaptureKit

// Usage:
//   scryno-wincapture shot <out.png>    → PNG of the iPhone Mirroring window
//   scryno-wincapture record <out.mp4>  → records the window (+ annotations) until stdin EOF or SIGINT
// Requires Screen Recording permission for the parent app.

let ownerName = "iPhone Mirroring"
let arguments = Array(CommandLine.arguments.dropFirst())

func fail(_ message: String, _ code: Int32) -> Never {
  FileHandle.standardError.write(Data("{\"error\":\"\(message)\"}\n".utf8))
  exit(code)
}

guard arguments.count >= 2 else {
  fail("usage: scryno-wincapture shot|record <path>", 64)
}
let mode = arguments[0]
let outURL = URL(fileURLWithPath: arguments[1])

struct WindowTarget {
  let mirrorWindow: SCWindow
  let overlayWindow: SCWindow?
  let display: SCDisplay?
}

func findTargets() async -> WindowTarget? {
  guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) else {
    return nil
  }
  let mirrorWindows = content.windows.filter {
    ($0.owningApplication?.applicationName == ownerName) && ($0.frame.width > 150) && ($0.frame.height > 150)
  }
  guard let mirrorWindow = mirrorWindows.max(by: { ($0.frame.width * $0.frame.height) < ($1.frame.width * $1.frame.height) }) else {
    return nil
  }

  // Find Scryno overlay window that sits right on top of iPhone Mirroring
  let overlayWindow = content.windows.first { win in
    let app = win.owningApplication?.applicationName ?? ""
    let title = win.title ?? ""
    let isScryno = app.contains("Scryno") || title.contains("Scryno") || title.contains("Overlay")
    let closeX = abs(win.frame.origin.x - mirrorWindow.frame.origin.x) < 40
    let closeY = abs(win.frame.origin.y - mirrorWindow.frame.origin.y) < 40
    let closeW = abs(win.frame.width - mirrorWindow.frame.width) < 40
    let closeH = abs(win.frame.height - mirrorWindow.frame.height) < 40
    return isScryno && closeX && closeY && closeW && closeH
  }

  let display = content.displays.first { d in
    d.frame.intersects(mirrorWindow.frame)
  } ?? content.displays.first

  return WindowTarget(mirrorWindow: mirrorWindow, overlayWindow: overlayWindow, display: display)
}

final class Recorder: NSObject, SCRecordingOutputDelegate, SCStreamDelegate {
  var stream: SCStream?
  var finished = false

  func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    finished = true
    exit(0)
  }

  func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
    fail("recording failed: \(error.localizedDescription)", 5)
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    fail("stream stopped: \(error.localizedDescription)", 6)
  }
}

let recorder = Recorder()

func installStopHandlers() {
  FileHandle.standardInput.readabilityHandler = { handle in
    let data = handle.availableData
    if data.isEmpty {
      handle.readabilityHandler = nil
      Task {
        try? await recorder.stream?.stopCapture()
        try? await Task.sleep(nanoseconds: 800_000_000)
        exit(0)
      }
    }
  }

  for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler {
      Task {
        try? await recorder.stream?.stopCapture()
        // Give the recording output a moment to flush before forcing exit.
        try? await Task.sleep(nanoseconds: 800_000_000)
        exit(0)
      }
    }
    source.resume()
    signalSources.append(source)
  }
}

var signalSources: [DispatchSourceSignal] = []

// ScreenCaptureKit needs a WindowServer connection, which a bare CLI only gets via NSApplication.
_ = NSApplication.shared

Task {
  guard let target = await findTargets() else {
    fail("iPhone Mirroring penceresi bulunamadı", 2)
  }

  let mirrorWindow = target.mirrorWindow

  // For screenshot and small previews ('shot'), ALWAYS capture ONLY the independent window.
  // This guarantees background windows (like Scryno main window) never leak into the preview.
  if mode == "shot" {
    let filter = SCContentFilter(desktopIndependentWindow: mirrorWindow)
    let scale = Double(filter.pointPixelScale)
    let config = SCStreamConfiguration()
    config.width = Int(mirrorWindow.frame.width * scale)
    config.height = Int(mirrorWindow.frame.height * scale)
    config.showsCursor = false

    do {
      let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
      guard let destination = CGImageDestinationCreateWithURL(outURL as CFURL, "public.png" as CFString, 1, nil) else {
        fail("PNG oluşturulamadı", 3)
      }
      CGImageDestinationAddImage(destination, image, nil)
      CGImageDestinationFinalize(destination)
      exit(0)
    } catch {
      fail("ekran görüntüsü alınamadı: \(error.localizedDescription)", 4)
    }
  }

  // For video recording ('record'):
  // If overlay window exists, capture BOTH mirrorWindow + overlayWindow strictly without any background windows.
  var filter: SCContentFilter
  var config = SCStreamConfiguration()

  if let display = target.display, let overlay = target.overlayWindow {
    filter = SCContentFilter(display: display, including: [mirrorWindow, overlay])
    let scale = Double(filter.pointPixelScale)
    let localX = mirrorWindow.frame.origin.x - display.frame.origin.x
    let localY = mirrorWindow.frame.origin.y - display.frame.origin.y

    config.sourceRect = CGRect(
      x: localX,
      y: localY,
      width: mirrorWindow.frame.width,
      height: mirrorWindow.frame.height
    )
    config.width = Int(mirrorWindow.frame.width * scale)
    config.height = Int(mirrorWindow.frame.height * scale)
  } else {
    filter = SCContentFilter(desktopIndependentWindow: mirrorWindow)
    let scale = Double(filter.pointPixelScale)
    config.width = Int(mirrorWindow.frame.width * scale)
    config.height = Int(mirrorWindow.frame.height * scale)
  }

  config.showsCursor = false
  config.minimumFrameInterval = CMTime(value: 1, timescale: 60)

  let recordingConfig = SCRecordingOutputConfiguration()
  recordingConfig.outputURL = outURL
  recordingConfig.outputFileType = .mp4
  let output = SCRecordingOutput(configuration: recordingConfig, delegate: recorder)

  let stream = SCStream(filter: filter, configuration: config, delegate: recorder)
  do {
    try stream.addRecordingOutput(output)
    try await stream.startCapture()
  } catch {
    fail("kayıt başlatılamadı: \(error.localizedDescription)", 5)
  }
  recorder.stream = stream
  installStopHandlers()
  FileHandle.standardError.write(Data("{\"event\":\"recording\"}\n".utf8))
}

RunLoop.main.run()
