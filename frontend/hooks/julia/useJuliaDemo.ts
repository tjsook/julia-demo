import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchJuliaSignedUrl,
  postJuliaVoiceDocumentConfirmation,
  postJuliaVoiceGreeting,
} from "../../lib/julia/api";
import { getDashboardDisplayName, useCurrentUser } from "../../lib/auth";
import {
  isRoiPendingInputIntent,
  isSilentVoiceIntent,
  logSilentVoiceIntent,
} from "../../lib/julia/intent";
import type {
  JuliaROIAnalysisPayload,
  JuliaROICollectionSession,
  JuliaVoiceIntentResponse,
  JuliaVoiceMatch,
  JuliaVoicePlaybackResponse,
} from "../../lib/julia/types";
import { useJuliaVoice, type JuliaVoiceDebugSnapshot } from "./useJuliaVoice";

const ROI_PAIN_POINTS_QUESTION_TEXT =
  "What pain points did you identify in their office or operation?";

export type JuliaDemoState =
  | "idle"
  | "asking-initial-intent"
  | "collecting-company-name"
  | "collecting-pain-points"
  | "playing-roi-question"
  | "listening"
  | "processing"
  | "showing-document"
  | "showing-selector"
  | "showing-roi-report"
  | "roi-pending-input";

type GuidedConversationStage = "initial_intent" | "company" | "pain_points" | "complete";

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
  const [conversationStage, setConversationStage] = useState<GuidedConversationStage>("initial_intent");
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
  const [roiCollectionSession, setRoiCollectionSession] = useState<JuliaROICollectionSession | null>(null);
  const [currentQuestionText, setCurrentQuestionText] = useState<string | null>(null);
  const confirmationRequestRef = useRef(0);
  const hasPlayedGreetingRef = useRef(false);

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
    setRoiCollectionSession(null);
    setRoiPendingDetail(null);
  }, []);

  const handleCompanyFollowup = useCallback((transcript: string) => {
    const companyName = transcript.trim();
    if (!companyName) {
      setRoiPendingDetail("I still need the company name before we can continue.");
      setCurrentQuestionText("Which company is this for?");
      setState("collecting-company-name");
      return;
    }

    setConversationStage("pain_points");
    setCurrentQuestionText(ROI_PAIN_POINTS_QUESTION_TEXT);
    setRoiPendingDetail("Company captured. Share their office or operational pain points next.");
    setRoiCollectionSession((current) => {
      if (!current) return current;
      const answerTranscripts = [...current.answer_transcripts, transcript];
      return {
        ...current,
        answer_transcripts: answerTranscripts,
        company_name: companyName,
        collected_fields: Array.from(new Set([...current.collected_fields, "company_name"])),
        missing_fields: ["pain_points"],
        stage: "pain_points",
      };
    });
    setState("collecting-pain-points");
  }, []);

  const handlePainPointFollowup = useCallback((transcript: string) => {
    const painPointTranscript = transcript.trim();
    if (!painPointTranscript) {
      setRoiPendingDetail("I could not capture the pain points. Please answer again.");
      setCurrentQuestionText(ROI_PAIN_POINTS_QUESTION_TEXT);
      setState("collecting-pain-points");
      return;
    }

    setConversationStage("complete");
    setRoiPendingDetail("Pain points captured. Branch 1 stops before numeric-field collection.");
    setCurrentQuestionText(null);
    setRoiCollectionSession((current) => {
      if (!current) return current;
      const answerTranscripts = [...current.answer_transcripts, transcript];
      return {
        ...current,
        answer_transcripts: answerTranscripts,
        collected_fields: Array.from(new Set([...current.collected_fields, "pain_points"])),
        missing_fields: [],
        stage: "complete",
      };
    });
    setState("roi-pending-input");
  }, []);

  const handleIntent = useCallback((response: JuliaVoiceIntentResponse) => {
    setLastVoiceResponse(response);

    if (conversationStage === "company") {
      handleCompanyFollowup(response.transcript);
      return;
    }

    if (conversationStage === "pain_points") {
      handlePainPointFollowup(response.transcript);
      return;
    }

    setActiveMatch(null);
    setSelectorMatches([]);
    setDocumentUrl(null);
    setDocumentError(null);
    setRoiPayload(null);

    if (isSilentVoiceIntent(response)) {
      logSilentVoiceIntent(response);
      setTtsPlayback(null);
      setState("asking-initial-intent");
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
      const pending = response.roi_pending;
      if (!pending?.detail) {
        throw new Error("ROI pending-input response is missing roi_pending.detail.");
      }
      setRoiPendingDetail(pending.detail);
      setCurrentQuestionText(pending.question_text ?? pending.detail);
      if (pending.session) {
        setRoiCollectionSession(pending.session);
      }

      if (pending.next_field === "company_name") {
        setConversationStage("company");
        setState("collecting-company-name");
        setTtsPlayback(
          playbackFromResponse(response, ["collecting-company-name"], {
            autoStartListeningOnEnd: true,
          }),
        );
        return;
      }

      if (pending.next_field === "pain_points") {
        setConversationStage("pain_points");
        setState("collecting-pain-points");
        setTtsPlayback(
          playbackFromResponse(response, ["collecting-pain-points"], {
            autoStartListeningOnEnd: true,
          }),
        );
        return;
      }

      setConversationStage("complete");
      setState("roi-pending-input");
      setTtsPlayback(playbackFromResponse(response, ["roi-pending-input"]));
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
  }, [conversationStage, handleCompanyFollowup, handlePainPointFollowup, openDocument, resetRoiCollection]);

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
    if (
      state === "idle" ||
      state === "asking-initial-intent" ||
      state === "collecting-company-name" ||
      state === "collecting-pain-points" ||
      state === "roi-pending-input"
    ) {
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
    if (conversationStage === "company") {
      setState("collecting-company-name");
      return;
    }
    if (conversationStage === "pain_points") {
      setState("collecting-pain-points");
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
        setTtsPlayback(
          playbackFromResponse(response, ["asking-initial-intent"], {
            autoStartListeningOnEnd: true,
          }),
        );
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
        if (state === "collecting-company-name" || state === "collecting-pain-points") {
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

    const audioUrl = audioUrlFromBase64(ttsPlayback.audioBase64, ttsPlayback.mimeType);
    const audio = new Audio(audioUrl);
    audio.onended = () => {
      if (!ttsPlayback.autoStartListeningOnEnd) {
        return;
      }
      setState("listening");
      void voice.startListening();
    };
    audio.play().catch((err: unknown) => {
      console.log("julia.tts.play_failed", {
        event: "julia.tts.play_failed",
        error: err instanceof Error ? err.message : "Audio playback failed.",
      });
    });

    return () => {
      audio.onended = null;
      audio.pause();
      URL.revokeObjectURL(audioUrl);
    };
  }, [state, ttsPlayback, voice]);

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
