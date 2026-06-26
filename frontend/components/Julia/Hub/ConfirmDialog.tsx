import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";

import s from "../../../styles/julia.module.css";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.confirmContent}>
          <div className={s.dialogHeader}>
            <div className={s.dialogTitleRow}>
              <AlertTriangle size={18} strokeWidth={1.9} />
              <Dialog.Title className={s.dialogTitle}>{title}</Dialog.Title>
            </div>
            <Dialog.Close className={s.iconButton} aria-label="Close">
              <X size={16} strokeWidth={1.8} />
            </Dialog.Close>
          </div>
          <Dialog.Description className={s.dialogDescription}>
            {description}
          </Dialog.Description>
          <div className={s.dialogActions}>
            <Dialog.Close className={s.secondaryButton} disabled={busy}>
              Cancel
            </Dialog.Close>
            <button
              type="button"
              className={s.dangerButton}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? "Deleting..." : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
