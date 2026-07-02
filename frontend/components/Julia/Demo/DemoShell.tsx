import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";

import type { JuliaDemoState } from "../../../hooks/julia/useJuliaDemo";
import type { JuliaROIAnalysisPayload, JuliaVoiceMatch } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";
import { DocumentModal } from "./DocumentModal";
import { DocumentSelector } from "./DocumentSelector";
import { OrbAlertDot } from "./OrbAlertDot";
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
  activeSubtitleText: string | null;
  showProcessingSplash: boolean;
  processingSplashLine: string;
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
  activeSubtitleText,
  showProcessingSplash,
  processingSplashLine,
  roiProgressStep,
  requiredNumericCount,
  collectedNumericCount,
  onOrbClick,
  onSelectMatch,
  onCloseForeground,
  onDismissError,
  onDismissRoiPending,
}: DemoShellProps) {
  const [orbSize, setOrbSize] = useState(440);
  const isDebugMode = process.env.NEXT_PUBLIC_JULIA_DEBUG_MODE === "true";
  const interactionHint = isDebugMode ? hintTextForState(state) : null;
  const progressSteps = isDebugMode && roiProgressStep
    ? buildProgressSteps({
        current: roiProgressStep,
        requiredNumericCount,
        collectedNumericCount,
      })
    : [];
  const isDimmed =
    state === "showing-document" ||
    state === "showing-selector" ||
    state === "showing-roi-report" ||
    state === "playing-roi-question";
  const orbMode =
    errorToast ? "alert" : isDimmed ? "dimmed" : state === "listening" ? "listening" : state === "processing" ? "processing" : "idle";
  const showConsole = !isDebugMode && !isDimmed;
  const consoleLines = showConsole
    ? buildShowConsoleLines({
        state,
        activeSubtitleText,
        showProcessingSplash,
        processingSplashLine,
        roiProgressStep,
        requiredNumericCount,
        collectedNumericCount,
        currentQuestionText,
        roiPendingDetail,
        errorToast,
      })
    : [];

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateOrbSize = () => {
      const maxByViewport = Math.max(300, window.innerWidth - 48);
      setOrbSize(Math.min(460, maxByViewport));
    };
    updateOrbSize();
    window.addEventListener("resize", updateOrbSize);
    return () => window.removeEventListener("resize", updateOrbSize);
  }, []);

  return (
    <main className={s.demoMain}>
      <div className={s.demoCenter}>
        <ParticleOrb
          mode={orbMode}
          amplitudeRef={micAmplitudeRef}
          onClick={onOrbClick}
          size={orbSize}
          className={s.particleOrbButton}
          disabled={state === "processing" || isDimmed}
        />
        {isDebugMode && <div className={s.demoStatus}>{statusLabel[state]}</div>}
        {interactionHint && <div className={s.demoHint}>{interactionHint}</div>}
        {currentQuestionText && (
          <div className={s.screenReaderOnly} role="status" aria-live="polite">
            {currentQuestionText}
          </div>
        )}
        {currentQuestionText && isDebugMode && (
          <div className={s.demoQuestion} aria-hidden="true">
            {currentQuestionText}
          </div>
        )}
        {showConsole && (
          <section className={s.demoConsole} aria-hidden="true">
            <div className={s.demoConsoleHeader}>JULIA::CONSOLE</div>
            <div className={s.demoConsoleBody}>
              {consoleLines.map((line, index) => (
                <div key={`${line.prefix}-${index}`} className={s.demoConsoleLine}>
                  <span className={s.demoConsolePrefix}>{line.prefix}</span>
                  <span>{line.message}</span>
                </div>
              ))}
            </div>
          </section>
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

      <OrbAlertDot message={errorToast} onDismiss={onDismissError} />
      {isDebugMode && (
        <RoiPendingInputToast detail={roiPendingDetail} onDismiss={onDismissRoiPending} />
      )}
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

function buildShowConsoleLines({
  state,
  activeSubtitleText,
  showProcessingSplash,
  processingSplashLine,
  roiProgressStep,
  requiredNumericCount,
  collectedNumericCount,
  currentQuestionText,
  roiPendingDetail,
  errorToast,
}: {
  state: JuliaDemoState;
  activeSubtitleText: string | null;
  showProcessingSplash: boolean;
  processingSplashLine: string;
  roiProgressStep: "company" | "pain_points" | "numeric_fields" | "complete" | null;
  requiredNumericCount: number;
  collectedNumericCount: number;
  currentQuestionText: string | null;
  roiPendingDetail: string | null;
  errorToast: string | null;
}): Array<{ prefix: string; message: string }> {
  const lines: Array<{ prefix: string; message: string }> = [
    { prefix: "[core]", message: `state=${stateToConsoleMode(state)}` },
  ];
  if (roiProgressStep) {
    const numericSummary = requiredNumericCount > 0
      ? `${Math.min(collectedNumericCount, requiredNumericCount)}/${requiredNumericCount}`
      : "n/a";
    lines.push({ prefix: "[roi ]", message: `phase=${roiProgressStep} fields=${numericSummary}` });
  }
  if (showProcessingSplash) {
    lines.push({ prefix: "[proc]", message: processingSplashLine });
  }
  if (activeSubtitleText) {
    lines.push({ prefix: "[tts ]", message: compactConsoleText(activeSubtitleText) });
  } else if (currentQuestionText && state !== "idle") {
    lines.push({ prefix: "[prompt]", message: compactConsoleText(currentQuestionText) });
  } else if (state === "idle") {
    lines.push({ prefix: "[ready]", message: "awaiting voice command" });
  }
  if (roiPendingDetail) {
    lines.push({ prefix: "[input]", message: compactConsoleText(roiPendingDetail) });
  }
  if (errorToast) {
    lines.push({ prefix: "[error]", message: compactConsoleText(errorToast) });
  }
  return lines.slice(0, 6);
}

function compactConsoleText(value: string): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= 140) return compacted;
  return `${compacted.slice(0, 137)}...`;
}

function stateToConsoleMode(state: JuliaDemoState): string {
  const labelByState: Record<JuliaDemoState, string> = {
    idle: "ready",
    listening: "mic_live",
    processing: "reasoning",
    "showing-document": "document_open",
    "showing-selector": "selector_open",
    "showing-roi-report": "report_open",
    "asking-initial-intent": "boot_prompt",
    "collecting-company-name": "collect_company",
    "collecting-pain-points": "collect_pain_points",
    "collecting-roi-field": "collect_inputs",
    "playing-roi-question": "playing_prompt",
    "roi-pending-input": "pending_input",
  };
  return labelByState[state];
}
