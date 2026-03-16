import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Speech from "expo-speech";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { SmolVLMModule } from "../modules/expo-smolvlm/src";

import { Btn, OptionRow, Section } from "./ui";

type ModelStatus = "idle" | "downloading" | "loaded" | "error";
type AnalysisMode = "continuous" | "voice";

type VoiceCommand = {
  display: string;
  phrases: string[];
  prompt: string;
};

const VOICE_COMMANDS: VoiceCommand[] = [
  {
    display: "What I see",
    phrases: ["what i see", "what i see?"],
    prompt: "Describe only the most important thing in this frame in one short sentence.",
  },
  {
    display: "What changed",
    phrases: ["what changed", "what changed?"],
    prompt: "Describe only what looks newly changed in this frame in one short sentence.",
  },
];

const ALL_TRIGGER_PHRASES = VOICE_COMMANDS.flatMap((command) => command.phrases);
const DEFAULT_PROMPT = VOICE_COMMANDS[0].prompt;
const VOICE_TIMEOUT_MS = 12000;
const MIN_REPEAT_SPEECH_MS = 10000;

const MODE_OPTIONS = [
  { label: "Continuous", value: "continuous" },
  { label: "Voice Trigger", value: "voice" },
];

export function AIVision({
  isStreaming,
  capturePhoto,
  lastPhotoPath,
  voiceIntentTriggerCount,
}: {
  isStreaming: boolean;
  capturePhoto: () => Promise<void>;
  lastPhotoPath: string | null;
  voiceIntentTriggerCount: number;
}) {
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("continuous");
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [analysisText, setAnalysisText] = useState("");
  const [tokensPerSecond, setTokensPerSecond] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState("");
  const analyzeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyzeStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnalyzedPath = useRef<string | null>(null);
  const lastLoggedProgressPct = useRef(-1);
  const lastSpokenTextRef = useRef<string>("");
  const lastSpokenAtRef = useRef(0);
  const pendingPromptRef = useRef<string>(DEFAULT_PROMPT);
  const voiceCaptureArmedRef = useRef(false);

  // Listen for model download progress
  useEffect(() => {
    const sub = SmolVLMModule.addListener("onModelLoadProgress", (event) => {
      setDownloadProgress(event.progress);
      const pct = Math.floor(event.progress * 100);
      if (pct >= 0 && pct % 10 === 0 && pct !== lastLoggedProgressPct.current) {
        lastLoggedProgressPct.current = pct;
        console.log(`[SmolVLM] download progress: ${pct}%`);
      }
    });
    return () => sub.remove();
  }, []);

  // Load model on mount
  useEffect(() => {
    loadModel();
  }, []);

  const loadModel = useCallback(async () => {
    if (modelStatus === "loaded" || modelStatus === "downloading") return;
    console.log("[SmolVLM] loadModel() called");
    setModelStatus("downloading");
    setError(null);
    lastLoggedProgressPct.current = -1;
    try {
      await SmolVLMModule.loadModel();
      console.log("[SmolVLM] model loaded");
      setModelStatus("loaded");
    } catch (err) {
      console.log("[SmolVLM] loadModel failed", err);
      setModelStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [modelStatus]);

  const normalizeSummary = useCallback((text: string) => {
    const compact = text.replace(/\s+/g, " ").trim();
    if (!compact) return compact;
    const firstSentence =
      compact.match(/^(.+?[.!?])(\s|$)/)?.[1] ??
      compact.split(/[.!?]/)[0]?.trim() ??
      compact;
    const words = firstSentence.split(" ").filter(Boolean).slice(0, 18);
    const summary = words.join(" ").trim();
    if (!summary) return "";
    return /[.!?]$/.test(summary) ? summary : `${summary}.`;
  }, []);

  const speakSummary = useCallback(async (text: string) => {
    if (!ttsEnabled) return;
    const summary = normalizeSummary(text);
    if (!summary) return;
    const now = Date.now();
    if (
      summary === lastSpokenTextRef.current &&
      now - lastSpokenAtRef.current < MIN_REPEAT_SPEECH_MS
    ) {
      return;
    }
    lastSpokenTextRef.current = summary;
    lastSpokenAtRef.current = now;
    try {
      await Speech.stop();
      Speech.speak(summary, {
        language: "en-US",
        rate: 0.5,
      });
    } catch (err) {
      console.log("[SmolVLM] TTS failed", err);
    }
  }, [normalizeSummary, ttsEnabled]);

  const normalizeCommand = useCallback((text: string) => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }, []);

  const resolveCommand = useCallback(
    (phrase: string) => {
      const normalized = normalizeCommand(phrase);
      return (
        VOICE_COMMANDS.find((command) =>
          command.phrases.some((trigger) => normalized.includes(normalizeCommand(trigger)))
        ) ?? VOICE_COMMANDS[0]
      );
    },
    [normalizeCommand]
  );

  // Periodic capture when AI is enabled and streaming in continuous mode
  useEffect(() => {
    if (aiEnabled && isStreaming && modelStatus === "loaded" && analysisMode === "continuous") {
      // Give stream a short moment to stabilize before the first capture.
      analyzeStartTimeoutRef.current = setTimeout(() => {
        capturePhoto().catch((err) => {
          console.log("[SmolVLM] capturePhoto failed", err);
        });
        analyzeIntervalRef.current = setInterval(() => {
          capturePhoto().catch((err) => {
            console.log("[SmolVLM] capturePhoto failed", err);
          });
        }, 3000);
      }, 1500);
    } else {
      if (analyzeStartTimeoutRef.current) {
        clearTimeout(analyzeStartTimeoutRef.current);
        analyzeStartTimeoutRef.current = null;
      }
      if (analyzeIntervalRef.current) {
        clearInterval(analyzeIntervalRef.current);
        analyzeIntervalRef.current = null;
      }
    }
    return () => {
      if (analyzeStartTimeoutRef.current) {
        clearTimeout(analyzeStartTimeoutRef.current);
        analyzeStartTimeoutRef.current = null;
      }
      if (analyzeIntervalRef.current) {
        clearInterval(analyzeIntervalRef.current);
        analyzeIntervalRef.current = null;
      }
    };
  }, [aiEnabled, isStreaming, modelStatus, analysisMode, capturePhoto]);

  // Voice-trigger mode: wait for spoken command, capture one frame, then analyze.
  useEffect(() => {
    let cancelled = false;

    const runVoiceLoop = async () => {
      setVoiceStatus(`Listening for "${VOICE_COMMANDS[0].display}"...`);
      setError(null);

      const permission = await SmolVLMModule.requestSpeechPermissions();
      if (!permission.granted) {
        setVoiceStatus("Speech permission is required. Enable microphone + speech recognition in iOS Settings.");
        setError("Speech permissions are required for voice trigger mode.");
        return;
      }

      while (!cancelled) {
        try {
          const result = await SmolVLMModule.listenForTrigger(ALL_TRIGGER_PHRASES, VOICE_TIMEOUT_MS);
          if (cancelled) return;
          if (!result.matched || !result.phrase) {
            setVoiceStatus("Listening...");
            continue;
          }

          const command = resolveCommand(result.phrase);
          pendingPromptRef.current = command.prompt;
          voiceCaptureArmedRef.current = true;
          setVoiceStatus(`Heard "${command.display}". Capturing frame...`);
          await capturePhoto();
          if (!cancelled) {
            setVoiceStatus("Captured. Generating summary...");
          }

          // Wait until the triggered frame is analyzed before listening again.
          while (!cancelled && voiceCaptureArmedRef.current) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }

          // If TTS is enabled, avoid immediately taking over audio with recording.
          if (ttsEnabled) {
            while (!cancelled) {
              try {
                const speaking = await Speech.isSpeakingAsync();
                if (!speaking) break;
              } catch {
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          }
        } catch (err) {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          console.log("[SmolVLM] voice trigger failed", msg);
          if (msg.includes("already active")) {
            SmolVLMModule.stopListeningForTrigger();
          }
          setVoiceStatus(`Voice trigger error: ${msg}. Retrying...`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    };

    const active = aiEnabled && isStreaming && modelStatus === "loaded" && analysisMode === "voice";
    if (active) {
      void runVoiceLoop();
    } else {
      SmolVLMModule.stopListeningForTrigger();
      voiceCaptureArmedRef.current = false;
      setVoiceStatus("");
    }

    return () => {
      cancelled = true;
      SmolVLMModule.stopListeningForTrigger();
      voiceCaptureArmedRef.current = false;
    };
  }, [aiEnabled, isStreaming, modelStatus, analysisMode, capturePhoto, resolveCommand, ttsEnabled]);

  // Siri/AppIntent one-shot trigger (deep link from AppIntent).
  useEffect(() => {
    if (voiceIntentTriggerCount <= 0) return;

    if (!isStreaming) {
      setVoiceStatus("Siri trigger received, but stream is not active.");
      return;
    }
    if (modelStatus !== "loaded") {
      setVoiceStatus("Siri trigger received, but model is not ready.");
      return;
    }

    // Force one-shot behavior regardless of current mode selection.
    pendingPromptRef.current =
      "Describe only the most important thing visible right now in one short sentence.";
    voiceCaptureArmedRef.current = true;
    setVoiceStatus('Siri trigger received. Capturing frame for "What my glasses see"...');
    capturePhoto().catch((err) => {
      voiceCaptureArmedRef.current = false;
      console.log("[SmolVLM] Siri trigger capture failed", err);
      setVoiceStatus("Siri trigger capture failed.");
    });
  }, [voiceIntentTriggerCount, isStreaming, modelStatus, capturePhoto]);

  // Analyze when a new photo arrives
  useEffect(() => {
    if (
      !aiEnabled ||
      !lastPhotoPath ||
      lastPhotoPath === lastAnalyzedPath.current ||
      isAnalyzing ||
      modelStatus !== "loaded"
    ) {
      return;
    }

    // In voice mode, analyze only if the frame was explicitly requested by a trigger phrase.
    if (analysisMode === "voice" && !voiceCaptureArmedRef.current) {
      return;
    }

    lastAnalyzedPath.current = lastPhotoPath;
    setIsAnalyzing(true);
    const prompt = pendingPromptRef.current || DEFAULT_PROMPT;
    pendingPromptRef.current = DEFAULT_PROMPT;

    SmolVLMModule.analyzeImage(lastPhotoPath, prompt)
      .then(async (result) => {
        const summary = normalizeSummary(result.text);
        setAnalysisText(summary);
        setTokensPerSecond(result.tokensPerSecond);
        await speakSummary(summary);
        if (analysisMode === "voice") {
          setVoiceStatus("Summary ready. Listening...");
          voiceCaptureArmedRef.current = false;
        }
        setIsAnalyzing(false);
      })
      .catch((err) => {
        setAnalysisText(`Error: ${err instanceof Error ? err.message : String(err)}`);
        if (analysisMode === "voice") {
          setVoiceStatus("Analysis failed. Listening...");
          voiceCaptureArmedRef.current = false;
        }
        setIsAnalyzing(false);
      });
  }, [lastPhotoPath, aiEnabled, isAnalyzing, modelStatus, normalizeSummary, speakSummary, analysisMode]);

  // Reset when AI is disabled
  useEffect(() => {
    if (!aiEnabled) {
      setAnalysisText("");
      setTokensPerSecond(0);
      lastAnalyzedPath.current = null;
      lastSpokenTextRef.current = "";
      lastSpokenAtRef.current = 0;
      pendingPromptRef.current = DEFAULT_PROMPT;
      voiceCaptureArmedRef.current = false;
      setVoiceStatus("");
      SmolVLMModule.stopListeningForTrigger();
    }
  }, [aiEnabled]);

  const toggleAi = () => setAiEnabled((prev) => !prev);
  const toggleTts = () => {
    setTtsEnabled((prev) => {
      const next = !prev;
      if (next) {
        void SmolVLMModule.prepareBackgroundAudio();
      } else {
        void Speech.stop();
        void SmolVLMModule.releaseBackgroundAudio();
      }
      return next;
    });
  };

  return (
    <Section title="AI Vision (SmolVLM2)">
      {/* Model status */}
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Model:</Text>
        {modelStatus === "downloading" ? (
          <View style={styles.downloadRow}>
            <ActivityIndicator size="small" color="#3b82f6" />
            <Text style={styles.statusValue}>
              Downloading {Math.round(downloadProgress * 100)}%
            </Text>
          </View>
        ) : modelStatus === "loaded" ? (
          <Text style={[styles.statusValue, { color: "#22c55e" }]}>Ready</Text>
        ) : modelStatus === "error" ? (
          <View>
            <Text style={[styles.statusValue, { color: "#ef4444" }]}>
              Error{error ? `: ${error}` : ""}
            </Text>
            <Btn label="Retry" onPress={loadModel} />
          </View>
        ) : (
          <Text style={styles.statusValue}>Not loaded</Text>
        )}
      </View>

      {/* Toggle AI analysis */}
      <Btn
        label={aiEnabled ? "Stop AI Vision" : "Start AI Vision"}
        variant={aiEnabled ? "destructive" : "success"}
        onPress={toggleAi}
        disabled={modelStatus !== "loaded"}
        icon={
          <Feather name={aiEnabled ? "eye-off" : "eye"} size={14} color="#ffffff" />
        }
      />

      <Btn
        label={ttsEnabled ? "Disable Voice Output" : "Enable Voice Output"}
        variant={ttsEnabled ? "success" : "default"}
        onPress={toggleTts}
        disabled={!aiEnabled || modelStatus !== "loaded"}
        icon={<Feather name={ttsEnabled ? "volume-2" : "volume-x"} size={14} color="#ffffff" />}
      />

      <Text style={styles.modeLabel}>Capture mode:</Text>
      <OptionRow
        options={MODE_OPTIONS}
        selected={analysisMode}
        onSelect={(value) => setAnalysisMode(value as AnalysisMode)}
        disabled={!aiEnabled || modelStatus !== "loaded"}
      />

      {!isStreaming && aiEnabled && (
        <Text style={styles.hint}>Start streaming to begin AI analysis.</Text>
      )}
      {aiEnabled && analysisMode === "voice" && (
        <Text style={styles.hint}>
          Say "{VOICE_COMMANDS[0].display}" to capture one frame, summarize it, and read it aloud.
        </Text>
      )}
      {aiEnabled && analysisMode === "voice" && voiceStatus ? (
        <Text style={styles.voiceStatus}>{voiceStatus}</Text>
      ) : null}
      {aiEnabled && ttsEnabled && (
        <Text style={styles.hint}>Voice summaries play through your current iPhone audio output.</Text>
      )}

      {/* Analysis output */}
      {aiEnabled && (analysisText || isAnalyzing) && (
        <View style={styles.outputContainer}>
          <View style={styles.outputHeader}>
            <Text style={styles.outputTitle}>Scene Understanding</Text>
            {isAnalyzing && <ActivityIndicator size="small" color="#3b82f6" />}
          </View>
          {analysisText ? (
            <Text style={styles.outputText}>{analysisText}</Text>
          ) : (
            <Text style={styles.outputPlaceholder}>Analyzing frame...</Text>
          )}
          {tokensPerSecond > 0 && (
            <Text style={styles.tpsText}>
              {tokensPerSecond.toFixed(1)} tokens/s
            </Text>
          )}
        </View>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
  },
  statusValue: {
    fontSize: 13,
    color: "#64748b",
  },
  downloadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  hint: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 6,
  },
  modeLabel: {
    marginTop: 4,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
  },
  voiceStatus: {
    color: "#3b82f6",
    fontSize: 12,
    marginTop: 6,
    fontWeight: "500",
  },
  outputContainer: {
    marginTop: 12,
    backgroundColor: "#0f172a",
    borderRadius: 8,
    padding: 14,
  },
  outputHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  outputTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  outputText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#e2e8f0",
  },
  outputPlaceholder: {
    fontSize: 14,
    color: "#475569",
    fontStyle: "italic",
  },
  tpsText: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 8,
    fontFamily: "Courier",
  },
});
