import { X } from "lucide-react";

import type { JuliaDemoState } from "../../../hooks/julia/useJuliaDemo";
import type { JuliaVoiceMatch } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";
import { ErrorToast } from "./ErrorToast";
import { JuliaOrb } from "./JuliaOrb";

type DemoShellProps = {
  state: JuliaDemoState;
  errorToast: string | null;
  activeMatch: JuliaVoiceMatch | null;
  selectorMatches: JuliaVoiceMatch[];
  onOrbClick: () => void;
  onCloseForeground: () => void;
  onDismissError: () => void;
};

const statusLabel: Record<JuliaDemoState, string> = {
  idle: "Ready",
  listening: "Listening",
  processing: "Processing",
  "showing-document": "Document",
  "showing-selector": "Select document",
};

export function DemoShell({
  state,
  errorToast,
  activeMatch,
  selectorMatches,
  onOrbClick,
  onCloseForeground,
  onDismissError,
}: DemoShellProps) {
  return (
    <main className={s.demoMain}>
      <div className={s.demoCenter}>
        <JuliaOrb state={state} onClick={onOrbClick} />
        <div className={s.demoStatus}>{statusLabel[state]}</div>
      </div>

      {(state === "showing-document" || state === "showing-selector") && (
        <section className={s.demoPlaceholderOverlay}>
          <button
            type="button"
            className={s.demoCloseButton}
            onClick={onCloseForeground}
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.8} />
          </button>
          {state === "showing-document" && activeMatch && (
            <div className={s.demoPlaceholderPanel}>
              <div className={s.demoPlaceholderEyebrow}>Matched document</div>
              <h1>{activeMatch.title}</h1>
            </div>
          )}
          {state === "showing-selector" && (
            <div className={s.demoPlaceholderPanel}>
              <div className={s.demoPlaceholderEyebrow}>Multiple matches</div>
              {selectorMatches.map((match) => (
                <div key={match.id} className={s.demoSelectorPreviewItem}>
                  {match.title}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <ErrorToast message={errorToast} onDismiss={onDismissError} />
    </main>
  );
}
