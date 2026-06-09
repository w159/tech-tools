// Minimal Swift helper to check if the default audio input device is in use.
// Outputs "1" if mic is active, "0" if idle.
// Uses CoreAudio kAudioDevicePropertyDeviceIsRunningSomewhere which works
// on both Intel and Apple Silicon Macs.

import CoreAudio
import Foundation

var defaultInputID = AudioObjectID(kAudioObjectSystemObject)
var propAddr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultInputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
)
var size = UInt32(MemoryLayout<AudioObjectID>.size)
let err = AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject), &propAddr, 0, nil, &size, &defaultInputID
)
guard err == noErr else {
    print("0")
    exit(0)
}

var isRunning: UInt32 = 0
var runAddr = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
)
size = UInt32(MemoryLayout<UInt32>.size)
let err2 = AudioObjectGetPropertyData(defaultInputID, &runAddr, 0, nil, &size, &isRunning)
guard err2 == noErr else {
    print("0")
    exit(0)
}

print(isRunning > 0 ? "1" : "0")
