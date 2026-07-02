import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchJuliaSignedUrl,
  postJuliaRoiFollowup,
  postJuliaVoiceDocumentConfirmation,
  postJuliaVoiceGreeting,
  postJuliaVoiceIntent,
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

export type JuliaTerminalRecognizedLine = {
  key: string;
  prefix: string;
  message: string;
};

export type JuliaDebugStageTranscript = {
  id: number;
  stage: GuidedConversationStage | "error";
  expectedField: JuliaROIPendingField | null;
  transcript: string;
  intent: string | null;
};

export type JuliaStartupTimingMark = {
  event: string;
  elapsedMs: number;
};

type JuliaTtsPlayback = {
  audioBase64: string;
  mimeType: string;
  playIn: JuliaDemoState[];
  autoStartListeningOnEnd?: boolean;
  source?: "greeting" | "general";
  subtitleText?: string | null;
};

type OpenDocumentOptions = {
  playConfirmation?: boolean;
  preservePlayback?: boolean;
};

const GREETING_PLAYBACK_CACHE = new Map<string, JuliaVoicePlaybackResponse>();
const PROCESSING_SPLASH_LINES = [
  "syncing transcript",
  "matching pain signals",
  "resolving required fields",
  "building ROI model",
] as const;
const ENABLE_PROCESSING_FILLER_AUDIO = false;

export function useJuliaDemo() {
  const { name, email } = useCurrentUser();
  const isDebugMode = process.env.NEXT_PUBLIC_JULIA_DEBUG_MODE === "true";
  const [state, setState] = useState<JuliaDemoState>("asking-initial-intent");
  const [conversationStage, setConversationStage] =
    useState<GuidedConversationStage>("initial_intent");
  const [expectedField, setExpectedField] = useState<JuliaROIPendingField | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [activeMatch, setActiveMatch] = useState<JuliaVoiceMatch | null>(null);
  const [selectorMatches, setSelectorMatches] = useState<JuliaVoiceMatch[]>([]);
  const [lastVoiceResponse, setLastVoiceResponse] = useState<JuliaVoiceIntentResponse | null>(null);
  const [ttsPlayback, setTtsPlayback] = useState<JuliaTtsPlayback | null>(null);
  const [activeSubtitleText, setActiveSubtitleText] = useState<string | null>(null);
  const [isStartupLocked, setIsStartupLocked] = useState(true);
  const [processingSplashIndex, setProcessingSplashIndex] = useState(0);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [roiPayload, setRoiPayload] = useState<JuliaROIAnalysisPayload | null>(null);
  const [roiPendingDetail, setRoiPendingDetail] = useState<string | null>(null);
  const [roiCollectionSession, setRoiCollectionSession] =
    useState<JuliaROICollectionSession | null>(null);
  const [terminalRecognizedLines, setTerminalRecognizedLines] = useState<JuliaTerminalRecognizedLine[]>([]);
  const [terminalCancelMessage, setTerminalCancelMessage] = useState<string | null>(null);
  const [currentQuestionText, setCurrentQuestionText] = useState<string | null>(null);
  const [startupTimingMarks, setStartupTimingMarks] = useState<JuliaStartupTimingMark[]>([]);
  const [debugStageTranscripts, setDebugStageTranscripts] = useState<JuliaDebugStageTranscript[]>([]);
  const debugEntryIdRef = useRef(0);
  const startupEpochMsRef = useRef<number | null>(null);
  const confirmationRequestRef = useRef(0);
  const hasPlayedGreetingRef = useRef(false);
  const micAmplitudeRef = useRef(0);
  const activeTtsAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeFillerAudioRef = useRef<HTMLAudioElement | null>(null);
  const fillerTimeoutRef = useRef<number | null>(null);
  const usedFillerSetRef = useRef<Set<string>>(new Set());
  const hasPlayedFillerInProcessingRef = useRef(false);
  const cancelMessageTimeoutRef = useRef<number | null>(null);

  const spokenName = useMemo(() => {
    const displayName = getDashboardDisplayName(name, email);
    const [firstToken] = displayName.trim().split(/\s+/);
    if (!firstToken) return "there";
    return firstToken;
  }, [email, name]);

  const recordStartupTiming = useCallback((event: string) => {
    if (typeof window === "undefined") return;
    const now = window.performance.now();
    if (startupEpochMsRef.current === null) {
      startupEpochMsRef.current = now;
    }
    const elapsedMs = Math.round(now - startupEpochMsRef.current);
    setStartupTimingMarks((current) => [...current, { event, elapsedMs }].slice(-20));
    if (isDebugMode) {
      console.log("julia.startup_timing", {
        event: "julia.startup_timing",
        startup_event: event,
        elapsed_ms: elapsedMs,
      });
    }
  }, [isDebugMode]);

  const queueSelectedDocumentConfirmation = useCallback(async (match: JuliaVoiceMatch) => {
    const requestId = confirmationRequestRef.current + 1;
    confirmationRequestRef.current = requestId;

    try {
      const response = await postJuliaVoiceDocumentConfirmation(match.id);
      if (confirmationRequestRef.current !== requestId) return;
      setTtsPlayback(
        playbackFromResponse(response, ["showing-document"], {
          subtitleText: `Here's the ${match.title} document.`,
        }),
      );
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
    setTerminalRecognizedLines([]);
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
      const wasCancelTranscript = isCancelTranscript(response.transcript);
      logSilentVoiceIntent(response);
      resetRoiCollection();
      setRoiPayload(null);
      setRoiPendingDetail(null);
      setCurrentQuestionText("What can I do for you today?");
      setTtsPlayback(
        playbackFromResponse(response, ["asking-initial-intent"], {
          subtitleText: wasCancelTranscript
            ? "Okay, cancelled. What can I do for you today?"
            : "What can I do for you today?",
        }),
      );
      if (wasCancelTranscript) {
        setTerminalCancelMessage("voice cancel received");
      }
      setState("asking-initial-intent");
      return;
    }

    if (response.intent === "roi_analysis") {
      if (!response.roi_payload) {
        throw new Error("ROI analysis response is missing roi_payload.");
      }
      setRoiPayload(response.roi_payload);
      setTerminalRecognizedLines(buildRecognizedTerminalLines({
        session: null,
        payload: response.roi_payload,
      }));
      setTtsPlayback(playbackFromResponse(response, ["showing-roi-report"], { subtitleText: null }));
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
        {
          autoStartListeningOnEnd: true,
          subtitleText: pending.question_text ?? pending.detail,
        },
      );

      setRoiPayload(null);
      setRoiPendingDetail(
        pendingPlayback ? null : formatPendingDetail(pending.detail, pending.question_text ?? null),
      );
      setCurrentQuestionText(pending.question_text ?? pending.detail);
      setExpectedField(pending.next_field);
      setRoiCollectionSession(pending.session);
      setTerminalRecognizedLines(buildRecognizedTerminalLines({
        session: pending.session,
        payload: null,
      }));

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
      const routePlayback = playbackFromResponse(response, ["showing-document"], {
        subtitleText: `Here's the ${response.matches[0].title} document.`,
      });
      setTtsPlayback(routePlayback);
      void openDocument(response.matches[0], {
        playConfirmation: routePlayback === null,
        preservePlayback: routePlayback !== null,
      });
      return;
    }

    if (response.intent === "multi_match") {
      resetRoiCollection();
      setCurrentQuestionText(null);
      setTtsPlayback(
        playbackFromResponse(response, ["showing-selector"], {
          subtitleText: "I found multiple documents of that type. Which one do you want me to pull up?",
        }),
      );
      setSelectorMatches(response.matches);
      setState("showing-selector");
      return;
    }

    if (response.intent === "no_match") {
      resetRoiCollection();
      setCurrentQuestionText(null);
      setTtsPlayback(
        playbackFromResponse(response, ["idle"], {
          subtitleText: "I could not find that. Narrow down your query.",
        }),
      );
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

  const {
    startListening,
    stopAndSubmit,
    cancelListening: cancelVoiceListening,
    debugSnapshot,
  } = useJuliaVoice({
    onIntent: handleIntent,
    onError: handleError,
    onAmplitude: useCallback((level: number) => {
      micAmplitudeRef.current = level;
    }, []),
  });
  const typedDebugSnapshot: JuliaVoiceDebugSnapshot = debugSnapshot;

  const submitVoice: JuliaVoiceSubmitter = useCallback(async (recording, options) => {
    if (conversationStage === "initial_intent") {
      return postJuliaVoiceIntent(recording, options);
    }
    if (!expectedField) {
      throw new Error("ROI follow-up submit is missing expectedField.");
    }
    if (!roiCollectionSession) {
      throw new Error("ROI follow-up submit is missing session state.");
    }
    return postJuliaRoiFollowup(recording, expectedField, roiCollectionSession, options);
  }, [conversationStage, expectedField, roiCollectionSession]);

  const handleOrbClick = useCallback(() => {
    if (isStartupLocked) return;
    if (
      state === "idle" ||
      state === "asking-initial-intent" ||
      state === "collecting-company-name" ||
      state === "collecting-pain-points" ||
      state === "collecting-roi-field" ||
      state === "roi-pending-input"
    ) {
      setState("listening");
      void startListening();
      return;
    }

    if (state === "listening") {
      setState("processing");
      void stopAndSubmit(submitVoice);
    }
  }, [isStartupLocked, startListening, state, stopAndSubmit, submitVoice]);

  const cancelListening = useCallback(() => {
    cancelVoiceListening();
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
  }, [cancelVoiceListening, conversationStage]);

  const stopAllPlayback = useCallback(() => {
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
    setTtsPlayback(null);
    setActiveSubtitleText(null);
  }, []);

  const cancelActiveWork = useCallback((message: string) => {
    cancelListening();
    confirmationRequestRef.current += 1;
    stopAllPlayback();
    resetRoiCollection();
    setRoiPayload(null);
    setRoiPendingDetail(null);
    setCurrentQuestionText("What can I do for you today?");
    setTerminalCancelMessage(message);
    setState("asking-initial-intent");
  }, [cancelListening, resetRoiCollection, stopAllPlayback]);

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
    setTerminalCancelMessage(null);
    setDebugStageTranscripts([]);
    debugEntryIdRef.current = 0;
    resetRoiCollection();
  }, [resetRoiCollection]);

  useEffect(() => {
    recordStartupTiming("page_mount");
    if (hasPlayedGreetingRef.current) {
      return;
    }
    hasPlayedGreetingRef.current = true;
    const greetingText = `Hey ${spokenName}, what can I do for you today?`;
    setCurrentQuestionText(greetingText);
    setIsStartupLocked(true);
    setState("asking-initial-intent");

    void (async () => {
      try {
        const cacheKey = spokenName.trim().toLowerCase();
        const cached = GREETING_PLAYBACK_CACHE.get(cacheKey);
        let response: JuliaVoicePlaybackResponse;
        if (cached) {
          response = cached;
          recordStartupTiming("greeting_cache_hit");
        } else {
          recordStartupTiming("greeting_request_start");
          response = await postJuliaVoiceGreeting(spokenName);
          recordStartupTiming("greeting_response_received");
          GREETING_PLAYBACK_CACHE.set(cacheKey, response);
        }
        const greetingPlayback = playbackFromResponse(response, ["asking-initial-intent"], {
          autoStartListeningOnEnd: true,
          source: "greeting",
          subtitleText: greetingText,
        });
        if (!greetingPlayback) {
          setIsStartupLocked(false);
          setErrorToast("Julia couldn't play the greeting audio. Click the orb to start.");
          return;
        }
        setTtsPlayback(greetingPlayback);
      } catch (err) {
        setIsStartupLocked(false);
        setErrorToast(err instanceof Error ? err.message : "Failed to load Julia greeting.");
      }
    })();
  }, [recordStartupTiming, spokenName]);

  useEffect(() => {
    if (state !== "processing") {
      setProcessingSplashIndex(0);
      return;
    }
    const intervalId = window.setInterval(() => {
      setProcessingSplashIndex((current) => (current + 1) % PROCESSING_SPLASH_LINES.length);
    }, 1100);
    return () => window.clearInterval(intervalId);
  }, [state]);

  useEffect(() => {
    if (!terminalCancelMessage) return;
    if (cancelMessageTimeoutRef.current !== null) {
      window.clearTimeout(cancelMessageTimeoutRef.current);
    }
    cancelMessageTimeoutRef.current = window.setTimeout(() => {
      cancelMessageTimeoutRef.current = null;
      setTerminalCancelMessage(null);
    }, 2200);
    return () => {
      if (cancelMessageTimeoutRef.current !== null) {
        window.clearTimeout(cancelMessageTimeoutRef.current);
        cancelMessageTimeoutRef.current = null;
      }
    };
  }, [terminalCancelMessage]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (
        state === "listening" ||
        state === "processing" ||
        state === "collecting-company-name" ||
        state === "collecting-pain-points" ||
        state === "collecting-roi-field" ||
        state === "roi-pending-input"
      ) {
        event.preventDefault();
        cancelActiveWork("request aborted");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelActiveWork, state]);

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
    setActiveSubtitleText(ttsPlayback.subtitleText ?? null);
    if (ttsPlayback.source === "greeting") {
      recordStartupTiming("greeting_audio_play_start");
    }
    activeTtsAudioRef.current = audio;
    audio.onended = () => {
      if (activeTtsAudioRef.current === audio) {
        activeTtsAudioRef.current = null;
      }
      if (ttsPlayback.source === "greeting") {
        recordStartupTiming("greeting_audio_play_end");
      }
      setActiveSubtitleText(null);
      if (!ttsPlayback.autoStartListeningOnEnd) {
        if (ttsPlayback.source === "greeting") {
          setIsStartupLocked(false);
        }
        return;
      }
      if (ttsPlayback.source === "greeting") {
        recordStartupTiming("mic_auto_start_request");
      }
      setState("listening");
      void (async () => {
        await startListening();
        if (ttsPlayback.source === "greeting") {
          recordStartupTiming("mic_ready_listening");
          setIsStartupLocked(false);
        }
      })();
    };
    audio.play().catch((err: unknown) => {
      if (activeTtsAudioRef.current === audio) {
        activeTtsAudioRef.current = null;
      }
      console.log("julia.tts.play_failed", {
        event: "julia.tts.play_failed",
        error: err instanceof Error ? err.message : "Audio playback failed.",
      });
      setActiveSubtitleText(null);
      if (ttsPlayback.source === "greeting") {
        setIsStartupLocked(false);
      }
      setErrorToast("Julia couldn't play that prompt. Click the orb to continue.");
    });

    return () => {
      if (activeTtsAudioRef.current === audio) {
        activeTtsAudioRef.current = null;
      }
      setActiveSubtitleText(null);
      audio.onended = null;
      audio.pause();
      URL.revokeObjectURL(audioUrl);
    };
  }, [recordStartupTiming, startListening, state, ttsPlayback]);

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
    if (!ENABLE_PROCESSING_FILLER_AUDIO) {
      return;
    }
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
      if (cancelMessageTimeoutRef.current !== null) {
        window.clearTimeout(cancelMessageTimeoutRef.current);
        cancelMessageTimeoutRef.current = null;
      }
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
      setActiveSubtitleText(null);
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
    terminalRecognizedLines,
    terminalCancelMessage,
    currentQuestionText,
    activeSubtitleText,
    showProcessingSplash: state === "processing" && activeSubtitleText === null,
    processingSplashLine: PROCESSING_SPLASH_LINES[processingSplashIndex],
    roiProgressStep,
    requiredNumericCount: requiredNumericFields.length,
    collectedNumericCount,
    debugTranscript: typedDebugSnapshot.transcript,
    debugStopReason: typedDebugSnapshot.stopReason,
    debugAudioSizeMb: typedDebugSnapshot.audioSizeMb,
    debugDurationSeconds: typedDebugSnapshot.durationSeconds,
    debugRecording: typedDebugSnapshot.recording,
    micAmplitudeRef,
    isStartupLocked,
    startupTimingMarks,
    debugStageTranscripts,
    handleOrbClick,
    openDocument,
    cancelListening,
    cancelActiveWork,
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
  options: {
    autoStartListeningOnEnd?: boolean;
    source?: "greeting" | "general";
    subtitleText?: string | null;
  } = {},
): JuliaTtsPlayback | null {
  if (!response.tts_audio_base64 || !response.tts_mime_type) return null;
  return {
    audioBase64: response.tts_audio_base64,
    mimeType: response.tts_mime_type,
    playIn,
    autoStartListeningOnEnd: options.autoStartListeningOnEnd,
    source: options.source ?? "general",
    subtitleText: options.subtitleText ?? null,
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

function buildRecognizedTerminalLines({
  session,
  payload,
}: {
  session: JuliaROICollectionSession | null;
  payload: JuliaROIAnalysisPayload | null;
}): JuliaTerminalRecognizedLine[] {
  const lines: JuliaTerminalRecognizedLine[] = [];
  const companyName = payload?.company_name ?? session?.company_name ?? null;
  if (companyName) {
    lines.push({
      key: "company",
      prefix: "[id  ]",
      message: `company=${companyName}`,
    });
  }

  const painPoints = payload?.matched_pain_points ?? session?.matched_pain_points ?? [];
  for (const painPoint of painPoints) {
    lines.push({
      key: `pain:${painPoint.id}`,
      prefix: "[pain]",
      message: `${painPoint.id} conf=${formatConfidence(painPoint.confidence)}`,
    });
  }

  const inputs = payload?.inputs ?? session?.resolved_inputs ?? {};
  for (const field of ROI_INPUT_FIELD_ORDER) {
    const input = inputs[field];
    if (!input) continue;
    lines.push({
      key: `input:${field}`,
      prefix: input.source === "user_approved_default" || input.source === "default" ? "[def ]" : "[num ]",
      message: `${field}=${formatInputValue(field, input.value)} source=${input.source}`,
    });
  }

  return lines;
}

const ROI_INPUT_FIELD_ORDER: Array<keyof JuliaROIAnalysisPayload["inputs"]> = [
  "T",
  "Ld",
  "S",
  "Du",
  "P",
  "R",
  "minutes_per_order",
];

function formatInputValue(field: keyof JuliaROIAnalysisPayload["inputs"], value: number): string {
  if (field === "T") return `${Math.round(value)} trucks`;
  if (field === "Ld") return `${formatCompactNumber(value)}/day`;
  if (field === "S" || field === "Du") return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
  if (field === "P") return `${Math.round(value)} staff`;
  if (field === "R") return `$${formatCompactNumber(value)}/load`;
  if (field === "minutes_per_order") return `${formatCompactNumber(value)} min/order`;
  return formatCompactNumber(value);
}

function formatCompactNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatConfidence(value: number): string {
  return value.toFixed(2);
}

function isCancelTranscript(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  if (!normalized) return false;
  if (
    normalized.includes("cancel that")
    || normalized.includes("never mind")
    || normalized.includes("nevermind")
    || normalized.includes("scratch that")
    || normalized === "stop"
  ) {
    return true;
  }
  if (!normalized.startsWith("wait")) return false;
  const remainder = normalized.replace(/^wait[\s,!.?-]*/, "");
  if (!remainder) return true;
  const words = remainder.split(/\s+/).filter(Boolean);
  return words.length <= 3 && !/\d/.test(remainder);
}
