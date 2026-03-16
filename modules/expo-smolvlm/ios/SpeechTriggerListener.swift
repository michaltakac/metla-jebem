import AVFoundation
import Foundation
import Speech

enum SpeechTriggerError: LocalizedError {
    case recognizerUnavailable
    case alreadyListening
    case permissionsDenied

    var errorDescription: String? {
        switch self {
        case .recognizerUnavailable:
            return "Speech recognizer is unavailable."
        case .alreadyListening:
            return "Speech trigger listener is already active."
        case .permissionsDenied:
            return "Speech recognition or microphone permission denied."
        }
    }
}

@MainActor
final class SpeechTriggerListener {
    private let audioEngine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))

    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var completionContinuation: CheckedContinuation<String?, Error>?
    private var timeoutTask: Task<Void, Never>?
    private var listening = false
    private var hasInputTap = false

    func requestPermissions() async -> Bool {
        let speechAuthorized = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }

        guard speechAuthorized else { return false }

        let micAuthorized = await withCheckedContinuation { continuation in
            if #available(iOS 17.0, *) {
                AVAudioApplication.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            } else {
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        }

        return micAuthorized
    }

    func listenForTrigger(phrases: [String], timeoutMs: Int) async throws -> String? {
        guard !listening else { throw SpeechTriggerError.alreadyListening }
        guard let recognizer, recognizer.isAvailable else { throw SpeechTriggerError.recognizerUnavailable }
        guard await requestPermissions() else { throw SpeechTriggerError.permissionsDenied }

        let normalizedPhrases = phrases.map(normalize).filter { !$0.isEmpty }
        guard !normalizedPhrases.isEmpty else { return nil }

        listening = true
        try configureAudioSession()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        recognitionRequest = request

        do {
            let inputNode = audioEngine.inputNode
            if hasInputTap {
                inputNode.removeTap(onBus: 0)
                hasInputTap = false
            }
            let inputFormat = inputNode.outputFormat(forBus: 0)
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, _ in
                self?.recognitionRequest?.append(buffer)
            }
            hasInputTap = true

            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            cleanupAfterStartFailure()
            throw error
        }

        return try await withCheckedThrowingContinuation { continuation in
            completionContinuation = continuation

            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self else { return }
                if let error {
                    finish(result: nil, error: error)
                    return
                }
                guard let result else { return }
                let transcript = normalize(result.bestTranscription.formattedString)

                if let matchedIndex = normalizedPhrases.firstIndex(where: { self.phraseMatches(transcript: transcript, phrase: $0) }) {
                    let matchedPhrase = phrases[matchedIndex]
                    finish(result: matchedPhrase, error: nil)
                }
            }

            timeoutTask = Task { [weak self] in
                guard let self else { return }
                let timeout = max(timeoutMs, 1000)
                try? await Task.sleep(nanoseconds: UInt64(timeout) * 1_000_000)
                self.finish(result: nil, error: nil)
            }
        }
    }

    func stopListening() {
        finish(result: nil, error: nil)
    }

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .record,
            mode: .measurement,
            options: [.duckOthers, .allowBluetoothHFP]
        )
        try session.setActive(true, options: .notifyOthersOnDeactivation)
    }

    private func cleanupAfterStartFailure() {
        timeoutTask?.cancel()
        timeoutTask = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        if hasInputTap {
            audioEngine.inputNode.removeTap(onBus: 0)
            hasInputTap = false
        }
        completionContinuation = nil
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func normalize(_ text: String) -> String {
        let lowered = text.lowercased()
        let lettersAndSpaces = lowered.replacingOccurrences(
            of: "[^a-z0-9\\s]",
            with: " ",
            options: .regularExpression
        )
        return lettersAndSpaces.replacingOccurrences(
            of: "\\s+",
            with: " ",
            options: .regularExpression
        ).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func phraseMatches(transcript: String, phrase: String) -> Bool {
        if transcript == phrase {
            return true
        }
        return transcript.hasSuffix(" \(phrase)")
    }

    private func finish(result: String?, error: Error?) {
        guard listening else { return }
        listening = false

        timeoutTask?.cancel()
        timeoutTask = nil

        recognitionTask?.cancel()
        recognitionTask = nil

        recognitionRequest?.endAudio()
        recognitionRequest = nil

        if audioEngine.isRunning {
            audioEngine.stop()
        }
        if hasInputTap {
            audioEngine.inputNode.removeTap(onBus: 0)
            hasInputTap = false
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        let continuation = completionContinuation
        completionContinuation = nil

        if let error {
            continuation?.resume(throwing: error)
        } else {
            continuation?.resume(returning: result)
        }
    }
}
