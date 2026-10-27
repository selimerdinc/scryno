import AppKit
import AVFoundation
import Foundation
import ScreenCaptureKit

// Usage:
//   scryno-wincapture shot <out.png>    → PNG of the iPhone Mirroring window
//   scryno-wincapture record <out.mp4>  → records the window until SIGINT or SIGTERM
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

func findMirrorWindow() async -> SCWindow? {
  if let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) {
    let mirrorWindows = content.windows.filter {
      ($0.owningApplication?.applicationName == ownerName) && ($0.frame.width > 150) && ($0.frame.height > 150)
    }
    if let best = mirrorWindows.max(by: { ($0.frame.width * $0.frame.height) < ($1.frame.width * $1.frame.height) }) {
      return best
    }
  }
  if let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false) {
    let mirrorWindows = content.windows.filter {
      ($0.owningApplication?.applicationName == ownerName) && ($0.frame.width > 150) && ($0.frame.height > 150)
    }
    return mirrorWindows.max(by: { ($0.frame.width * $0.frame.height) < ($1.frame.width * $1.frame.height) })
  }
  return nil
}

func findOverlayWindow(for mirrorWindow: SCWindow) async -> SCWindow? {
  guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) else {
    return nil
  }
  return content.windows.first { w in
    guard w.owningApplication?.applicationName == "Scryno" else { return false }
    if let title = w.title, title.contains("Overlay") { return true }
    let dx = abs(w.frame.origin.x - mirrorWindow.frame.origin.x)
    let dy = abs(w.frame.origin.y - mirrorWindow.frame.origin.y)
    let dw = abs(w.frame.width - mirrorWindow.frame.width)
    let dh = abs(w.frame.height - mirrorWindow.frame.height)
    return dx < 60 && dy < 60 && dw < 60 && dh < 60
  }
}

final class Recorder: NSObject, SCRecordingOutputDelegate, SCStreamDelegate {
  var stream: SCStream?
  var output: SCRecordingOutput?
  var filter: SCContentFilter?
  var config: SCStreamConfiguration?
  var recordingConfig: SCRecordingOutputConfiguration?
  var overlayTimer: DispatchSourceTimer?
  var stopRequested = false
  var finished = false

  func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
    FileHandle.standardError.write(Data("{\"event\":\"recording-started\"}\n".utf8))
  }

  func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    finished = true
    FileHandle.standardError.write(Data("{\"event\":\"recording-finished\",\"stopRequested\":\(stopRequested)}\n".utf8))
    if stopRequested {
      exit(0)
    } else {
      FileHandle.standardError.write(Data("{\"event\":\"warning-finished-without-stop-requested\"}\n".utf8))
    }
  }

  func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
    let ns = error as NSError
    FileHandle.standardError.write(Data("{\"event\":\"recording-error\",\"code\":\(ns.code),\"detail\":\"\(ns.localizedDescription)\"}\n".utf8))
    if stopRequested {
      exit(0)
    }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    let ns = error as NSError
    FileHandle.standardError.write(Data("{\"event\":\"stream-stopped\",\"code\":\(ns.code),\"detail\":\"\(ns.localizedDescription)\"}\n".utf8))
    if stopRequested {
      exit(0)
    }
  }
}

let recorder = Recorder()

func requestStop(reason: String) {
  FileHandle.standardError.write(Data("{\"event\":\"requestStop\",\"reason\":\"\(reason)\"}\n".utf8))
  guard !recorder.stopRequested else { return }
  recorder.stopRequested = true
  recorder.overlayTimer?.cancel()
  recorder.overlayTimer = nil
  Task {
    if let stream = recorder.stream {
      try? await stream.stopCapture()
    }
  }
  // Fallback timeout: if recordingOutputDidFinishRecording hasn't fired in 8 seconds, exit
  DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) {
    exit(0)
  }
}

func installStopHandlers() {
  for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler {
      requestStop(reason: "signal-\(sig)")
    }
    source.resume()
    signalSources.append(source)
  }
}

var signalSources: [DispatchSourceSignal] = []
var parentWatch: DispatchSourceTimer?

// Finalize the recording if Scryno exits without signalling us (crash / force quit).
func installParentWatch() {
  let parentPid = getppid()
  let timer = DispatchSource.makeTimerSource(queue: .main)
  timer.schedule(deadline: .now() + 1.0, repeating: 1.0)
  timer.setEventHandler {
    if getppid() != parentPid {
      requestStop(reason: "parent-exited")
    }
  }
  timer.resume()
  parentWatch = timer
}

// ScreenCaptureKit needs a WindowServer connection, which a bare CLI only gets via NSApplication.
_ = NSApplication.shared

Task {
  guard let mirrorWindow = await findMirrorWindow() else {
    fail("iPhone Mirroring penceresi bulunamadı", 2)
  }

  let overlayWindow = await findOverlayWindow(for: mirrorWindow)
  var filter: SCContentFilter
  var sourceRect: CGRect?

  if let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true),
     let display = content.displays.first(where: { $0.frame.intersects(mirrorWindow.frame) }) {
    var includeWindows = [mirrorWindow]
    if let overlay = overlayWindow {
      includeWindows.append(overlay)
      FileHandle.standardError.write(Data("{\"event\":\"overlay-included\"}\n".utf8))
    }
    filter = SCContentFilter(display: display, including: includeWindows)
    let localOriginX = mirrorWindow.frame.origin.x - display.frame.origin.x
    let localOriginY = mirrorWindow.frame.origin.y - display.frame.origin.y
    sourceRect = CGRect(x: localOriginX, y: localOriginY, width: mirrorWindow.frame.width, height: mirrorWindow.frame.height)
  } else {
    filter = SCContentFilter(desktopIndependentWindow: mirrorWindow)
  }

  let scale = Double(filter.pointPixelScale)

  let config = SCStreamConfiguration()
  if let rect = sourceRect {
    config.sourceRect = rect
  }
  config.width = Int(mirrorWindow.frame.width * scale)
  config.height = Int(mirrorWindow.frame.height * scale)
  config.scalesToFit = true
  config.showsCursor = false
  config.pixelFormat = kCVPixelFormatType_32BGRA
  config.capturesAudio = false
  if #available(macOS 15.0, *) {
    config.captureMicrophone = false
  }
  config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
  config.queueDepth = 5

  if mode == "shot" {
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

  // Video recording mode ('record')
  let recordingConfig = SCRecordingOutputConfiguration()
  recordingConfig.outputURL = outURL
  recordingConfig.outputFileType = .mp4
  recordingConfig.videoCodecType = .h264
  let output = SCRecordingOutput(configuration: recordingConfig, delegate: recorder)

  let stream = SCStream(filter: filter, configuration: config, delegate: recorder)
  do {
    try stream.addRecordingOutput(output)
    try await stream.startCapture()
  } catch {
    fail("kayıt başlatılamadı: \(error.localizedDescription)", 5)
  }

  recorder.filter = filter
  recorder.config = config
  recorder.recordingConfig = recordingConfig
  recorder.stream = stream
  recorder.output = output

  var currentOverlayID: CGWindowID? = overlayWindow?.windowID
  let overlayTimer = DispatchSource.makeTimerSource(queue: .main)
  overlayTimer.schedule(deadline: .now() + 1.0, repeating: 1.0)
  overlayTimer.setEventHandler {
    Task {
      guard let stream = recorder.stream, !recorder.stopRequested else { return }
      let latestOverlay = await findOverlayWindow(for: mirrorWindow)
      let newOverlayID = latestOverlay?.windowID
      if newOverlayID != currentOverlayID {
        currentOverlayID = newOverlayID
        FileHandle.standardError.write(Data("{\"event\":\"overlay-changed\",\"hasOverlay\":\(newOverlayID != nil)}\n".utf8))
        if let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true),
           let display = content.displays.first(where: { $0.frame.intersects(mirrorWindow.frame) }) {
          var includeList = [mirrorWindow]
          if let ov = latestOverlay {
            includeList.append(ov)
          }
          let updatedFilter = SCContentFilter(display: display, including: includeList)
          recorder.filter = updatedFilter
          try? await stream.updateContentFilter(updatedFilter)
        }
      }
    }
  }
  overlayTimer.resume()
  recorder.overlayTimer = overlayTimer

  installStopHandlers()
  installParentWatch()
  FileHandle.standardError.write(Data("{\"event\":\"recording\"}\n".utf8))
}

RunLoop.main.run()


