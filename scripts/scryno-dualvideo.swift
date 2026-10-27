import AVFoundation
import Foundation

// Usage: scryno-dualvideo <android.mp4> <ios.mp4> <out.mp4>
// Uses native macOS AVFoundation to merge two video tracks side-by-side into a single MP4 with hardware acceleration.

guard CommandLine.arguments.count >= 4 else {
  print("Usage: scryno-dualvideo <video1.mp4> <video2.mp4> <out.mp4>")
  exit(1)
}

let file1 = URL(fileURLWithPath: CommandLine.arguments[1])
let file2 = URL(fileURLWithPath: CommandLine.arguments[2])
let outFile = URL(fileURLWithPath: CommandLine.arguments[3])

Task {
  do {
    let asset1 = AVURLAsset(url: file1)
    let asset2 = URL(fileURLWithPath: CommandLine.arguments[2])
    let asset2Obj = AVURLAsset(url: asset2)

    guard let track1 = try await asset1.loadTracks(withMediaType: .video).first,
          let track2 = try await asset2Obj.loadTracks(withMediaType: .video).first else {
      print("Error: Could not load video tracks")
      exit(2)
    }

    let size1 = try await track1.load(.naturalSize)
    let size2 = try await track2.load(.naturalSize)
    let dur1 = try await asset1.load(.duration)
    let dur2 = try await asset2Obj.load(.duration)

    let duration = CMTimeCompare(dur1, dur2) < 0 ? dur1 : dur2

    let targetHeight: CGFloat = 1080.0
    let scale1 = targetHeight / (size1.height > 0 ? size1.height : 1080)
    let scale2 = targetHeight / (size2.height > 0 ? size2.height : 1080)

    let width1 = size1.width * scale1
    let width2 = size2.width * scale2
    let gap: CGFloat = 24.0

    let renderSize = CGSize(width: width1 + width2 + gap, height: targetHeight)

    let composition = AVMutableComposition()
    guard let compTrack1 = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
          let compTrack2 = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
      print("Error: Could not create composition tracks")
      exit(3)
    }

    let range = CMTimeRange(start: .zero, duration: duration)
    try compTrack1.insertTimeRange(range, of: track1, at: .zero)
    try compTrack2.insertTimeRange(range, of: track2, at: .zero)

    if let audio1 = try? await asset1.loadTracks(withMediaType: .audio).first,
       let compAudio1 = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
      try? compAudio1.insertTimeRange(range, of: audio1, at: .zero)
    }
    if let audio2 = try? await asset2Obj.loadTracks(withMediaType: .audio).first,
       let compAudio2 = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
      try? compAudio2.insertTimeRange(range, of: audio2, at: .zero)
    }

    let layerInst1 = AVMutableVideoCompositionLayerInstruction(assetTrack: compTrack1)
    let transform1 = CGAffineTransform(scaleX: scale1, y: scale1)
    layerInst1.setTransform(transform1, at: .zero)

    let layerInst2 = AVMutableVideoCompositionLayerInstruction(assetTrack: compTrack2)
    let transform2 = CGAffineTransform(scaleX: scale2, y: scale2).concatenating(CGAffineTransform(translationX: width1 + gap, y: 0))
    layerInst2.setTransform(transform2, at: .zero)

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    instruction.layerInstructions = [layerInst1, layerInst2]

    let fps1 = (try? await track1.load(.nominalFrameRate)) ?? 30.0
    let fps2 = (try? await track2.load(.nominalFrameRate)) ?? 30.0
    let targetFps = Int32(max(fps1, fps2) > 45 ? 60 : 30)

    let videoComp = AVMutableVideoComposition()
    videoComp.renderSize = renderSize
    videoComp.frameDuration = CMTime(value: 1, timescale: targetFps)
    videoComp.instructions = [instruction]

    try? FileManager.default.removeItem(at: outFile)

    let preset = AVAssetExportPreset1920x1080
    guard let exporter = AVAssetExportSession(asset: composition, presetName: preset) ?? AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
      print("Error: Could not create export session")
      exit(4)
    }

    exporter.outputURL = outFile
    exporter.outputFileType = .mp4
    exporter.videoComposition = videoComp

    await exporter.export()

    if exporter.status == .completed {
      print("{\"ok\":true,\"path\":\"\(outFile.path)\"}")
      exit(0)
    } else {
      print("Error: Export failed: \(String(describing: exporter.error))")
      exit(5)
    }
  } catch {
    print("Error: \(error.localizedDescription)")
    exit(6)
  }
}

RunLoop.main.run()
