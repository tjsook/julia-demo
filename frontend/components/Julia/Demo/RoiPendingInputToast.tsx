import { X } from "lucide-react";

import s from "../../../styles/julia.module.css";

type RoiPendingInputToastProps = {
  detail: string | null;
  onDismiss: () => void;
};

export function RoiPendingInputToast({ detail, onDismiss }: RoiPendingInputToastProps) {
  if (!detail) return null;

  return (
    <div className={s.roiPendingToast} role="status" aria-live="polite">
      <span>{detail}</span>
      <button type="button" className={s.roiPendingToastClose} onClick={onDismiss} aria-label="Dismiss">
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
