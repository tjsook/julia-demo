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

export type JuliaVoiceIntent =
  | "single_match"
  | "multi_match"
  | "no_match"
  | "non_doc"
  | "roi_analysis"
  | "roi_pending_input";

export interface JuliaVoiceMatch {
  id: string;
  title: string;
}

export type JuliaROIInputSymbol = "T" | "S" | "P" | "Ld" | "Du";
export type JuliaROIInputSource = "rep" | "derived" | "default";
export type JuliaROIEquationId = "E1" | "E2" | "E3" | "E3a" | "E3b" | "E3c" | "E4" | "E5";

export interface JuliaROIPainPointMatch {
  id: string;
  confidence: number;
  evidence: string;
}

export interface JuliaROIResolvedInput {
  value: number;
  source: JuliaROIInputSource;
  confidence?: number | null;
  rule?: string | null;
}

export interface JuliaROIInputs {
  T: JuliaROIResolvedInput;
  S: JuliaROIResolvedInput;
  P: JuliaROIResolvedInput;
  Ld: JuliaROIResolvedInput;
  Du: JuliaROIResolvedInput;
}

export interface JuliaROIEquationResult {
  id: JuliaROIEquationId;
  label: string;
  formula: string;
  inputs_used: Record<string, number>;
  result: number;
  unit: "usd_per_year";
  calibration_status: "placeholder" | "calibrated";
}

export interface JuliaROISummary {
  gross_annual_value: number;
  hemut_cost_per_year: number;
  net_annual_value: number;
  roi_multiple: number;
}

export interface JuliaROIAnalysisPayload {
  company_name?: string | null;
  matched_pain_points: JuliaROIPainPointMatch[];
  inputs: JuliaROIInputs;
  equations: JuliaROIEquationResult[];
  summary: JuliaROISummary;
  honesty_markers: string[];
}

export interface JuliaROIPendingInput {
  missing: Array<"fleet_size">;
  detail: string;
}

export interface JuliaVoiceIntentResponse {
  transcript: string;
  intent: JuliaVoiceIntent;
  matches: JuliaVoiceMatch[];
  roi_payload?: JuliaROIAnalysisPayload | null;
  roi_pending?: JuliaROIPendingInput | null;
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
