import { useCallback, useEffect, useState } from "react";
import {
  fetchJuliaDocuments,
  hardDeleteJuliaDocument,
  updateJuliaDocument,
} from "../../lib/julia/api";
import type { JuliaDocument, JuliaDocumentStatus } from "../../lib/julia/types";

export function useJuliaDocuments(status: JuliaDocumentStatus) {
  const [documents, setDocuments] = useState<JuliaDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchJuliaDocuments(status);
      setDocuments(response.documents);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Julia documents.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActive = useCallback(
    async (documentId: string, isActive: boolean) => {
      setSaving(true);
      try {
        await updateJuliaDocument(documentId, { isActive });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update Julia document.");
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  const hardDelete = useCallback(
    async (documentId: string) => {
      setSaving(true);
      try {
        await hardDeleteJuliaDocument(documentId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete Julia document.");
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  return {
    documents,
    loading,
    saving,
    error,
    refresh,
    setActive,
    hardDelete,
    setError,
  };
}
