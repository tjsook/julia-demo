import type { JuliaDemoState } from "../../../hooks/julia/useJuliaDemo";
import type { JuliaVoiceMatch } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";
import { DocumentModal } from "./DocumentModal";
import { DocumentSelector } from "./DocumentSelector";
import { ErrorToast } from "./ErrorToast";
import { JuliaOrb } from "./JuliaOrb";

type DemoShellProps = {
  state: JuliaDemoState;
  errorToast: string | null;
  activeMatch: JuliaVoiceMatch | null;
  selectorMatches: JuliaVoiceMatch[];
  documentUrl: string | null;
  documentLoading: boolean;
  documentError: string | null;
  onOrbClick: () => void;
  onSelectMatch: (match: JuliaVoiceMatch) => void;
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
  documentUrl,
  documentLoading,
  documentError,
  onOrbClick,
  onSelectMatch,
  onCloseForeground,
  onDismissError,
}: DemoShellProps) {
  return (
    <main className={s.demoMain}>
      <div className={s.demoCenter}>
        <JuliaOrb state={state} onClick={onOrbClick} />
        <div className={s.demoStatus}>{statusLabel[state]}</div>
      </div>

      {state === "showing-document" && (
        <DocumentModal
          document={activeMatch}
          signedUrl={documentUrl}
          loading={documentLoading}
          error={documentError}
          onClose={onCloseForeground}
        />
      )}

      {state === "showing-selector" && (
        <DocumentSelector
          matches={selectorMatches}
          onSelect={onSelectMatch}
          onClose={onCloseForeground}
        />
      )}

      <ErrorToast message={errorToast} onDismiss={onDismissError} />
    </main>
  );
}
