import type { JuliaVoiceIntentResponse } from "./types";

export function isSilentVoiceIntent(response: JuliaVoiceIntentResponse): boolean {
  return response.intent === "non_doc";
}

export function logSilentVoiceIntent(response: JuliaVoiceIntentResponse): void {
  console.log("julia.intent.no_action", {
    event: "julia.intent.no_action",
    transcript: response.transcript,
    intent: response.intent,
    match_count: response.matches.length,
  });
}
