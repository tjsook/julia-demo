export type JuliaDocumentStatus = "active" | "archived" | "all";

export interface JuliaDocument {
  id: string;
  title: string;
  aliases: string[];
  mime_type: string;
  uploaded_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface JuliaDocumentListResponse {
  documents: JuliaDocument[];
}

export interface JuliaSignedUrlResponse {
  id: string;
  title: string;
  signed_url: string;
  expires_in: number;
}

export interface JuliaUploadPayload {
  file: File;
  title: string;
  aliases: string;
}

export interface JuliaEditPayload {
  title?: string;
  aliases?: string;
  isActive?: boolean;
  file?: File;
}

export type JuliaVoiceIntent = "single_match" | "multi_match" | "no_match" | "non_doc";

export interface JuliaVoiceMatch {
  id: string;
  title: string;
}

export interface JuliaVoiceIntentResponse {
  transcript: string;
  intent: JuliaVoiceIntent;
  matches: JuliaVoiceMatch[];
  tts_audio_base64: string | null;
  tts_mime_type: string | null;
}

export interface JuliaVoicePlaybackResponse {
  tts_audio_base64: string | null;
  tts_mime_type: string | null;
}

export interface JuliaRecordedAudio {
  blob: Blob;
  filename: string;
}
