export type JuliaVoiceIntent =
  | "non_doc"
  | "roi_analysis"
  | "roi_pending_input";

export type JuliaROIInputSymbol = "T" | "S" | "P" | "Ld" | "Du" | "R" | "minutes_per_order";
export type JuliaROIInputSource =
  | "rep"
  | "rep_qualitative"
  | "derived"
  | "default"
  | "user_approved_default";
export type JuliaROIEquationId = "E1" | "E2" | "E3" | "E3a" | "E3b" | "E3c" | "E5";

export interface JuliaROIPainPointMatch {
  id: string;
  confidence: number;
  evidence: string;
}

export interface JuliaROIResolvedInput {
  value: number;
  source: JuliaROIInputSource;
  confidence?: number | null;
  qualitative_tag?: string | null;
  rule?: string | null;
}

export type JuliaROIInputs = Partial<Record<JuliaROIInputSymbol, JuliaROIResolvedInput>>;

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
  annual_value: number;
}

export const SUB_SHARE_PARENT: Record<string, string> = {
  phone_work_overload: "office_labor_high",
  manual_order_entry: "office_labor_high",
  invoicing_billing_slow: "office_labor_high",
};

export interface JuliaROIAnalysisPayload {
  company_name?: string | null;
  matched_pain_points: JuliaROIPainPointMatch[];
  inputs: JuliaROIInputs;
  equations: JuliaROIEquationResult[];
  summary: JuliaROISummary;
  honesty_markers: string[];
}

export interface JuliaROIPendingInput {
  missing: JuliaROIPendingField[];
  next_field?: JuliaROIPendingField | null;
  question_text?: string | null;
  detail: string;
  session?: JuliaROICollectionSession | null;
}

export type JuliaROIPendingField =
  | "fleet_size"
  | "company_name"
  | "pain_points"
  | "T"
  | "S"
  | "P"
  | "Ld"
  | "Du"
  | "R"
  | "minutes_per_order";

export type JuliaROICollectionStage =
  | "intent"
  | "company"
  | "pain_points"
  | "numeric_fields"
  | "confirm_default"
  | "complete";

export interface JuliaROICollectionSession {
  original_transcript: string;
  answer_transcripts: string[];
  company_name: string | null;
  matched_pain_points: JuliaROIPainPointMatch[];
  variables: Partial<Record<JuliaROIInputSymbol, unknown>> & Record<string, unknown>;
  required_fields: JuliaROIPendingField[];
  collected_fields: JuliaROIPendingField[];
  missing_fields: JuliaROIPendingField[];
  resolved_inputs: Partial<Record<JuliaROIInputSymbol, JuliaROIResolvedInput>>;
  pending_default_field?: JuliaROIInputSymbol | null;
  pending_default_value?: number | null;
  pending_default_rule?: string | null;
  followup_markers: string[];
  stage: JuliaROICollectionStage;
}

export interface JuliaVoiceIntentResponse {
  transcript: string;
  intent: JuliaVoiceIntent;
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
