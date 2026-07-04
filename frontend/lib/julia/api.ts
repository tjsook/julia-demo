import { getDashboardAuthHeaders } from "../dashboard-auth";
import type {
  JuliaROICollectionSession,
  JuliaRecordedAudio,
  JuliaVoiceIntentResponse,
  JuliaVoicePlaybackResponse,
} from "./types";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
type JuliaRequestOptions = { signal?: AbortSignal };

export class JuliaApiError extends Error {
  code: string;
  detail: string;
  status: number;

  constructor(code: string, detail: string, status: number) {
    super(detail);
    this.name = "JuliaApiError";
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

async function parseJuliaJson<T>(res: Response, fallback: string): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;

  try {
    const body: unknown = await res.json();
    if (isJuliaError(body)) {
      throw new JuliaApiError(body.error, body.detail, res.status);
    }
  } catch (err) {
    if (err instanceof JuliaApiError) {
      throw err;
    }
    throw new Error(fallback);
  }
  throw new Error(fallback);
}

function isJuliaError(body: unknown): body is { error: string; detail: string } {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return typeof candidate.error === "string" && typeof candidate.detail === "string";
}

export async function postJuliaVoiceIntent(
  recording: JuliaRecordedAudio,
  options: JuliaRequestOptions = {},
): Promise<JuliaVoiceIntentResponse> {
  const headers = await getDashboardAuthHeaders();
  const form = new FormData();
  form.set("audio", recording.blob, recording.filename);
  const res = await fetch(`${BASE_URL}/julia/voice/intent`, {
    method: "POST",
    headers,
    body: form,
    signal: options.signal,
  });
  return parseJuliaJson<JuliaVoiceIntentResponse>(res, "Failed to process Julia voice intent.");
}

export async function postJuliaVoiceGreeting(
  firstName?: string,
  options: JuliaRequestOptions = {},
): Promise<JuliaVoicePlaybackResponse> {
  const headers = await getDashboardAuthHeaders();
  const form = new FormData();
  if (firstName && firstName.trim()) {
    form.set("first_name", firstName.trim());
  }
  const res = await fetch(`${BASE_URL}/julia/voice/greeting`, {
    method: "POST",
    headers,
    body: form,
    signal: options.signal,
  });
  return parseJuliaJson<JuliaVoicePlaybackResponse>(res, "Failed to create Julia greeting prompt.");
}

export async function postJuliaRoiFollowup(
  recording: JuliaRecordedAudio,
  expectedField: string,
  session: JuliaROICollectionSession,
  options: JuliaRequestOptions = {},
): Promise<JuliaVoiceIntentResponse> {
  const headers = await getDashboardAuthHeaders();
  const form = new FormData();
  form.set("audio", recording.blob, recording.filename);
  form.set("expected_field", expectedField);
  form.set("session", JSON.stringify(session));
  const res = await fetch(`${BASE_URL}/julia/voice/roi-followup`, {
    method: "POST",
    headers,
    body: form,
    signal: options.signal,
  });
  return parseJuliaJson<JuliaVoiceIntentResponse>(res, "Failed to process Julia ROI follow-up.");
}
