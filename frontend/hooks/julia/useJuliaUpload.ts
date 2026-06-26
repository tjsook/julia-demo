import { useCallback, useState } from "react";
import { uploadJuliaDocument } from "../../lib/julia/api";
import type { JuliaDocument, JuliaUploadPayload } from "../../lib/julia/types";

type UploadState = "idle" | "uploading" | "done" | "error";

export function useJuliaUpload() {
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (payload: JuliaUploadPayload): Promise<JuliaDocument | null> => {
    setState("uploading");
    setError(null);
    try {
      const document = await uploadJuliaDocument(payload);
      setState("done");
      return document;
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Failed to upload Julia document.");
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);

  return { state, error, upload, reset };
}
