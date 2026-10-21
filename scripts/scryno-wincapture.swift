import AppKit
import AVFoundation
import Foundation
import ScreenCaptureKit

// Usage:
//   scryno-wincapture shot <out.png>    → PNG of the iPhone Mirroring window
//   scryno-wincapture record <out.mp4>  → records the window until SIGINT/SIGTERM
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

func findWindow() async -> (SCWindow, SCShareableContent)? {
  guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) else {
    return nil
  }
  let windows = content.windows.filter {
    ($0.owningApplication?.applicationName == ownerName) && ($0.frame.width > 150) && ($0.frame.height > 150)
  }
  guard let window = windows.max(by: { ($0.frame.width * $0.frame.height) < ($1.frame.width * $1.frame.height) }) else {
    return nil
  }
  return (window, content)
}

func configuration(for window: SCWindow, filter: SCContentFilter) -> SCStreamConfiguration {
  let config = SCStreamConfiguration()
  let scale = Double(filter.pointPixelScale)
  config.width = Int(window.frame.width * scale)
  config.height = Int(window.frame.height * scale)
  config.showsCursor = false
  config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
  return config
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
  for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler {
      Task {
        try? await recorder.stream?.stopCapture()
        // Give the recording output a moment to flush before forcing exit.
        try? await Task.sleep(nanoseconds: 3_000_000_000)
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
  guard let (window, _) = await findWindow() else {
    fail("iPhone Mirroring penceresi bulunamadı", 2)
  }
  let filter = SCContentFilter(desktopIndependentWindow: window)
  let config = configuration(for: window, filter: filter)

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
