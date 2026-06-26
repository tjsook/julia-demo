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
