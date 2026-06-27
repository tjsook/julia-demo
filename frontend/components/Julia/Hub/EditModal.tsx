import * as Dialog from "@radix-ui/react-dialog";
import { FilePenLine, WandSparkles, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { updateJuliaDocument } from "../../../lib/julia/api";
import { deriveAliasSuggestions } from "../../../lib/julia/deriveAliasSuggestions";
import type { JuliaDocument } from "../../../lib/julia/types";
import {
  validateJuliaAliases,
  validateJuliaFile,
  validateJuliaTitle,
} from "../../../lib/julia/validation";
import s from "../../../styles/julia.module.css";

type EditModalProps = {
  document: JuliaDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
};

export function EditModal({ document, open, onOpenChange, onSaved }: EditModalProps) {
  const [title, setTitle] = useState("");
  const [aliases, setAliases] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!document || !open) return;
    setTitle(document.title);
    setAliases(document.aliases.join(", "));
    setFile(null);
    setError(null);
  }, [document, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document) return;

    const validationError =
      validateJuliaTitle(title) ??
      validateJuliaAliases(aliases) ??
      (file ? validateJuliaFile(file) : null);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateJuliaDocument(document.id, { title, aliases, file: file ?? undefined });
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update Julia document.");
    } finally {
      setSaving(false);
    }
  }

  const aliasSuggestions = deriveAliasSuggestions(title);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <div className={s.dialogHeader}>
            <div className={s.dialogTitleRow}>
              <FilePenLine size={18} strokeWidth={1.9} />
              <Dialog.Title className={s.dialogTitle}>Edit document</Dialog.Title>
            </div>
            <Dialog.Close className={s.iconButton} aria-label="Close">
              <X size={16} strokeWidth={1.8} />
            </Dialog.Close>
          </div>

          <form className={s.form} onSubmit={handleSubmit}>
            <label className={s.field}>
              <span>Title</span>
              <input value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
            </label>

            <div className={s.field}>
              <div className={s.fieldHeader}>
                <label htmlFor="julia-edit-aliases">Aliases</label>
                <button
                  type="button"
                  className={s.aliasSuggestButton}
                  disabled={saving || aliasSuggestions.length === 0}
                  onClick={() => setAliases(aliasSuggestions.join(", "))}
                >
                  <WandSparkles size={14} strokeWidth={1.8} />
                  <span>Suggest from title</span>
                </button>
              </div>
              <textarea
                id="julia-edit-aliases"
                value={aliases}
                onChange={(event) => setAliases(event.currentTarget.value)}
                rows={3}
              />
            </div>

            <label className={s.field}>
              <span>Replace PDF</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
              />
            </label>

            {error && <div className={s.formError}>{error}</div>}

            <div className={s.dialogActions}>
              <Dialog.Close className={s.secondaryButton} disabled={saving}>
                Cancel
              </Dialog.Close>
              <button type="submit" className={s.primaryButton} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
