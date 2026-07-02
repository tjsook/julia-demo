import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchJuliaSignedUrl,
  postJuliaRoiFollowup,
  postJuliaVoiceDocumentConfirmation,
  postJuliaVoiceGreeting,
} from "../../lib/julia/api";
import { getDashboardDisplayName, useCurrentUser } from "../../lib/auth";
import {
  isRoiPendingInputIntent,
  isSilentVoiceIntent,
  logSilentVoiceIntent,
} from "../../lib/julia/intent";
import { pickFillerSrc } from "../../lib/julia/fillers";
import type {
  JuliaROIAnalysisPayload,
  JuliaROICollectionSession,
  JuliaROIPendingField,
  JuliaVoiceIntentResponse,
  JuliaVoiceMatch,
  JuliaVoicePlaybackResponse,
} from "../../lib/julia/types";
import {
  useJuliaVoice,
  type JuliaVoiceDebugSnapshot,
  type JuliaVoiceSubmitter,
} from "./useJuliaVoice";

export type JuliaDemoState =
  | "idle"
  | "asking-initial-intent"
  | "collecting-company-name"
  | "collecting-pain-points"
  | "collecting-roi-field"
  | "playing-roi-question"
  | "listening"
  | "processing"
  | "showing-document"
  | "showing-selector"
  | "showing-roi-report"
  | "roi-pending-input";

type GuidedConversationStage =
  | "initial_intent"
  | "company"
  | "pain_points"
  | "numeric_fields"
  | "confirm_default"
  | "complete";

type RoiProgressStep = "company" | "pain_points" | "numeric_fields" | "complete" | null;

export type JuliaDebugStageTranscript = {
  id: number;
  stage: GuidedConversationStage | "error";
  expectedField: JuliaROIPendingField | null;
  transcript: string;
  intent: string | null;
};

type JuliaTtsPlayback = {
  audioBase64: string;
  mimeType: string;
  playIn: JuliaDemoState[];
  autoStartListeningOnEnd?: boolean;
};

type OpenDocumentOptions = {
  playConfirmation?: boolean;
  preservePlayback?: boolean;
};

export function useJuliaDemo() {
  const { name, email } = useCurrentUser();
  const [state, setState] = useState<JuliaDemoState>("asking-initial-intent");
  const [conversationStage, setConversationStage] =
    useState<GuidedConversationStage>("initial_intent");
  const [expectedField, setExpectedField] = useState<JuliaROIPendingField | null>(null);
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
  const [roiCollectionSession, setRoiCollectionSession] =
    useState<JuliaROICollectionSession | null>(null);
  const [currentQuestionText, setCurrentQuestionText] = useState<string | null>(null);
  const [debugStageTranscripts, setDebugStageTranscripts] = useState<JuliaDebugStageTranscript[]>([]);
  const debugEntryIdRef = useRef(0);
  const confirmationRequestRef = useRef(0);
  const hasPlayedGreetingRef = useRef(false);
  const micAmplitudeRef = useRef(0);
  const activeTtsAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeFillerAudioRef = useRef<HTMLAudioElement | null>(null);
  const fillerTimeoutRef = useRef<number | null>(null);
  const usedFillerSetRef = useRef<Set<string>>(new Set());
  const hasPlayedFillerInProcessingRef = useRef(false);

  const spokenName = useMemo(() => {
    const displayName = getDashboardDisplayName(name, email);
    const [firstToken] = displayName.trim().split(/\s+/);
    if (!firstToken) return "there";
    return firstToken;
  }, [email, name]);

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

  const resetRoiCollection = useCallback(() => {
    setConversationStage("initial_intent");
    setExpectedField(null);
    setRoiCollectionSession(null);
    setRoiPendingDetail(null);
  }, []);

  const appendDebugStageTranscript = useCallback(
    ({
      stage,
      expectedField: field,
      transcript,
      intent,
    }: {
      stage: GuidedConversationStage | "error";
      expectedField: JuliaROIPendingField | null;
      transcript: string;
      intent: string | null;
    }) => {
      debugEntryIdRef.current += 1;
      const entry: JuliaDebugStageTranscript = {
        id: debugEntryIdRef.current,
        stage,
        expectedField: field,
        transcript,
        intent,
      };
      setDebugStageTranscripts((current) => [entry, ...current].slice(0, 10));
    },
    [],
  );

  const requiredNumericFields = useMemo(() => {
    if (!roiCollectionSession) return [];
    return roiCollectionSession.required_fields.filter(isRoiNumericField);
  }, [roiCollectionSession]);

  const collectedNumericCount = useMemo(() => {
    if (!roiCollectionSession) return 0;
    const resolved = new Set(Object.keys(roiCollectionSession.resolved_inputs));
    return requiredNumericFields.filter((field) => resolved.has(field)).length;
  }, [requiredNumericFields, roiCollectionSession]);

  const roiProgressStep: RoiProgressStep = useMemo(() => {
    if (state === "showing-roi-report" || conversationStage === "complete" || roiPayload) {
      return "complete";
    }
    if (conversationStage === "company") return "company";
    if (conversationStage === "pain_points") return "pain_points";
    if (conversationStage === "numeric_fields" || conversationStage === "confirm_default") {
      return "numeric_fields";
    }
    return null;
  }, [conversationStage, roiPayload, state]);

  const handleIntent = useCallback((response: JuliaVoiceIntentResponse) => {
    appendDebugStageTranscript({
      stage: conversationStage,
      expectedField,
      transcript: response.transcript,
      intent: response.intent,
    });
    setLastVoiceResponse(response);
    setActiveMatch(null);
    setSelectorMatches([]);
    setDocumentUrl(null);
    setDocumentError(null);

    if (isSilentVoiceIntent(response)) {
      logSilentVoiceIntent(response);
      resetRoiCollection();
      setCurrentQuestionText("What can I do for you today?");
      setState("asking-initial-intent");
      return;
    }

    if (response.intent === "roi_analysis") {
      if (!response.roi_payload) {
        throw new Error("ROI analysis response is missing roi_payload.");
      }
      setRoiPayload(response.roi_payload);
      setTtsPlayback(playbackFromResponse(response, ["showing-roi-report"]));
      setConversationStage("complete");
      setExpectedField(null);
      setRoiCollectionSession(null);
      setCurrentQuestionText(null);
      setState("showing-roi-report");
      return;
    }

    if (isRoiPendingInputIntent(response)) {
      const pending = response.roi_pending;
      if (!pending?.detail || !pending.next_field || !pending.session) {
        throw new Error("ROI pending-input response is missing required follow-up fields.");
      }

      const pendingPlayback = playbackFromResponse(
        response,
        ["collecting-company-name", "collecting-pain-points", "collecting-roi-field"],
        { autoStartListeningOnEnd: true },
      );

      setRoiPayload(null);
      setRoiPendingDetail(
        pendingPlayback ? null : formatPendingDetail(pending.detail, pending.question_text ?? null),
      );
      setCurrentQuestionText(pending.question_text ?? pending.detail);
      setExpectedField(pending.next_field);
      setRoiCollectionSession(pending.session);

      if (pending.next_field === "company_name") {
        setConversationStage("company");
        setState("collecting-company-name");
      } else if (pending.next_field === "pain_points") {
        setConversationStage("pain_points");
        setState("collecting-pain-points");
      } else {
        setConversationStage(pending.session.stage === "confirm_default" ? "confirm_default" : "numeric_fields");
        setState("collecting-roi-field");
      }

      setTtsPlayback(pendingPlayback);
      return;
    }

    if (response.intent === "single_match" && response.matches[0]) {
      resetRoiCollection();
      setCurrentQuestionText(null);
      setTtsPlayback(playbackFromResponse(response, ["showing-document"]));
      void openDocument(response.matches[0], {
        playConfirmation: false,
        preservePlayback: true,
      });
      return;
    }

    if (response.intent === "multi_match") {
      resetRoiCollection();
      setCurrentQuestionText(null);
      setTtsPlayback(playbackFromResponse(response, ["showing-selector"]));
      setSelectorMatches(response.matches);
      setState("showing-selector");
      return;
    }

    if (response.intent === "no_match") {
      resetRoiCollection();
      setCurrentQuestionText(null);
      setTtsPlayback(playbackFromResponse(response, ["idle"]));
      setState("idle");
      return;
    }

    setTtsPlayback(null);
    setState("idle");
  }, [appendDebugStageTranscript, conversationStage, expectedField, openDocument, resetRoiCollection]);

  const handleError = useCallback((message: string) => {
    const friendlyMessage = formatVoiceError(message);
    appendDebugStageTranscript({
      stage: "error",
      expectedField,
      transcript: `[${friendlyMessage}]`,
      intent: null,
    });
    setErrorToast(friendlyMessage);
    setRoiPayload(null);
    setRoiPendingDetail(null);
    setState("idle");
  }, [appendDebugStageTranscript, expectedField]);

  const voice = useJuliaVoice({
    onIntent: handleIntent,
    onError: handleError,
    onAmplitude: useCallback((level: number) => {
      micAmplitudeRef.current = level;
    }, []),
  });
  const debugSnapshot: JuliaVoiceDebugSnapshot = voice.debugSnapshot;

  const submitFollowup: JuliaVoiceSubmitter = useCallback(async (recording) => {
    if (!expectedField) {
      throw new Error("ROI follow-up submit is missing expectedField.");
    }
    if (!roiCollectionSession) {
      throw new Error("ROI follow-up submit is missing session state.");
    }
    return postJuliaRoiFollowup(recording, expectedField, roiCollectionSession);
  }, [expectedField, roiCollectionSession]);

  const handleOrbClick = useCallback(() => {
    if (
      state === "idle" ||
      state === "asking-initial-intent" ||
      state === "collecting-company-name" ||
      state === "collecting-pain-points" ||
      state === "collecting-roi-field" ||
      state === "roi-pending-input"
    ) {
      setState("listening");
      void voice.startListening();
      return;
    }

    if (state === "listening") {
      setState("processing");
      const submitter = conversationStage === "initial_intent" ? undefined : submitFollowup;
      void voice.stopAndSubmit(submitter);
    }
  }, [conversationStage, state, submitFollowup, voice]);

  const cancelListening = useCallback(() => {
    voice.cancelListening();
    if (conversationStage === "company") {
      setState("collecting-company-name");
      return;
    }
    if (conversationStage === "pain_points") {
      setState("collecting-pain-points");
      return;
    }
    if (conversationStage === "numeric_fields" || conversationStage === "confirm_default") {
      setState("collecting-roi-field");
      return;
    }
    setState("idle");
  }, [conversationStage, voice]);

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
    setCurrentQuestionText(null);
    setDebugStageTranscripts([]);
    debugEntryIdRef.current = 0;
    resetRoiCollection();
  }, [resetRoiCollection]);

  useEffect(() => {
    if (hasPlayedGreetingRef.current) {
      return;
    }
    hasPlayedGreetingRef.current = true;
    const greetingText = `Hey ${spokenName}, what can I do for you today?`;
    setCurrentQuestionText(greetingText);
    setState("asking-initial-intent");

    void (async () => {
      try {
        const response = await postJuliaVoiceGreeting(spokenName);
        const greetingPlayback = playbackFromResponse(response, ["asking-initial-intent"], {
          autoStartListeningOnEnd: true,
        });
        if (!greetingPlayback) {
          setErrorToast("Julia couldn't play the greeting audio. Click the orb to start.");
          return;
        }
        setTtsPlayback(greetingPlayback);
      } catch (err) {
        setErrorToast(err instanceof Error ? err.message : "Failed to load Julia greeting.");
      }
    })();
  }, [spokenName]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && state === "listening") {
        event.preventDefault();
        cancelListening();
        return;
      }
      if (event.key === "Escape") {
        resetRoiCollection();
        setCurrentQuestionText(null);
        if (
          state === "collecting-company-name" ||
          state === "collecting-pain-points" ||
          state === "collecting-roi-field"
        ) {
          setState("idle");
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelListening, resetRoiCollection, state]);

  useEffect(() => {
    if (!ttsPlayback || !ttsPlayback.playIn.includes(state)) {
      return;
    }

    if (activeFillerAudioRef.current) {
      activeFillerAudioRef.current.onended = null;
      activeFillerAudioRef.current.onerror = null;
      activeFillerAudioRef.current.pause();
      activeFillerAudioRef.current = null;
    }

    const audioUrl = audioUrlFromBase64(ttsPlayback.audioBase64, ttsPlayback.mimeType);
    const audio = new Audio(audioUrl);
    activeTtsAudioRef.current = audio;
    audio.onended = () => {
      if (activeTtsAudioRef.current === audio) {
        activeTtsAudioRef.current = null;
      }
      if (!ttsPlayback.autoStartListeningOnEnd) {
        return;
      }
      setState("listening");
      void voice.startListening();
    };
    audio.play().catch((err: unknown) => {
      if (activeTtsAudioRef.current === audio) {
        activeTtsAudioRef.current = null;
      }
      console.log("julia.tts.play_failed", {
        event: "julia.tts.play_failed",
        error: err instanceof Error ? err.message : "Audio playback failed.",
      });
      setErrorToast("Julia couldn't play that prompt. Click the orb to continue.");
    });

    return () => {
      if (activeTtsAudioRef.current === audio) {
        activeTtsAudioRef.current = null;
      }
      audio.onended = null;
      audio.pause();
      URL.revokeObjectURL(audioUrl);
    };
  }, [state, ttsPlayback, voice]);

  useEffect(() => {
    if (state === "processing") {
      return;
    }
    hasPlayedFillerInProcessingRef.current = false;
    usedFillerSetRef.current.clear();
    if (fillerTimeoutRef.current !== null) {
      window.clearTimeout(fillerTimeoutRef.current);
      fillerTimeoutRef.current = null;
    }
    if (activeFillerAudioRef.current) {
      activeFillerAudioRef.current.onended = null;
      activeFillerAudioRef.current.onerror = null;
      activeFillerAudioRef.current.pause();
      activeFillerAudioRef.current = null;
    }
  }, [state]);

  useEffect(() => {
    if (state !== "processing") {
      return;
    }
    if (
      ttsPlayback ||
      hasPlayedFillerInProcessingRef.current ||
      activeTtsAudioRef.current ||
      activeFillerAudioRef.current
    ) {
      return;
    }

    fillerTimeoutRef.current = window.setTimeout(() => {
      fillerTimeoutRef.current = null;
      if (
        hasPlayedFillerInProcessingRef.current ||
        activeTtsAudioRef.current ||
        activeFillerAudioRef.current
      ) {
        return;
      }

      const fillerSrc = pickFillerSrc(usedFillerSetRef.current);
      usedFillerSetRef.current.add(fillerSrc);
      hasPlayedFillerInProcessingRef.current = true;
      const audio = new Audio(fillerSrc);
      activeFillerAudioRef.current = audio;

      audio.onended = () => {
        if (activeFillerAudioRef.current === audio) {
          activeFillerAudioRef.current = null;
        }
      };
      audio.onerror = () => {
        if (activeFillerAudioRef.current === audio) {
          activeFillerAudioRef.current = null;
        }
        console.log("julia.filler.play_failed", {
          event: "julia.filler.play_failed",
          error: "Filler playback hit an audio error event.",
          src: fillerSrc,
        });
      };
      audio.play().catch((err: unknown) => {
        if (activeFillerAudioRef.current === audio) {
          activeFillerAudioRef.current = null;
        }
        console.log("julia.filler.play_failed", {
          event: "julia.filler.play_failed",
          error: err instanceof Error ? err.message : "Filler playback failed.",
          src: fillerSrc,
        });
      });
    }, 2000);

    return () => {
      if (fillerTimeoutRef.current !== null) {
        window.clearTimeout(fillerTimeoutRef.current);
        fillerTimeoutRef.current = null;
      }
    };
  }, [state, ttsPlayback]);

  useEffect(() => {
    return () => {
      if (fillerTimeoutRef.current !== null) {
        window.clearTimeout(fillerTimeoutRef.current);
        fillerTimeoutRef.current = null;
      }
      if (activeFillerAudioRef.current) {
        activeFillerAudioRef.current.onended = null;
        activeFillerAudioRef.current.onerror = null;
        activeFillerAudioRef.current.pause();
        activeFillerAudioRef.current = null;
      }
      if (activeTtsAudioRef.current) {
        activeTtsAudioRef.current.onended = null;
        activeTtsAudioRef.current.pause();
        activeTtsAudioRef.current = null;
      }
    };
  }, []);

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
    roiCollectionSession,
    currentQuestionText,
    roiProgressStep,
    requiredNumericCount: requiredNumericFields.length,
    collectedNumericCount,
    debugTranscript: debugSnapshot.transcript,
    debugStopReason: debugSnapshot.stopReason,
    debugAudioSizeMb: debugSnapshot.audioSizeMb,
    debugDurationSeconds: debugSnapshot.durationSeconds,
    debugRecording: debugSnapshot.recording,
    micAmplitudeRef,
    debugStageTranscripts,
    handleOrbClick,
    openDocument,
    cancelListening,
    closeForeground,
    dismissError: () => setErrorToast(null),
    dismissRoiPending: () => setRoiPendingDetail(null),
  };
}

function isRoiNumericField(field: JuliaROIPendingField): boolean {
  return field === "T" || field === "Ld" || field === "S" || field === "Du" || field === "P" || field === "R" || field === "minutes_per_order";
}

function formatVoiceError(message: string | null | undefined): string {
  const normalized = (message ?? "").trim();
  if (!normalized) return "Julia ran into an error. Please try again.";

  const lower = normalized.toLowerCase();
  if (lower.includes("recording failed to start") || lower.includes("microphone")) {
    return "Microphone access failed. Check browser permissions and try again.";
  }
  if (lower.includes("transcription")) {
    return "Julia couldn't transcribe that answer. Please speak again.";
  }
  if (lower.includes("audio must be")) {
    return normalized;
  }
  if (lower.includes("follow-up") || lower.includes("voice processing")) {
    return "Julia couldn't process that answer. Please try the same question again.";
  }
  return normalized;
}

function formatPendingDetail(detail: string, questionText: string | null): string {
  const trimmed = detail.trim();
  if (trimmed.startsWith("I could not capture")) {
    if (questionText) return `I didn't catch that. ${questionText}`;
    return "I didn't catch that. Please answer again.";
  }
  if (trimmed.startsWith("Default approval required")) {
    return "Please confirm yes or no before Julia uses the default.";
  }
  return trimmed;
}

function playbackFromResponse(
  response: JuliaVoiceIntentResponse | JuliaVoicePlaybackResponse,
  playIn: JuliaDemoState[],
  options: { autoStartListeningOnEnd?: boolean } = {},
): JuliaTtsPlayback | null {
  if (!response.tts_audio_base64 || !response.tts_mime_type) return null;
  return {
    audioBase64: response.tts_audio_base64,
    mimeType: response.tts_mime_type,
    playIn,
    autoStartListeningOnEnd: options.autoStartListeningOnEnd,
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
