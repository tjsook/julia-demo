import { getDashboardAuthHeaders } from "../dashboard-auth";
import { cacheInvalidatePrefix } from "../session-cache";
import type {
  JuliaDocument,
  JuliaDocumentListResponse,
  JuliaDocumentStatus,
  JuliaEditPayload,
  JuliaRecordedAudio,
  JuliaSignedUrlResponse,
  JuliaUploadPayload,
  JuliaVoiceIntentResponse,
  JuliaVoicePlaybackResponse,
} from "./types";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const JULIA_CACHE_PREFIX = "/julia/";

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

export async function fetchJuliaDocuments(
  status: JuliaDocumentStatus,
): Promise<JuliaDocumentListResponse> {
  const headers = await getDashboardAuthHeaders();
  const res = await fetch(`${BASE_URL}/julia/documents?status=${status}`, {
    headers,
    cache: "no-store",
  });
  return parseJuliaJson<JuliaDocumentListResponse>(res, "Failed to load Julia documents.");
}

export async function uploadJuliaDocument(payload: JuliaUploadPayload): Promise<JuliaDocument> {
  const headers = await getDashboardAuthHeaders();
  const form = new FormData();
  form.set("file", payload.file);
  form.set("title", payload.title);
  form.set("aliases", payload.aliases);
  const res = await fetch(`${BASE_URL}/julia/documents`, {
    method: "POST",
    headers,
    body: form,
  });
  const document = await parseJuliaJson<JuliaDocument>(res, "Failed to upload Julia document.");
  cacheInvalidatePrefix(JULIA_CACHE_PREFIX);
  return document;
}

export async function updateJuliaDocument(
  documentId: string,
  payload: JuliaEditPayload,
): Promise<JuliaDocument> {
  const headers = await getDashboardAuthHeaders();
  const form = new FormData();
  if (payload.title !== undefined) form.set("title", payload.title);
  if (payload.aliases !== undefined) form.set("aliases", payload.aliases);
  if (payload.isActive !== undefined) form.set("is_active", String(payload.isActive));
  if (payload.file) form.set("file", payload.file);
  const res = await fetch(`${BASE_URL}/julia/documents/${encodeURIComponent(documentId)}`, {
    method: "PATCH",
    headers,
    body: form,
  });
  const document = await parseJuliaJson<JuliaDocument>(res, "Failed to update Julia document.");
  cacheInvalidatePrefix(JULIA_CACHE_PREFIX);
  return document;
}

export async function hardDeleteJuliaDocument(documentId: string): Promise<void> {
  const headers = await getDashboardAuthHeaders();
  const res = await fetch(`${BASE_URL}/julia/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    headers,
  });
  if (res.status === 204) {
    cacheInvalidatePrefix(JULIA_CACHE_PREFIX);
    return;
  }
  await parseJuliaJson<never>(res, "Failed to permanently delete Julia document.");
}

export async function fetchJuliaSignedUrl(documentId: string): Promise<JuliaSignedUrlResponse> {
  const headers = await getDashboardAuthHeaders();
  const res = await fetch(
    `${BASE_URL}/julia/documents/${encodeURIComponent(documentId)}/signed-url`,
    { headers, cache: "no-store" },
  );
  return parseJuliaJson<JuliaSignedUrlResponse>(res, "Failed to create signed URL.");
}

export async function postJuliaVoiceIntent(
  recording: JuliaRecordedAudio,
): Promise<JuliaVoiceIntentResponse> {
  const headers = await getDashboardAuthHeaders();
  const form = new FormData();
  form.set("audio", recording.blob, recording.filename);
  const res = await fetch(`${BASE_URL}/julia/voice/intent`, {
    method: "POST",
    headers,
    body: form,
  });
  return parseJuliaJson<JuliaVoiceIntentResponse>(res, "Failed to process Julia voice intent.");
}

export async function postJuliaVoiceDocumentConfirmation(
  documentId: string,
): Promise<JuliaVoicePlaybackResponse> {
  const headers = await getDashboardAuthHeaders();
  const res = await fetch(
    `${BASE_URL}/julia/voice/documents/${encodeURIComponent(documentId)}/confirmation`,
    {
      method: "POST",
      headers,
      cache: "no-store",
    },
  );
  return parseJuliaJson<JuliaVoicePlaybackResponse>(res, "Failed to create Julia voice response.");
}
