import { useCallback, useEffect, useState } from "react";

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

  const handleIntent = useCallback((response: JuliaVoiceIntentResponse) => {
    setLastVoiceResponse(response);
    setActiveMatch(null);
    setSelectorMatches([]);

    if (isSilentVoiceIntent(response)) {
      logSilentVoiceIntent(response);
      setState("idle");
      return;
    }

    if (response.intent === "single_match" && response.matches[0]) {
      setActiveMatch(response.matches[0]);
      setState("showing-document");
      return;
    }

    if (response.intent === "multi_match") {
      setSelectorMatches(response.matches);
      setState("showing-selector");
      return;
    }

    setState("idle");
  }, []);

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
    handleOrbClick,
    cancelListening,
    closeForeground,
    dismissError: () => setErrorToast(null),
  };
}
