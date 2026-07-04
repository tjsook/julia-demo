import type { JuliaVoiceIntentResponse } from "./types";

export function isSilentVoiceIntent(response: JuliaVoiceIntentResponse): boolean {
  return response.intent === "non_doc";
}

export function isRoiPendingInputIntent(response: JuliaVoiceIntentResponse): boolean {
  return response.intent === "roi_pending_input";
}

export function logSilentVoiceIntent(response: JuliaVoiceIntentResponse): void {
  console.log("julia.intent.no_action", {
    event: "julia.intent.no_action",
    transcript: response.transcript,
    intent: response.intent,
  });
}
