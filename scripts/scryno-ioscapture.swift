import AVFoundation
import CoreImage
import CoreMediaIO
import Foundation

// Usage: scryno-ioscapture [deviceName] [maxHeight] [quality]
// Streams the iPhone screen (the same USB screen-capture device QuickTime uses) to stdout as
// "Content-Length: N\r\n\r\n<jpeg>" records. Diagnostics go to stderr as JSON lines.

let arguments = Array(CommandLine.arguments.dropFirst())
let wantedName = arguments.count > 0 ? arguments[0] : ""
let maxHeight = arguments.count > 1 ? (Double(arguments[1]) ?? 1600) : 1600
let quality = arguments.count > 2 ? (Double(arguments[2]) ?? 0.7) : 0.7

func log(_ event: String, _ detail: String = "") {
  let line = "{\"event\":\"\(event)\",\"detail\":\"\(detail.replacingOccurrences(of: "\"", with: "'"))\"}\n"
  FileHandle.standardError.write(Data(line.utf8))
}

func allowScreenCaptureDevices() {
  var address = CMIOObjectPropertyAddress(
    mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
    mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
    mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain)
  )
  var allow: UInt32 = 1
  CMIOObjectSetPropertyData(
    CMIOObjectID(kCMIOObjectSystemObject),
    &address,
    0,
    nil,
    UInt32(MemoryLayout<UInt32>.size),
    &allow
  )
}

func findScreenDevice() -> AVCaptureDevice? {
  let session = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.external],
    mediaType: nil,
    position: .unspecified
  )
  let screens = session.devices.filter { $0.hasMediaType(.muxed) }
  if !wantedName.isEmpty, let named = screens.first(where: { $0.localizedName == wantedName }) {
    return named
  }
  return screens.first
}

final class FrameWriter: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  private let context = CIContext(options: [.cacheIntermediates: false])
  private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
  private let stdout = FileHandle.standardOutput
  private var announced = false

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }
    var image = CIImage(cvPixelBuffer: pixelBuffer)
    let height = image.extent.height
    if height > maxHeight {
      let scale = maxHeight / height
      image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    }
    let options: [CIImageRepresentationOption: Any] = [
      CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): quality
    ]
    guard let jpeg = context.jpegRepresentation(of: image, colorSpace: colorSpace, options: options) else {
      return
    }
    if !announced {
      announced = true
      log("streaming", "\(Int(image.extent.width))x\(Int(image.extent.height))")
    }
    stdout.write(Data("Content-Length: \(jpeg.count)\r\n\r\n".utf8))
    stdout.write(jpeg)
  }
}

// Starting capture makes the iPhone re-enumerate its USB configuration, so the first device
// object disconnects and a new one appears. Rediscover and restart instead of exiting.
final class CaptureController {
  private let writer = FrameWriter()
  private let queue = DispatchQueue(label: "scryno.ioscapture")
  private var session: AVCaptureSession?
  private var observer: NSObjectProtocol?
  private var lostSince: Date?

  func start() {
    guard let device = findScreenDevice() else {
      if lostSince == nil {
        lostSince = Date()
      }
      if let since = lostSince, Date().timeIntervalSince(since) > 30 {
        log("error", "iPhone ekran cihazı bulunamadı (USB, kilit açık ve Güven gerekli)")
        exit(2)
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.start() }
      return
    }
    lostSince = nil

    let session = AVCaptureSession()
    guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.start() }
      return
    }
    session.addInput(input)

    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    output.setSampleBufferDelegate(writer, queue: queue)
    guard session.canAddOutput(output) else {
      log("error", "Görüntü çıkışı eklenemedi")
      exit(4)
    }
    session.addOutput(output)

    observer = NotificationCenter.default.addObserver(
      forName: AVCaptureDevice.wasDisconnectedNotification,
      object: device,
      queue: .main
    ) { [weak self] _ in
      log("reconnecting", device.localizedName)
      self?.restart()
    }

    NotificationCenter.default.addObserver(
      forName: AVCaptureSession.runtimeErrorNotification,
      object: session,
      queue: .main
    ) { note in
      let error = note.userInfo?[AVCaptureSessionErrorKey] as? NSError
      log("session-error", error?.localizedDescription ?? "unknown")
    }

    self.session = session
    session.startRunning()
    let ports = input.ports.map { "\($0.mediaType.rawValue)" }.joined(separator: ",")
    let connections = output.connections.map { "\($0.isActive)/\($0.isEnabled)" }.joined(separator: ",")
    log("started", "\(device.localizedName) running=\(session.isRunning) ports=\(ports) connections=\(connections)")
  }

  private func restart() {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
    }
    observer = nil
    session?.stopRunning()
    session = nil
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.start() }
  }
}

signal(SIGPIPE, SIG_IGN)
log("authorization", "video=\(AVCaptureDevice.authorizationStatus(for: .video).rawValue)")
allowScreenCaptureDevices()
let controller = CaptureController()
// Device discovery needs the run loop to be spinning after enabling screen-capture devices.
DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { controller.start() }
RunLoop.main.run()
