import Foundation
import Hub
import MLX
import MLXVLM
import MLXLMCommon

enum SmolVLMError: LocalizedError {
    case modelNotLoaded
    case invalidImage
    case analysisInProgress

    var errorDescription: String? {
        switch self {
        case .modelNotLoaded: return "Model not loaded"
        case .invalidImage: return "Could not load image"
        case .analysisInProgress: return "Analysis already in progress"
        }
    }
}

final class SmolVLMEvaluator: @unchecked Sendable {
    enum LoadState: Sendable {
        case idle
        case downloading(Double)
        case loaded
        case error(String)
    }

    private var modelContainer: ModelContainer?
    private(set) var loadState: LoadState = .idle
    private var _analyzing = false
    private let _stateQueue = DispatchQueue(label: "ExpoSmolVLM.state")
    private let hubApi: HubApi = {
        let downloadBase = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        // Force online downloads for first-run model fetch. The Hub auto mode treats
        // constrained/expensive networks as offline and can block downloads on device.
        return HubApi(downloadBase: downloadBase, useOfflineMode: false)
    }()

    func load(onProgress: @escaping @Sendable (Double) -> Void) async throws {
        loadState = .downloading(0)
        configureHubEnvironmentForDownloads()

        // Configure GPU memory limits for on-device inference
        MLX.GPU.set(cacheLimit: 20 * 1024 * 1024) // 20 MB cache
        let maxMemory = Int(round(0.82 * Double(os_proc_available_memory())))
        MLX.GPU.set(memoryLimit: maxMemory, relaxed: false)

        let modelConfig = ModelConfiguration(
            id: "HuggingFaceTB/SmolVLM2-500M-Video-Instruct-mlx",
            defaultPrompt: "Describe what you see."
        )

        do {
            NSLog("[ExpoSmolVLM] Starting model load for SmolVLM2")
            self.modelContainer = try await VLMModelFactory.shared.loadContainer(
                hub: hubApi,
                configuration: modelConfig
            ) { [weak self] progress in
                let fraction = progress.fractionCompleted
                self?.loadState = .downloading(fraction)
                onProgress(fraction)
            }
            NSLog("[ExpoSmolVLM] Model load completed")
            loadState = .loaded
        } catch {
            let message = describeLoadError(error)
            NSLog("[ExpoSmolVLM] Model load failed: %@", message)
            loadState = .error(message)
            throw NSError(
                domain: "ExpoSmolVLM",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: message]
            )
        }
    }

    func analyze(imagePath: String, prompt: String) async throws -> (text: String, tokensPerSecond: Double) {
        guard beginAnalysis() else {
            throw SmolVLMError.analysisInProgress
        }

        defer {
            endAnalysis()
        }

        guard let container = modelContainer else {
            throw SmolVLMError.modelNotLoaded
        }

        let url = URL(fileURLWithPath: imagePath)
        guard let ciImage = CIImage(contentsOf: url) else {
            throw SmolVLMError.invalidImage
        }

        return try await container.perform { context in
            let images: [UserInput.Image] = [.ciImage(ciImage)]
            let userInput = UserInput(
                messages: [
                    [
                        "role": "system",
                        "content": [
                            [
                                "type": "text",
                                "text":
                                    "You are a visual summarizer. Respond with exactly one short sentence (max 18 words). Focus only on the most important visible action or scene."
                            ]
                        ]
                    ],
                    [
                        "role": "user",
                        "content": [
                            ["type": "image"],
                            ["type": "text", "text": prompt]
                        ]
                    ]
                ],
                images: images,
                videos: []
            )

            let input = try await context.processor.prepare(input: userInput)

            var generatedTokens = [Int]()
            let info = try MLXLMCommon.generate(
                input: input,
                parameters: GenerateParameters(temperature: 0.2, topP: 0.8),
                context: context
            ) { token in
                generatedTokens.append(token)
                if generatedTokens.count >= 48 { return .stop }
                return .more
            }

            let outputText = context.tokenizer.decode(tokens: generatedTokens)
            let tps = info.tokensPerSecond
            return (text: outputText, tokensPerSecond: tps)
        }
    }

    var statusString: String {
        switch loadState {
        case .idle: return "idle"
        case .downloading(let p): return "downloading:\(Int(p * 100))"
        case .loaded: return "loaded"
        case .error(let msg): return "error:\(msg)"
        }
    }

    private func configureHubEnvironmentForDownloads() {
        // Ensure first run can fetch model weights instead of failing in forced offline mode.
        setenv("HF_HUB_OFFLINE", "0", 1)
        setenv("HUGGINGFACE_HUB_OFFLINE", "0", 1)
        unsetenv("TRANSFORMERS_OFFLINE")
        // swift-transformers HubApi treats constrained/expensive links as offline.
        // Disable that heuristic so iPhone can download on first run.
        setenv("CI_DISABLE_NETWORK_MONITOR", "1", 1)
    }

    private func describeLoadError(_ error: Error) -> String {
        let message = String(describing: error)
        let normalized = message.lowercased()
        if normalized.contains("offline mode")
            || normalized.contains("offlinemodeerror")
            || normalized.contains("repository not available locally")
        {
            return "Model is not cached yet and offline mode is enabled. Connect to the internet for first download."
        }
        return message
    }

    private func beginAnalysis() -> Bool {
        return _stateQueue.sync {
            guard !_analyzing else { return false }
            _analyzing = true
            return true
        }
    }

    private func endAnalysis() {
        _stateQueue.sync {
            _analyzing = false
        }
    }
}
