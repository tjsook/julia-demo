import { useCallback, useEffect, useState } from "react";

import { fetchJuliaSignedUrl } from "../../lib/julia/api";
import { isSilentVoiceIntent, logSilentVoiceIntent } from "../../lib/julia/intent";
import type { JuliaVoiceIntentResponse, JuliaVoiceMatch } from "../../lib/julia/types";
import { useJuliaVoice } from "./useJuliaVoice";

export type JuliaDemoState =
  | "idle"
  | "listening"
  | "processing"
  | "showing-document"
  | "showing-selector";

export function useJuliaDemo() {
  const [state, setState] = useState<JuliaDemoState>("idle");
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [activeMatch, setActiveMatch] = useState<JuliaVoiceMatch | null>(null);
  const [selectorMatches, setSelectorMatches] = useState<JuliaVoiceMatch[]>([]);
  const [lastVoiceResponse, setLastVoiceResponse] = useState<JuliaVoiceIntentResponse | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);

  const openDocument = useCallback(async (match: JuliaVoiceMatch) => {
    setActiveMatch(match);
    setSelectorMatches([]);
    setDocumentUrl(null);
    setDocumentError(null);
    setDocumentLoading(true);
    setState("showing-document");

    try {
      const response = await fetchJuliaSignedUrl(match.id);
      setDocumentUrl(response.signed_url);
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : "Failed to load document.");
    } finally {
      setDocumentLoading(false);
    }
  }, []);

  const handleIntent = useCallback((response: JuliaVoiceIntentResponse) => {
    setLastVoiceResponse(response);
    setActiveMatch(null);
    setSelectorMatches([]);
    setDocumentUrl(null);
    setDocumentError(null);

    if (isSilentVoiceIntent(response)) {
      logSilentVoiceIntent(response);
      setState("idle");
      return;
    }

    if (response.intent === "single_match" && response.matches[0]) {
      void openDocument(response.matches[0]);
      return;
    }

    if (response.intent === "multi_match") {
      setSelectorMatches(response.matches);
      setState("showing-selector");
      return;
    }

    setState("idle");
  }, [openDocument]);

  const handleError = useCallback((message: string) => {
    setErrorToast(message || "Something went wrong.");
    setState("idle");
  }, []);

  const voice = useJuliaVoice({
    onIntent: handleIntent,
    onError: handleError,
  });

  const handleOrbClick = useCallback(() => {
    if (state === "idle") {
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
    setState("idle");
    setActiveMatch(null);
    setSelectorMatches([]);
    setLastVoiceResponse(null);
    setDocumentUrl(null);
    setDocumentError(null);
    setDocumentLoading(false);
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

  return {
    state,
    errorToast,
    activeMatch,
    selectorMatches,
    lastVoiceResponse,
    documentUrl,
    documentLoading,
    documentError,
    handleOrbClick,
    openDocument,
    cancelListening,
    closeForeground,
    dismissError: () => setErrorToast(null),
  };
}
