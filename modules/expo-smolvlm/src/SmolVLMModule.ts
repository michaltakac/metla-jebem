import { NativeModule, requireNativeModule } from "expo-modules-core";

interface SmolVLMEvents {
  onModelLoadProgress: { progress: number };
}

declare class SmolVLMModuleType extends NativeModule<SmolVLMEvents> {
  loadModel(): Promise<{ status: string }>;
  requestSpeechPermissions(): Promise<{ granted: boolean }>;
  prepareBackgroundAudio(): Promise<{ ok: boolean }>;
  releaseBackgroundAudio(): Promise<{ ok: boolean }>;
  consumePendingSiriCommand(): { command: string | null };
  listenForTrigger(
    phrases: string[],
    timeoutMs?: number
  ): Promise<{ matched: boolean; phrase: string | null }>;
  stopListeningForTrigger(): void;
  analyzeImage(
    imagePath: string,
    prompt: string
  ): Promise<{ text: string; tokensPerSecond: number }>;
  getModelStatus(): string;
}

export default requireNativeModule<SmolVLMModuleType>("ExpoSmolVLM");
