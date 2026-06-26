import { getSession } from "next-auth/react";
import type {
  JuliaDocument,
  JuliaDocumentListResponse,
  JuliaDocumentStatus,
  JuliaEditPayload,
  JuliaSignedUrlResponse,
  JuliaUploadPayload,
} from "./types";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

async function dashboardAuthHeaders(): Promise<HeadersInit> {
  const session = await getSession();
  if (session?.authError) {
    throw new Error(`Dashboard session auth failed: ${session.authError}`);
  }
  if (!session?.idToken) {
    throw new Error("Dashboard session is missing a Google ID token. Sign out and sign in again.");
  }
  return { Authorization: `Bearer ${session.idToken}` };
}

async function parseJuliaJson<T>(res: Response, fallback: string): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;

  let message = fallback;
  try {
    const body: unknown = await res.json();
    if (isJuliaError(body)) message = body.detail;
  } catch {
    throw new Error(message);
  }
  throw new Error(message);
}

function isJuliaError(body: unknown): body is { error: string; detail: string } {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return typeof candidate.error === "string" && typeof candidate.detail === "string";
}

export async function fetchJuliaDocuments(
  status: JuliaDocumentStatus,
): Promise<JuliaDocumentListResponse> {
  const headers = await dashboardAuthHeaders();
  const res = await fetch(`${BASE_URL}/julia/documents?status=${status}`, {
    headers,
    cache: "no-store",
  });
  return parseJuliaJson<JuliaDocumentListResponse>(res, "Failed to load Julia documents.");
}

export async function uploadJuliaDocument(payload: JuliaUploadPayload): Promise<JuliaDocument> {
  const headers = await dashboardAuthHeaders();
  const form = new FormData();
  form.set("file", payload.file);
  form.set("title", payload.title);
  form.set("aliases", payload.aliases);
  const res = await fetch(`${BASE_URL}/julia/documents`, {
    method: "POST",
    headers,
    body: form,
  });
  return parseJuliaJson<JuliaDocument>(res, "Failed to upload Julia document.");
}

export async function updateJuliaDocument(
  documentId: string,
  payload: JuliaEditPayload,
): Promise<JuliaDocument> {
  const headers = await dashboardAuthHeaders();
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
  return parseJuliaJson<JuliaDocument>(res, "Failed to update Julia document.");
}

export async function hardDeleteJuliaDocument(documentId: string): Promise<void> {
  const headers = await dashboardAuthHeaders();
  const res = await fetch(`${BASE_URL}/julia/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    headers,
  });
  if (res.status === 204) return;
  await parseJuliaJson<never>(res, "Failed to permanently delete Julia document.");
}

export async function fetchJuliaSignedUrl(documentId: string): Promise<JuliaSignedUrlResponse> {
  const headers = await dashboardAuthHeaders();
  const res = await fetch(
    `${BASE_URL}/julia/documents/${encodeURIComponent(documentId)}/signed-url`,
    { headers, cache: "no-store" },
  );
  return parseJuliaJson<JuliaSignedUrlResponse>(res, "Failed to create signed URL.");
}
