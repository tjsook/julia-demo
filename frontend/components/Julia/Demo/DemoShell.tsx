import type { JuliaDemoState } from "../../../hooks/julia/useJuliaDemo";
import type { JuliaROIAnalysisPayload, JuliaVoiceMatch } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";
import { DocumentModal } from "./DocumentModal";
import { DocumentSelector } from "./DocumentSelector";
import { ErrorToast } from "./ErrorToast";
import { JuliaOrb } from "./JuliaOrb";
import { RoiPendingInputToast } from "./RoiPendingInputToast";
import { RoiReportModal } from "./RoiReportModal";

type DemoShellProps = {
  state: JuliaDemoState;
  errorToast: string | null;
  activeMatch: JuliaVoiceMatch | null;
  selectorMatches: JuliaVoiceMatch[];
  documentUrl: string | null;
  documentLoading: boolean;
  documentError: string | null;
  roiPayload: JuliaROIAnalysisPayload | null;
  roiPendingDetail: string | null;
  onOrbClick: () => void;
  onSelectMatch: (match: JuliaVoiceMatch) => void;
  onCloseForeground: () => void;
  onDismissError: () => void;
  onDismissRoiPending: () => void;
};

const statusLabel: Record<JuliaDemoState, string> = {
  idle: "Ready",
  listening: "Listening",
  processing: "Processing",
  "showing-document": "Document",
  "showing-selector": "Select document",
  "showing-roi-report": "ROI report",
  "roi-pending-input": "Need fleet size",
};

export function DemoShell({
  state,
  errorToast,
  activeMatch,
  selectorMatches,
  documentUrl,
  documentLoading,
  documentError,
  roiPayload,
  roiPendingDetail,
  onOrbClick,
  onSelectMatch,
  onCloseForeground,
  onDismissError,
  onDismissRoiPending,
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

      {state === "showing-roi-report" && (
        <RoiReportModal payload={roiPayload} onClose={onCloseForeground} />
      )}

      <ErrorToast message={errorToast} onDismiss={onDismissError} />
      <RoiPendingInputToast detail={roiPendingDetail} onDismiss={onDismissRoiPending} />
    </main>
  );
}
