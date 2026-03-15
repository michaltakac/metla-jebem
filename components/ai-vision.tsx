import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Speech from "expo-speech";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { SmolVLMModule } from "../modules/expo-smolvlm/src";

import { Btn, Section } from "./ui";

type ModelStatus = "idle" | "downloading" | "loaded" | "error";

export function AIVision({
  isStreaming,
  capturePhoto,
  lastPhotoPath,
}: {
  isStreaming: boolean;
  capturePhoto: () => Promise<void>;
  lastPhotoPath: string | null;
}) {
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [analysisText, setAnalysisText] = useState("");
  const [tokensPerSecond, setTokensPerSecond] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analyzeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyzeStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnalyzedPath = useRef<string | null>(null);
  const lastLoggedProgressPct = useRef(-1);
  const lastSpokenTextRef = useRef<string>("");

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
    if (!summary || summary === lastSpokenTextRef.current) return;
    lastSpokenTextRef.current = summary;
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

  // Periodic capture when AI is enabled and streaming
  useEffect(() => {
    if (aiEnabled && isStreaming && modelStatus === "loaded") {
      // Give stream a short moment to stabilize before the first capture.
      analyzeStartTimeoutRef.current = setTimeout(() => {
        capturePhoto().catch(() => {});
        analyzeIntervalRef.current = setInterval(() => {
          capturePhoto().catch(() => {});
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
  }, [aiEnabled, isStreaming, modelStatus, capturePhoto]);

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

    lastAnalyzedPath.current = lastPhotoPath;
    setIsAnalyzing(true);

    SmolVLMModule.analyzeImage(lastPhotoPath, "What do you see in this image?")
      .then((result) => {
        const summary = normalizeSummary(result.text);
        setAnalysisText(summary);
        setTokensPerSecond(result.tokensPerSecond);
        void speakSummary(summary);
        setIsAnalyzing(false);
      })
      .catch((err) => {
        setAnalysisText(`Error: ${err instanceof Error ? err.message : String(err)}`);
        setIsAnalyzing(false);
      });
  }, [lastPhotoPath, aiEnabled, isAnalyzing, modelStatus, normalizeSummary, speakSummary]);

  // Reset when AI is disabled
  useEffect(() => {
    if (!aiEnabled) {
      setAnalysisText("");
      setTokensPerSecond(0);
      lastAnalyzedPath.current = null;
      lastSpokenTextRef.current = "";
    }
  }, [aiEnabled]);

  const toggleAi = () => setAiEnabled((prev) => !prev);
  const toggleTts = () => {
    setTtsEnabled((prev) => {
      const next = !prev;
      if (!next) {
        void Speech.stop();
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
        variant={ttsEnabled ? "primary" : "secondary"}
        onPress={toggleTts}
        disabled={!aiEnabled || modelStatus !== "loaded"}
        icon={<Feather name={ttsEnabled ? "volume-2" : "volume-x"} size={14} color="#ffffff" />}
      />

      {!isStreaming && aiEnabled && (
        <Text style={styles.hint}>Start streaming to begin AI analysis.</Text>
      )}
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
