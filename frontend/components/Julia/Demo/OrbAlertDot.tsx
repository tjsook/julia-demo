import s from "../../../styles/julia.module.css";

type OrbAlertDotProps = {
  message: string | null;
  onDismiss: () => void;
};

export function OrbAlertDot({ message, onDismiss }: OrbAlertDotProps) {
  if (!message) return null;

  return (
    <div className={s.orbAlertDot} role="alert" aria-live="polite">
      <button
        type="button"
        className={s.orbAlertDotButton}
        onClick={onDismiss}
        aria-label="Dismiss Julia error"
        title={message}
      >
        <span className={s.orbAlertDotCore} />
      </button>
      <div className={s.orbAlertTooltip}>{message}</div>
    </div>
  );
}
