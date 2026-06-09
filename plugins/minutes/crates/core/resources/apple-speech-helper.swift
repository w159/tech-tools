import AVFAudio
import CoreMedia
import Foundation
import Speech

private let schemaVersion = 1

struct ModuleCapability: Codable {
    let moduleId: String
    let isAvailable: Bool?
    let assetStatus: String
    let supportedLocales: [String]
    let installedLocales: [String]
}

struct CapabilityResponse: Codable {
    let kind: String
    let schemaVersion: Int
    let osVersion: String
    let runtimeSupported: Bool
    let readOnly: Bool
    let speechTranscriber: ModuleCapability
    let dictationTranscriber: ModuleCapability
    let notes: [String]
}

struct TranscriptSegment: Codable {
    let startMs: UInt64
    let durationMs: UInt64
    let text: String
}

struct TranscriptionResponse: Codable {
    let kind: String
    let schemaVersion: Int
    let moduleId: String
    let locale: String
    let ensureAssets: Bool
    let osVersion: String
    let runtimeSupported: Bool
    let assetStatusBefore: String
    let assetStatusAfter: String
    let totalElapsedMs: UInt64
    let firstResultElapsedMs: UInt64?
    let transcript: String
    let wordCount: Int
    let segments: [TranscriptSegment]
    let notes: [String]
    let error: String?
}

enum HelperError: Error {
    case usage(String)
    case invalidAudioPath(String)
    case unsupportedRuntime(String)
    case speechFailure(String)
}

@main
struct AppleSpeechHelper {
    static func main() async {
        do {
            let payload = try await run(arguments: Array(CommandLine.arguments.dropFirst()))
            try writeJSON(payload)
        } catch let error as HelperError {
            let payload = TranscriptionResponse(
                kind: "transcription",
                schemaVersion: schemaVersion,
                moduleId: "unknown",
                locale: Locale.current.identifier,
                ensureAssets: false,
                osVersion: ProcessInfo.processInfo.operatingSystemVersionString,
                runtimeSupported: false,
                assetStatusBefore: "unknown",
                assetStatusAfter: "unknown",
                totalElapsedMs: 0,
                firstResultElapsedMs: nil,
                transcript: "",
                wordCount: 0,
                segments: [],
                notes: [],
                error: String(describing: error)
            )
            try? writeJSON(payload)
            Foundation.exit(1)
        } catch {
            let payload = TranscriptionResponse(
                kind: "transcription",
                schemaVersion: schemaVersion,
                moduleId: "unknown",
                locale: Locale.current.identifier,
                ensureAssets: false,
                osVersion: ProcessInfo.processInfo.operatingSystemVersionString,
                runtimeSupported: false,
                assetStatusBefore: "unknown",
                assetStatusAfter: "unknown",
                totalElapsedMs: 0,
                firstResultElapsedMs: nil,
                transcript: "",
                wordCount: 0,
                segments: [],
                notes: [],
                error: String(describing: error)
            )
            try? writeJSON(payload)
            Foundation.exit(1)
        }
    }

    static func run(arguments: [String]) async throws -> any Encodable {
        guard let command = arguments.first else {
            throw HelperError.usage("expected subcommand: capabilities | transcribe")
        }

        switch command {
        case "capabilities":
            return try await capabilities()
        case "transcribe":
            return try await transcribe(arguments: Array(arguments.dropFirst()))
        default:
            throw HelperError.usage("unknown subcommand '\(command)'")
        }
    }

    static func capabilities() async throws -> CapabilityResponse {
        let osVersion = ProcessInfo.processInfo.operatingSystemVersionString
        guard #available(macOS 26.0, *) else {
            let unsupported = ModuleCapability(
                moduleId: "speech-transcriber",
                isAvailable: nil,
                assetStatus: "unsupported",
                supportedLocales: [],
                installedLocales: []
            )
            let dictationUnsupported = ModuleCapability(
                moduleId: "dictation-transcriber",
                isAvailable: nil,
                assetStatus: "unsupported",
                supportedLocales: [],
                installedLocales: []
            )
            return CapabilityResponse(
                kind: "capabilities",
                schemaVersion: schemaVersion,
                osVersion: osVersion,
                runtimeSupported: false,
                readOnly: true,
                speechTranscriber: unsupported,
                dictationTranscriber: dictationUnsupported,
                notes: ["SpeechAnalyzer APIs require macOS 26.0 or newer at runtime."]
            )
        }

        let locale = Locale.current
        let speechTranscriber = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [],
            attributeOptions: [.audioTimeRange]
        )
        let dictationTranscriber = DictationTranscriber(
            locale: locale,
            contentHints: [],
            transcriptionOptions: [],
            reportingOptions: [],
            attributeOptions: [.audioTimeRange]
        )

        let speechCapability = ModuleCapability(
            moduleId: "speech-transcriber",
            isAvailable: SpeechTranscriber.isAvailable,
            assetStatus: assetStatusString(await AssetInventory.status(forModules: [speechTranscriber])),
            supportedLocales: await SpeechTranscriber.supportedLocales.map(\.identifier).sorted(),
            installedLocales: await SpeechTranscriber.installedLocales.map(\.identifier).sorted()
        )
        let dictationCapability = ModuleCapability(
            moduleId: "dictation-transcriber",
            isAvailable: nil,
            assetStatus: assetStatusString(await AssetInventory.status(forModules: [dictationTranscriber])),
            supportedLocales: await DictationTranscriber.supportedLocales.map(\.identifier).sorted(),
            installedLocales: await DictationTranscriber.installedLocales.map(\.identifier).sorted()
        )

        var notes: [String] = []
        if !SpeechTranscriber.isAvailable {
            notes.append("SpeechTranscriber is not available on this device; DictationTranscriber may still be usable.")
        }

        return CapabilityResponse(
            kind: "capabilities",
            schemaVersion: schemaVersion,
            osVersion: osVersion,
            runtimeSupported: true,
            readOnly: true,
            speechTranscriber: speechCapability,
            dictationTranscriber: dictationCapability,
            notes: notes
        )
    }

    static func transcribe(arguments: [String]) async throws -> TranscriptionResponse {
        let parsed = try parseTranscribeArguments(arguments)
        guard FileManager.default.fileExists(atPath: parsed.audioPath.path) else {
            throw HelperError.invalidAudioPath("audio path does not exist: \(parsed.audioPath.path)")
        }

        let osVersion = ProcessInfo.processInfo.operatingSystemVersionString
        guard #available(macOS 26.0, *) else {
            throw HelperError.unsupportedRuntime("SpeechAnalyzer APIs require macOS 26.0 or newer at runtime.")
        }

        if parsed.mode == "speech" {
            return try await transcribeWithSpeechTranscriber(
                audioPath: parsed.audioPath,
                localeIdentifier: parsed.localeIdentifier,
                ensureAssets: parsed.ensureAssets,
                osVersion: osVersion
            )
        }

        if parsed.mode == "dictation" {
            return try await transcribeWithDictationTranscriber(
                audioPath: parsed.audioPath,
                localeIdentifier: parsed.localeIdentifier,
                ensureAssets: parsed.ensureAssets,
                osVersion: osVersion
            )
        }

        throw HelperError.usage("unknown mode '\(parsed.mode)'")
    }
}

private struct ParsedTranscribeArguments {
    let mode: String
    let audioPath: URL
    let localeIdentifier: String
    let ensureAssets: Bool
}

@available(macOS 26.0, *)
private func transcribeWithSpeechTranscriber(
    audioPath: URL,
    localeIdentifier: String,
    ensureAssets: Bool,
    osVersion: String
) async throws -> TranscriptionResponse {
    let locale = Locale(identifier: localeIdentifier)
    let transcriber = SpeechTranscriber(
        locale: locale,
        transcriptionOptions: [],
        reportingOptions: [.fastResults],
        attributeOptions: [.audioTimeRange]
    )

    let statusBefore = assetStatusString(await AssetInventory.status(forModules: [transcriber]))
    if ensureAssets {
        try await ensureAssetsInstalled(for: [transcriber])
    }
    let statusAfterEnsure = assetStatusString(await AssetInventory.status(forModules: [transcriber]))

    guard SpeechTranscriber.isAvailable else {
        return TranscriptionResponse(
            kind: "transcription",
            schemaVersion: schemaVersion,
            moduleId: "speech-transcriber",
            locale: localeIdentifier,
            ensureAssets: ensureAssets,
            osVersion: osVersion,
            runtimeSupported: true,
            assetStatusBefore: statusBefore,
            assetStatusAfter: statusAfterEnsure,
            totalElapsedMs: 0,
            firstResultElapsedMs: nil,
            transcript: "",
            wordCount: 0,
            segments: [],
            notes: ["SpeechTranscriber.isAvailable was false on this device."],
            error: "SpeechTranscriber unavailable on this device"
        )
    }

    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let inputs = try await analyzerInputs(from: audioPath, modules: [transcriber])
    let started = DispatchTime.now().uptimeNanoseconds
    let (resultsTask, state) = collectSpeechResults(from: transcriber.results, startedAt: started)

    if let lastSample = try await analyzer.analyzeSequence(makeAnalyzerInputStream(inputs)) {
        try await analyzer.finalizeAndFinish(through: lastSample)
    } else {
        await analyzer.cancelAndFinishNow()
    }

    let collected = try await resultsTask.value
    return await transcriptionResponse(
        moduleId: "speech-transcriber",
        localeIdentifier: localeIdentifier,
        ensureAssets: ensureAssets,
        osVersion: osVersion,
        assetStatusBefore: statusBefore,
        assetStatusAfter: assetStatusString(await AssetInventory.status(forModules: [transcriber])),
        state: state,
        segments: collected
    )
}

@available(macOS 26.0, *)
private func transcribeWithDictationTranscriber(
    audioPath: URL,
    localeIdentifier: String,
    ensureAssets: Bool,
    osVersion: String
) async throws -> TranscriptionResponse {
    let locale = Locale(identifier: localeIdentifier)
    let transcriber = DictationTranscriber(
        locale: locale,
        contentHints: [.shortForm],
        transcriptionOptions: [],
        reportingOptions: [.frequentFinalization],
        attributeOptions: [.audioTimeRange]
    )

    let statusBefore = assetStatusString(await AssetInventory.status(forModules: [transcriber]))
    if ensureAssets {
        try await ensureAssetsInstalled(for: [transcriber])
    }
    let statusAfterEnsure = assetStatusString(await AssetInventory.status(forModules: [transcriber]))
    if statusAfterEnsure == "unsupported" {
        return TranscriptionResponse(
            kind: "transcription",
            schemaVersion: schemaVersion,
            moduleId: "dictation-transcriber",
            locale: localeIdentifier,
            ensureAssets: ensureAssets,
            osVersion: osVersion,
            runtimeSupported: true,
            assetStatusBefore: statusBefore,
            assetStatusAfter: statusAfterEnsure,
            totalElapsedMs: 0,
            firstResultElapsedMs: nil,
            transcript: "",
            wordCount: 0,
            segments: [],
            notes: ["DictationTranscriber asset status was unsupported for this locale/device."],
            error: "DictationTranscriber unsupported for this locale/device"
        )
    }

    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let inputs = try await analyzerInputs(from: audioPath, modules: [transcriber])
    let started = DispatchTime.now().uptimeNanoseconds
    let (resultsTask, state) = collectDictationResults(from: transcriber.results, startedAt: started)

    if let lastSample = try await analyzer.analyzeSequence(makeAnalyzerInputStream(inputs)) {
        try await analyzer.finalizeAndFinish(through: lastSample)
    } else {
        await analyzer.cancelAndFinishNow()
    }

    let collected = try await resultsTask.value
    return await transcriptionResponse(
        moduleId: "dictation-transcriber",
        localeIdentifier: localeIdentifier,
        ensureAssets: ensureAssets,
        osVersion: osVersion,
        assetStatusBefore: statusBefore,
        assetStatusAfter: assetStatusString(await AssetInventory.status(forModules: [transcriber])),
        state: state,
        segments: collected
    )
}

private actor ResultCollectionState {
    private var firstResultElapsedMs: UInt64?
    private var finishedElapsedMs: UInt64 = 0

    func recordFirstResult(_ elapsedMs: UInt64) {
        if firstResultElapsedMs == nil {
            firstResultElapsedMs = elapsedMs
        }
    }

    func recordFinished(_ elapsedMs: UInt64) {
        finishedElapsedMs = elapsedMs
    }

    func snapshot() -> (UInt64?, UInt64) {
        (firstResultElapsedMs, finishedElapsedMs)
    }
}

@available(macOS 26.0, *)
private func collectSpeechResults<S: AsyncSequence>(
    from sequence: S,
    startedAt: UInt64
) -> (Task<[TranscriptSegment], Error>, ResultCollectionState) where S.Element == SpeechTranscriber.Result, S.AsyncIterator: Sendable {
    let state = ResultCollectionState()
    let task = Task<[TranscriptSegment], Error> {
        var segments: [TranscriptSegment] = []
        for try await result in sequence {
            let elapsedMs = (DispatchTime.now().uptimeNanoseconds - startedAt) / 1_000_000
            await state.recordFirstResult(elapsedMs)
            let text = result.text.characters
            let cleaned = String(text).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleaned.isEmpty else { continue }
            segments.append(
                TranscriptSegment(
                    startMs: timeRangeStartMs(result.range),
                    durationMs: timeRangeDurationMs(result.range),
                    text: cleaned
                )
            )
        }
        let finished = (DispatchTime.now().uptimeNanoseconds - startedAt) / 1_000_000
        await state.recordFinished(finished)
        return segments
    }
    return (task, state)
}

@available(macOS 26.0, *)
private func collectDictationResults<S: AsyncSequence>(
    from sequence: S,
    startedAt: UInt64
) -> (Task<[TranscriptSegment], Error>, ResultCollectionState) where S.Element == DictationTranscriber.Result, S.AsyncIterator: Sendable {
    let state = ResultCollectionState()
    let task = Task<[TranscriptSegment], Error> {
        var segments: [TranscriptSegment] = []
        for try await result in sequence {
            let elapsedMs = (DispatchTime.now().uptimeNanoseconds - startedAt) / 1_000_000
            await state.recordFirstResult(elapsedMs)
            let text = result.text.characters
            let cleaned = String(text).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleaned.isEmpty else { continue }
            segments.append(
                TranscriptSegment(
                    startMs: timeRangeStartMs(result.range),
                    durationMs: timeRangeDurationMs(result.range),
                    text: cleaned
                )
            )
        }
        let finished = (DispatchTime.now().uptimeNanoseconds - startedAt) / 1_000_000
        await state.recordFinished(finished)
        return segments
    }
    return (task, state)
}

private func transcriptionResponse(
    moduleId: String,
    localeIdentifier: String,
    ensureAssets: Bool,
    osVersion: String,
    assetStatusBefore: String,
    assetStatusAfter: String,
    state: ResultCollectionState,
    segments: [TranscriptSegment]
) async -> TranscriptionResponse {
    let snapshot = await state.snapshot()
    let transcript = segments.map(\.text).joined(separator: " ")
    let emptyResult = segments.isEmpty || transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    return TranscriptionResponse(
        kind: "transcription",
        schemaVersion: schemaVersion,
        moduleId: moduleId,
        locale: localeIdentifier,
        ensureAssets: ensureAssets,
        osVersion: osVersion,
        runtimeSupported: true,
        assetStatusBefore: assetStatusBefore,
        assetStatusAfter: assetStatusAfter,
        totalElapsedMs: snapshot.1,
        firstResultElapsedMs: snapshot.0,
        transcript: transcript,
        wordCount: transcript.split(whereSeparator: \.isWhitespace).count,
        segments: segments,
        notes: emptyResult ? ["Analyzer completed without emitting transcription results."] : [],
        error: emptyResult ? "No transcription results emitted" : nil
    )
}

@available(macOS 26.0, *)
private func analyzerInputs(
    from audioPath: URL,
    modules: [any SpeechModule]
) async throws -> [AnalyzerInput] {
    let audioFile = try AVAudioFile(forReading: audioPath)
    guard let targetFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
        compatibleWith: modules,
        considering: audioFile.processingFormat
    ) else {
        throw HelperError.speechFailure("No compatible audio format is available for the selected modules.")
    }

    let sourceBuffer = try readEntireFile(audioFile)
    let workingBuffer = if audioFormatsMatch(sourceBuffer.format, targetFormat) {
        sourceBuffer
    } else {
        try convertBuffer(sourceBuffer, to: targetFormat)
    }

    let timescale = max(Int32(targetFormat.sampleRate.rounded()), 1)
    return [
        AnalyzerInput(
            buffer: workingBuffer,
            bufferStartTime: CMTime(value: 0, timescale: timescale)
        )
    ]
}

private func makeAnalyzerInputStream(
    _ inputs: [AnalyzerInput]
) -> AsyncStream<AnalyzerInput> {
    AsyncStream { continuation in
        for input in inputs {
            continuation.yield(input)
        }
        continuation.finish()
    }
}

private func readEntireFile(_ audioFile: AVAudioFile) throws -> AVAudioPCMBuffer {
    guard let buffer = AVAudioPCMBuffer(
        pcmFormat: audioFile.processingFormat,
        frameCapacity: AVAudioFrameCount(audioFile.length)
    ) else {
        throw HelperError.speechFailure("Failed to allocate source audio buffer.")
    }
    try audioFile.read(into: buffer)
    return buffer
}

private func convertBuffer(
    _ sourceBuffer: AVAudioPCMBuffer,
    to targetFormat: AVAudioFormat
) throws -> AVAudioPCMBuffer {
    guard let converter = AVAudioConverter(from: sourceBuffer.format, to: targetFormat) else {
        throw HelperError.speechFailure("Failed to create AVAudioConverter for Apple speech helper.")
    }

    let ratio = targetFormat.sampleRate / sourceBuffer.format.sampleRate
    let targetFrameCapacity = AVAudioFrameCount((Double(sourceBuffer.frameLength) * ratio).rounded(.up)) + 1
    guard let targetBuffer = AVAudioPCMBuffer(
        pcmFormat: targetFormat,
        frameCapacity: max(targetFrameCapacity, 1)
    ) else {
        throw HelperError.speechFailure("Failed to allocate converted audio buffer.")
    }

    var didProvideInput = false
    var conversionError: NSError?
    let status = converter.convert(to: targetBuffer, error: &conversionError) { _, outStatus in
        if didProvideInput {
            outStatus.pointee = .endOfStream
            return nil
        }
        didProvideInput = true
        outStatus.pointee = .haveData
        return sourceBuffer
    }

    if let conversionError {
        throw conversionError
    }

    switch status {
    case .haveData, .endOfStream, .inputRanDry:
        return targetBuffer
    case .error:
        throw HelperError.speechFailure("AVAudioConverter failed while preparing Apple speech benchmark input.")
    @unknown default:
        throw HelperError.speechFailure("AVAudioConverter returned an unknown status.")
    }
}

private func audioFormatsMatch(_ lhs: AVAudioFormat, _ rhs: AVAudioFormat) -> Bool {
    lhs.sampleRate == rhs.sampleRate
        && lhs.channelCount == rhs.channelCount
        && lhs.commonFormat == rhs.commonFormat
        && lhs.isInterleaved == rhs.isInterleaved
}

@available(macOS 26.0, *)
private func ensureAssetsInstalled(for modules: [any SpeechModule]) async throws {
    if let request = try await AssetInventory.assetInstallationRequest(supporting: modules) {
        try await request.downloadAndInstall()
    }
}

private func assetStatusString(_ status: AssetInventory.Status) -> String {
    switch status {
    case .unsupported:
        return "unsupported"
    case .supported:
        return "supported"
    case .downloading:
        return "downloading"
    case .installed:
        return "installed"
    @unknown default:
        return "unknown"
    }
}

private func timeRangeStartMs(_ range: CMTimeRange) -> UInt64 {
    let seconds = CMTimeGetSeconds(range.start)
    guard seconds.isFinite, seconds >= 0 else { return 0 }
    return UInt64(seconds * 1000.0)
}

private func timeRangeDurationMs(_ range: CMTimeRange) -> UInt64 {
    let seconds = CMTimeGetSeconds(range.duration)
    guard seconds.isFinite, seconds >= 0 else { return 0 }
    return UInt64(seconds * 1000.0)
}

private func parseTranscribeArguments(_ arguments: [String]) throws -> ParsedTranscribeArguments {
    var mode: String?
    var audioPath: String?
    var localeIdentifier = Locale.current.identifier
    var ensureAssets = false

    var index = 0
    while index < arguments.count {
        let argument = arguments[index]
        switch argument {
        case "--mode":
            index += 1
            guard index < arguments.count else {
                throw HelperError.usage("missing value for --mode")
            }
            mode = arguments[index]
        case "--audio-path":
            index += 1
            guard index < arguments.count else {
                throw HelperError.usage("missing value for --audio-path")
            }
            audioPath = arguments[index]
        case "--locale":
            index += 1
            guard index < arguments.count else {
                throw HelperError.usage("missing value for --locale")
            }
            localeIdentifier = arguments[index]
        case "--ensure-assets":
            ensureAssets = true
        default:
            throw HelperError.usage("unknown argument '\(argument)'")
        }
        index += 1
    }

    guard let mode else {
        throw HelperError.usage("missing required --mode")
    }
    guard let audioPath else {
        throw HelperError.usage("missing required --audio-path")
    }

    return ParsedTranscribeArguments(
        mode: mode,
        audioPath: URL(fileURLWithPath: audioPath),
        localeIdentifier: localeIdentifier,
        ensureAssets: ensureAssets
    )
}

private func writeJSON(_ value: some Encodable) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(AnyEncodable(value))
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

private struct AnyEncodable: Encodable {
    private let encodeImpl: (Encoder) throws -> Void

    init(_ wrapped: some Encodable) {
        self.encodeImpl = wrapped.encode(to:)
    }

    func encode(to encoder: Encoder) throws {
        try encodeImpl(encoder)
    }
}
