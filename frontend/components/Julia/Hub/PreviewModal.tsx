import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, FileText, X } from "lucide-react";

import type { JuliaDocument } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";

type PreviewModalProps = {
  document: JuliaDocument | null;
  signedUrl: string | null;
  loading: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
};

export function PreviewModal({
  document,
  signedUrl,
  loading,
  error,
  onOpenChange,
}: PreviewModalProps) {
  const open = document !== null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.previewContent}>
          <div className={s.dialogHeader}>
            <div className={s.dialogTitleRow}>
              <FileText size={18} strokeWidth={1.9} />
              <div>
                <Dialog.Title className={s.dialogTitle}>
                  {document?.title ?? "Document preview"}
                </Dialog.Title>
                {document && <div className={s.docId}>{document.id}</div>}
              </div>
            </div>
            <div className={s.rowActions}>
              {signedUrl && (
                <a
                  className={s.iconButton}
                  href={signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open PDF in new tab"
                  title="Open in new tab"
                >
                  <ExternalLink size={16} strokeWidth={1.8} />
                </a>
              )}
              <Dialog.Close className={s.iconButton} aria-label="Close">
                <X size={16} strokeWidth={1.8} />
              </Dialog.Close>
            </div>
          </div>

          {loading && <div className={s.previewState}>Creating preview link...</div>}
          {!loading && error && <div className={s.previewError}>{error}</div>}
          {!loading && signedUrl && (
            <iframe
              className={s.previewFrame}
              src={signedUrl}
              title={document ? `${document.title} PDF preview` : "PDF preview"}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
