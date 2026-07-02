import type { MutableRefObject } from "react";

import type { JuliaDemoState } from "../../../hooks/julia/useJuliaDemo";
import type { JuliaROIAnalysisPayload, JuliaVoiceMatch } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";
import { CaptionsToggle, useCaptionsEnabled } from "./CaptionsToggle";
import { DocumentModal } from "./DocumentModal";
import { DocumentSelector } from "./DocumentSelector";
import { ErrorToast } from "./ErrorToast";
import { ParticleOrb } from "./ParticleOrb";
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
  micAmplitudeRef: MutableRefObject<number>;
  currentQuestionText: string | null;
  roiProgressStep: "company" | "pain_points" | "numeric_fields" | "complete" | null;
  requiredNumericCount: number;
  collectedNumericCount: number;
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
  "asking-initial-intent": "Julia prompt",
  "collecting-company-name": "Company step",
  "collecting-pain-points": "Pain-point step",
  "collecting-roi-field": "Input step",
  "playing-roi-question": "Playing prompt",
  "roi-pending-input": "Waiting for input",
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
  micAmplitudeRef,
  currentQuestionText,
  roiProgressStep,
  requiredNumericCount,
  collectedNumericCount,
  onOrbClick,
  onSelectMatch,
  onCloseForeground,
  onDismissError,
  onDismissRoiPending,
}: DemoShellProps) {
  const isDebugMode = process.env.NEXT_PUBLIC_JULIA_DEBUG_MODE === "true";
  const interactionHint = isDebugMode ? hintTextForState(state) : null;
  const progressSteps = isDebugMode && roiProgressStep
    ? buildProgressSteps({
        current: roiProgressStep,
        requiredNumericCount,
        collectedNumericCount,
      })
    : [];
  const [captionsEnabled, toggleCaptions] = useCaptionsEnabled();
  const isDimmed =
    state === "showing-document" ||
    state === "showing-selector" ||
    state === "showing-roi-report" ||
    state === "playing-roi-question";
  const orbMode =
    errorToast ? "alert" : isDimmed ? "dimmed" : state === "listening" ? "listening" : state === "processing" ? "processing" : "idle";

  return (
    <main className={s.demoMain}>
      <div className={s.demoCenter}>
        {!isDebugMode && <CaptionsToggle enabled={captionsEnabled} onToggle={toggleCaptions} />}
        <ParticleOrb
          mode={orbMode}
          amplitudeRef={micAmplitudeRef}
          onClick={onOrbClick}
          size={380}
          className={s.particleOrbButton}
          disabled={state === "processing" || isDimmed}
        />
        {isDebugMode && <div className={s.demoStatus}>{statusLabel[state]}</div>}
        {interactionHint && <div className={s.demoHint}>{interactionHint}</div>}
        {currentQuestionText && !captionsEnabled && (
          <div className={s.screenReaderOnly} role="status" aria-live="polite">
            {currentQuestionText}
          </div>
        )}
        {currentQuestionText && isDebugMode && (
          <div className={s.demoQuestion} aria-hidden="true">
            {currentQuestionText}
          </div>
        )}
        {!isDebugMode && captionsEnabled && currentQuestionText && (
          <div className={s.captionsLine} role="status" aria-live="polite">
            {currentQuestionText}
          </div>
        )}
        {progressSteps.length > 0 && (
          <section className={s.roiProgress} aria-label="ROI progress">
            <div className={s.roiProgressTitle}>ROI progress</div>
            <ol className={s.roiProgressList}>
              {progressSteps.map((step) => (
                <li
                  key={step.id}
                  className={
                    step.status === "done"
                      ? s.roiProgressDone
                      : step.status === "active"
                        ? s.roiProgressActive
                        : s.roiProgressUpcoming
                  }
                >
                  <span>{step.label}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
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

function hintTextForState(state: JuliaDemoState): string | null {
  if (
    state === "asking-initial-intent" ||
    state === "collecting-company-name" ||
    state === "collecting-pain-points" ||
    state === "collecting-roi-field"
  ) {
    return "Julia auto-starts listening after each spoken prompt. Click the orb when you finish speaking.";
  }
  if (state === "listening") {
    return "Recording now. Click the orb to stop and submit.";
  }
  if (state === "processing") {
    return "Processing your answer...";
  }
  return null;
}

function buildProgressSteps({
  current,
  requiredNumericCount,
  collectedNumericCount,
}: {
  current: "company" | "pain_points" | "numeric_fields" | "complete";
  requiredNumericCount: number;
  collectedNumericCount: number;
}): Array<{
  id: "company" | "pain_points" | "numeric_fields" | "complete";
  label: string;
  status: "done" | "active" | "upcoming";
}> {
  const ordered: Array<"company" | "pain_points" | "numeric_fields" | "complete"> = [
    "company",
    "pain_points",
    "numeric_fields",
    "complete",
  ];
  const labels: Record<string, string> = {
    company: "Company",
    pain_points: "Pain points",
    numeric_fields:
      requiredNumericCount > 0
        ? `Inputs (${Math.min(collectedNumericCount, requiredNumericCount)}/${requiredNumericCount})`
        : "Inputs",
    complete: "Report",
  };
  const currentIndex = ordered.indexOf(current);
  return ordered.map((id, index) => ({
    id,
    label: labels[id],
    status: index < currentIndex ? "done" : index === currentIndex ? "active" : "upcoming",
  }));
}
