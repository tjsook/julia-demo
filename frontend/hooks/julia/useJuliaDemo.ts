import { useCallback, useEffect, useRef, useState } from "react";

import { fetchJuliaSignedUrl, postJuliaVoiceDocumentConfirmation } from "../../lib/julia/api";
import {
  isRoiPendingInputIntent,
  isSilentVoiceIntent,
  logSilentVoiceIntent,
} from "../../lib/julia/intent";
import type {
  JuliaROIAnalysisPayload,
  JuliaVoiceIntentResponse,
  JuliaVoiceMatch,
  JuliaVoicePlaybackResponse,
} from "../../lib/julia/types";
import { useJuliaVoice, type JuliaVoiceDebugSnapshot } from "./useJuliaVoice";

export type JuliaDemoState =
  | "idle"
  | "listening"
  | "processing"
  | "showing-document"
  | "showing-selector"
  | "showing-roi-report"
  | "roi-pending-input";

type JuliaTtsPlayback = {
  audioBase64: string;
  mimeType: string;
  playIn: JuliaDemoState[];
};

type OpenDocumentOptions = {
  playConfirmation?: boolean;
  preservePlayback?: boolean;
};

export function useJuliaDemo() {
  const [state, setState] = useState<JuliaDemoState>("idle");
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [activeMatch, setActiveMatch] = useState<JuliaVoiceMatch | null>(null);
  const [selectorMatches, setSelectorMatches] = useState<JuliaVoiceMatch[]>([]);
  const [lastVoiceResponse, setLastVoiceResponse] = useState<JuliaVoiceIntentResponse | null>(null);
  const [ttsPlayback, setTtsPlayback] = useState<JuliaTtsPlayback | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [roiPayload, setRoiPayload] = useState<JuliaROIAnalysisPayload | null>(null);
  const [roiPendingDetail, setRoiPendingDetail] = useState<string | null>(null);
  const confirmationRequestRef = useRef(0);

  const queueSelectedDocumentConfirmation = useCallback(async (match: JuliaVoiceMatch) => {
    const requestId = confirmationRequestRef.current + 1;
    confirmationRequestRef.current = requestId;

    try {
      const response = await postJuliaVoiceDocumentConfirmation(match.id);
      if (confirmationRequestRef.current !== requestId) return;
      setTtsPlayback(playbackFromResponse(response, ["showing-document"]));
    } catch (err) {
      console.log("julia.tts.selection_failed", {
        event: "julia.tts.selection_failed",
        doc_id: match.id,
        error: err instanceof Error ? err.message : "Selected document voice response failed.",
      });
    }
  }, []);

  const openDocument = useCallback(async (match: JuliaVoiceMatch, options: OpenDocumentOptions = {}) => {
    const playConfirmation = options.playConfirmation ?? true;
    setActiveMatch(match);
    setSelectorMatches([]);
    if (!options.preservePlayback) setTtsPlayback(null);
    setDocumentUrl(null);
    setDocumentError(null);
    setRoiPayload(null);
    setRoiPendingDetail(null);
    setDocumentLoading(true);
    setState("showing-document");
    if (playConfirmation) void queueSelectedDocumentConfirmation(match);

    try {
      const response = await fetchJuliaSignedUrl(match.id);
      setDocumentUrl(response.signed_url);
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : "Failed to load document.");
    } finally {
      setDocumentLoading(false);
    }
  }, [queueSelectedDocumentConfirmation]);

  const handleIntent = useCallback((response: JuliaVoiceIntentResponse) => {
    setLastVoiceResponse(response);
    setActiveMatch(null);
    setSelectorMatches([]);
    setDocumentUrl(null);
    setDocumentError(null);
    setRoiPayload(null);
    setRoiPendingDetail(null);

    if (isSilentVoiceIntent(response)) {
      logSilentVoiceIntent(response);
      setTtsPlayback(null);
      setState("idle");
      return;
    }

    if (response.intent === "roi_analysis") {
      if (!response.roi_payload) {
        throw new Error("ROI analysis response is missing roi_payload.");
      }
      setTtsPlayback(playbackFromResponse(response, ["showing-roi-report"]));
      setRoiPayload(response.roi_payload);
      setState("showing-roi-report");
      return;
    }

    if (isRoiPendingInputIntent(response)) {
      if (!response.roi_pending?.detail) {
        throw new Error("ROI pending-input response is missing roi_pending.detail.");
      }
      setTtsPlayback(playbackFromResponse(response, ["roi-pending-input"]));
      setRoiPendingDetail(response.roi_pending.detail);
      setState("roi-pending-input");
      return;
    }

    if (response.intent === "single_match" && response.matches[0]) {
      setTtsPlayback(playbackFromResponse(response, ["showing-document"]));
      void openDocument(response.matches[0], {
        playConfirmation: false,
        preservePlayback: true,
      });
      return;
    }

    if (response.intent === "multi_match") {
      setTtsPlayback(playbackFromResponse(response, ["showing-selector"]));
      setSelectorMatches(response.matches);
      setState("showing-selector");
      return;
    }

    if (response.intent === "no_match") {
      setTtsPlayback(playbackFromResponse(response, ["idle"]));
      setState("idle");
      return;
    }

    setTtsPlayback(null);
    setState("idle");
  }, [openDocument]);

  const handleError = useCallback((message: string) => {
    setErrorToast(message || "Something went wrong.");
    setRoiPayload(null);
    setRoiPendingDetail(null);
    setState("idle");
  }, []);

  const voice = useJuliaVoice({
    onIntent: handleIntent,
    onError: handleError,
  });
  const debugSnapshot: JuliaVoiceDebugSnapshot = voice.debugSnapshot;

  const handleOrbClick = useCallback(() => {
    if (state === "idle" || state === "roi-pending-input") {
      setRoiPendingDetail(null);
      setState("listening");
      void voice.startListening();
      return;
    }
    if (state === "listening") {
      setState("processing");
      void voice.stopAndSubmit();
    }
  }, [state, voice]);

  const cancelListening = useCallback(() => {
    voice.cancelListening();
    setState("idle");
  }, [voice]);

  const closeForeground = useCallback(() => {
    confirmationRequestRef.current += 1;
    setState("idle");
    setActiveMatch(null);
    setSelectorMatches([]);
    setLastVoiceResponse(null);
    setTtsPlayback(null);
    setDocumentUrl(null);
    setDocumentError(null);
    setDocumentLoading(false);
    setRoiPayload(null);
    setRoiPendingDetail(null);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && state === "listening") {
        event.preventDefault();
        cancelListening();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelListening, state]);

  useEffect(() => {
    if (!ttsPlayback || !ttsPlayback.playIn.includes(state)) {
      return;
    }

    const audioUrl = audioUrlFromBase64(ttsPlayback.audioBase64, ttsPlayback.mimeType);
    const audio = new Audio(audioUrl);
    audio.play().catch((err: unknown) => {
      console.log("julia.tts.play_failed", {
        event: "julia.tts.play_failed",
        error: err instanceof Error ? err.message : "Audio playback failed.",
      });
    });

    return () => {
      audio.pause();
      URL.revokeObjectURL(audioUrl);
    };
  }, [state, ttsPlayback]);

  return {
    state,
    errorToast,
    activeMatch,
    selectorMatches,
    lastVoiceResponse,
    documentUrl,
    documentLoading,
    documentError,
    roiPayload,
    roiPendingDetail,
    debugTranscript: debugSnapshot.transcript,
    debugStopReason: debugSnapshot.stopReason,
    debugAudioSizeMb: debugSnapshot.audioSizeMb,
    debugDurationSeconds: debugSnapshot.durationSeconds,
    debugRecording: debugSnapshot.recording,
    handleOrbClick,
    openDocument,
    cancelListening,
    closeForeground,
    dismissError: () => setErrorToast(null),
    dismissRoiPending: () => setRoiPendingDetail(null),
  };
}

function playbackFromResponse(
  response: JuliaVoiceIntentResponse | JuliaVoicePlaybackResponse,
  playIn: JuliaDemoState[],
): JuliaTtsPlayback | null {
  if (!response.tts_audio_base64 || !response.tts_mime_type) return null;
  return {
    audioBase64: response.tts_audio_base64,
    mimeType: response.tts_mime_type,
    playIn,
  };
}

function audioUrlFromBase64(base64Audio: string, mimeType: string): string {
  const binary = window.atob(base64Audio);
  const bytes = new Uint8Array(binary.length);
  for (let idx = 0; idx < binary.length; idx += 1) {
    bytes[idx] = binary.charCodeAt(idx);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}
