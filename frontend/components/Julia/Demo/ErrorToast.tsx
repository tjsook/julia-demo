import { X } from "lucide-react";

import s from "../../../styles/julia.module.css";

type ErrorToastProps = {
  message: string | null;
  onDismiss: () => void;
};

export function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  if (!message) return null;

  return (
    <div className={s.juliaToast} role="alert">
      <span>{message}</span>
      <button type="button" className={s.juliaToastClose} onClick={onDismiss} aria-label="Dismiss">
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
