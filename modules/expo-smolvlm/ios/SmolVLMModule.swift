import ExpoModulesCore

public class SmolVLMModule: Module {
    private let evaluator = SmolVLMEvaluator()

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

        Function("getModelStatus") { () -> String in
            return self.evaluator.statusString
        }
    }
}
