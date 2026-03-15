import { NativeModule, requireNativeModule } from "expo-modules-core";

interface SmolVLMEvents {
  onModelLoadProgress: { progress: number };
}

declare class SmolVLMModuleType extends NativeModule<SmolVLMEvents> {
  loadModel(): Promise<{ status: string }>;
  analyzeImage(
    imagePath: string,
    prompt: string
  ): Promise<{ text: string; tokensPerSecond: number }>;
  getModelStatus(): string;
}

export default requireNativeModule<SmolVLMModuleType>("ExpoSmolVLM");
