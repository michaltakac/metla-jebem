import ExpoModulesCore
import AVFoundation

public class SmolVLMModule: Module {
    private let evaluator = SmolVLMEvaluator()
    private var speechTriggerListener: SpeechTriggerListener?
    private let pendingSiriCommandKey = "EMWDATPendingSiriCommand"

    public func definition() -> ModuleDefinition {
        Name("ExpoSmolVLM")

        Events("onModelLoadProgress")

        AsyncFunction("loadModel") { () -> [String: Any] in
            try await self.evaluator.load { [weak self] progress in
                self?.sendEvent("onModelLoadProgress", [
                    "progress": progress
                ])
            }
            return ["status": "loaded"]
        }

        AsyncFunction("analyzeImage") { (imagePath: String, prompt: String) -> [String: Any] in
            let result = try await self.evaluator.analyze(imagePath: imagePath, prompt: prompt)
            return [
                "text": result.text,
                "tokensPerSecond": result.tokensPerSecond
            ]
        }

        AsyncFunction("requestSpeechPermissions") { () async -> [String: Any] in
            let listener = await self.getSpeechTriggerListener()
            let granted = await listener.requestPermissions()
            return ["granted": granted]
        }

        AsyncFunction("prepareBackgroundAudio") { () async throws -> [String: Any] in
            try self.setPlaybackAudioSession(active: true)
            return ["ok": true]
        }

        AsyncFunction("releaseBackgroundAudio") { () async -> [String: Any] in
            try? self.setPlaybackAudioSession(active: false)
            return ["ok": true]
        }

        Function("consumePendingSiriCommand") { () -> [String: Any] in
            let defaults = UserDefaults.standard
            let command = defaults.string(forKey: self.pendingSiriCommandKey)
            defaults.removeObject(forKey: self.pendingSiriCommandKey)
            defaults.removeObject(forKey: "\(self.pendingSiriCommandKey).ts")
            return ["command": command ?? NSNull()]
        }

        AsyncFunction("listenForTrigger") { (phrases: [String], timeoutMs: Int?) async throws -> [String: Any] in
            let listener = await self.getSpeechTriggerListener()
            let matchedPhrase = try await listener.listenForTrigger(
                phrases: phrases,
                timeoutMs: timeoutMs ?? 10000
            )
            return [
                "matched": matchedPhrase != nil,
                "phrase": matchedPhrase ?? NSNull()
            ]
        }

        Function("stopListeningForTrigger") { () in
            Task { @MainActor in
                self.speechTriggerListener?.stopListening()
            }
        }

        Function("getModelStatus") { () -> String in
            return self.evaluator.statusString
        }
    }

    private func setPlaybackAudioSession(active: Bool) throws {
        let session = AVAudioSession.sharedInstance()
        if active {
            try session.setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.duckOthers, .allowBluetoothA2DP, .allowBluetoothHFP, .allowAirPlay]
            )
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } else {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    @MainActor
    private func getSpeechTriggerListener() -> SpeechTriggerListener {
        if let existing = speechTriggerListener {
            return existing
        }
        let created = SpeechTriggerListener()
        speechTriggerListener = created
        return created
    }
}
