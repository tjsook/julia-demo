import * as Dialog from "@radix-ui/react-dialog";
import { FilePlus2, WandSparkles, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { useJuliaUpload } from "../../../hooks/julia/useJuliaUpload";
import { deriveAliasSuggestions } from "../../../lib/julia/deriveAliasSuggestions";
import { deriveJuliaDocumentId, titleFromFilename } from "../../../lib/julia/deriveId";
import {
  validateJuliaAliases,
  validateJuliaFile,
  validateJuliaTitle,
} from "../../../lib/julia/validation";
import s from "../../../styles/julia.module.css";

type UploadModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => Promise<void>;
};

export function UploadModal({ open, onOpenChange, onUploaded }: UploadModalProps) {
  const { state, error, upload, reset } = useJuliaUpload();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [aliases, setAliases] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setTitle("");
    setAliases("");
    setLocalError(null);
    reset();
  }, [open, reset]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError =
      validateJuliaFile(file) ?? validateJuliaTitle(title) ?? validateJuliaAliases(aliases);
    if (validationError) {
      setLocalError(validationError);
      return;
    }
    if (!file) return;
    const document = await upload({ file, title, aliases });
    if (!document) return;
    await onUploaded();
    onOpenChange(false);
  }

  function handleFileChange(nextFile: File | null) {
    setFile(nextFile);
    if (nextFile && !title.trim()) {
      setTitle(titleFromFilename(nextFile.name));
    }
  }

  const busy = state === "uploading";
  const idPreview = file ? deriveJuliaDocumentId(file.name) : "";
  const aliasSuggestions = deriveAliasSuggestions(title);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <div className={s.dialogHeader}>
            <div className={s.dialogTitleRow}>
              <FilePlus2 size={18} strokeWidth={1.9} />
              <Dialog.Title className={s.dialogTitle}>Upload document</Dialog.Title>
            </div>
            <Dialog.Close className={s.iconButton} aria-label="Close">
              <X size={16} strokeWidth={1.8} />
            </Dialog.Close>
          </div>

          <form className={s.form} onSubmit={handleSubmit}>
            <label className={s.field}>
              <span>PDF file</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={(event) => handleFileChange(event.currentTarget.files?.[0] ?? null)}
              />
            </label>
            {idPreview && <div className={s.previewText}>Document id: {idPreview}</div>}

            <label className={s.field}>
              <span>Title</span>
              <input value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
            </label>

            <div className={s.field}>
              <div className={s.fieldHeader}>
                <label htmlFor="julia-upload-aliases">Aliases</label>
                <button
                  type="button"
                  className={s.aliasSuggestButton}
                  disabled={busy || aliasSuggestions.length === 0}
                  onClick={() => setAliases(aliasSuggestions.join(", "))}
                >
                  <WandSparkles size={14} strokeWidth={1.8} />
                  <span>Suggest from title</span>
                </button>
              </div>
              <textarea
                id="julia-upload-aliases"
                value={aliases}
                onChange={(event) => setAliases(event.currentTarget.value)}
                rows={3}
                placeholder="meiborg, meiborg roi, meiborg case"
              />
            </div>

            {(localError || error) && (
              <div className={s.formError}>{localError ?? error}</div>
            )}

            <div className={s.dialogActions}>
              <Dialog.Close className={s.secondaryButton} disabled={busy}>
                Cancel
              </Dialog.Close>
              <button type="submit" className={s.primaryButton} disabled={busy}>
                {busy ? "Uploading..." : "Upload"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
