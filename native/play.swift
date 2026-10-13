import AVFoundation
import CoreAudio
import Foundation

struct Device: Codable {
    let uid: String
    let name: String
    let id: UInt32
    let isDefault: Bool
}

func stringProperty(
    _ object: AudioObjectID,
    selector: AudioObjectPropertySelector,
    scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(object, &address, 0, nil, &size) == noErr, size > 0 else {
        return nil
    }
    var value = "" as CFString
    let status = withUnsafeMutablePointer(to: &value) { pointer in
        AudioObjectGetPropertyData(object, &address, 0, nil, &size, pointer)
    }
    guard status == noErr else { return nil }
    return value as String
}

func isOutput(_ id: AudioDeviceID) -> Bool {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreamConfiguration,
        mScope: kAudioDevicePropertyScopeOutput,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr, size > 0 else {
        return false
    }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, raw) == noErr else { return false }
    let buffers = raw.assumingMemoryBound(to: AudioBufferList.self).pointee.mNumberBuffers
    return buffers > 0
}

func defaultOutputID() -> AudioDeviceID {
    var device = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
    return device
}

func outputDevices() -> [Device] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else {
        return []
    }
    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var ids = [AudioDeviceID](repeating: 0, count: count)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else {
        return []
    }
    let fallback = defaultOutputID()
    return ids.compactMap { id in
        guard isOutput(id) else { return nil }
        let uid = stringProperty(id, selector: kAudioDevicePropertyDeviceUID) ?? "\(id)"
        let name = stringProperty(id, selector: kAudioObjectPropertyName) ?? uid
        return Device(uid: uid, name: name, id: id, isDefault: id == fallback)
    }
}

func deviceID(forUID uid: String) -> AudioDeviceID? {
    outputDevices().first { $0.uid == uid }?.id
}

func play(url: URL, device: AudioDeviceID?) throws {
    let file = try AVAudioFile(forReading: url)
    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: file.processingFormat)

    if let device, let audioUnit = engine.outputNode.audioUnit {
        var selected = device
        let status = AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &selected,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )
        if status != noErr {
            fputs("vivic-play: device select failed \(status)\n", stderr)
        }
    }

    engine.prepare()
    try engine.start()
    let semaphore = DispatchSemaphore(value: 0)
    player.scheduleFile(file, at: nil) {
        semaphore.signal()
    }
    player.play()
    _ = semaphore.wait(timeout: .now() + 180)
    player.stop()
    engine.stop()
}

let args = Array(CommandLine.arguments.dropFirst())
if args.first == "list" {
    let data = try JSONEncoder().encode(outputDevices())
    FileHandle.standardOutput.write(data)
    exit(0)
}

var uid: String?
var filePath: String?
var index = 0
while index < args.count {
    let arg = args[index]
    if arg == "--uid" {
        index += 1
        if index < args.count { uid = args[index] }
    } else {
        filePath = arg
    }
    index += 1
}

guard let filePath else {
    fputs("usage: vivic-play list | vivic-play [--uid UID] file.aiff\n", stderr)
    exit(2)
}

let device = uid.flatMap(deviceID(forUID:))
try play(url: URL(fileURLWithPath: filePath), device: device)
