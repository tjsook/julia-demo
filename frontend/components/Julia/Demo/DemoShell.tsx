import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";

import type { JuliaDemoState, JuliaTerminalRecognizedLine } from "../../../hooks/julia/useJuliaDemo";
import type { JuliaROIAnalysisPayload } from "../../../lib/julia/types";
import s from "../../../styles/julia.module.css";
import { OrbAlertDot } from "./OrbAlertDot";
import { ParticleOrb } from "./ParticleOrb";
import { RoiPendingInputToast } from "./RoiPendingInputToast";
import { RoiReportModal } from "./RoiReportModal";

type DemoShellProps = {
  state: JuliaDemoState;
  errorToast: string | null;
  roiPayload: JuliaROIAnalysisPayload | null;
  roiPendingDetail: string | null;
  micAmplitudeRef: MutableRefObject<number>;
  isStartupLocked: boolean;
  terminalRecognizedLines: JuliaTerminalRecognizedLine[];
  terminalCancelMessage: string | null;
  currentQuestionText: string | null;
  activeSubtitleText: string | null;
  showProcessingSplash: boolean;
  processingSplashLine: string;
  roiProgressStep: "company" | "pain_points" | "numeric_fields" | "complete" | null;
  requiredNumericCount: number;
  collectedNumericCount: number;
  onOrbClick: () => void;
  onCloseForeground: () => void;
  onDismissError: () => void;
  onDismissRoiPending: () => void;
};

const statusLabel: Record<JuliaDemoState, string> = {
  idle: "Ready",
  listening: "Listening",
  processing: "Processing",
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
  roiPayload,
  roiPendingDetail,
  micAmplitudeRef,
  isStartupLocked,
  terminalRecognizedLines,
  terminalCancelMessage,
  currentQuestionText,
  activeSubtitleText,
  showProcessingSplash,
  processingSplashLine,
  roiProgressStep,
  requiredNumericCount,
  collectedNumericCount,
  onOrbClick,
  onCloseForeground,
  onDismissError,
  onDismissRoiPending,
}: DemoShellProps) {
  const [orbSize, setOrbSize] = useState(440);
  const isDebugMode = process.env.NEXT_PUBLIC_JULIA_DEBUG_MODE === "true";
  const interactionHint = isDebugMode ? hintTextForState(state) : null;
  const isDimmed =
    state === "showing-roi-report" ||
    state === "playing-roi-question";
  const orbMode =
    errorToast ? "alert" : isDimmed ? "dimmed" : state === "listening" ? "listening" : state === "processing" ? "processing" : "idle";
  const showConsole = !isDimmed;
  const consoleLines = showConsole
    ? buildShowConsoleLines({
        state,
        activeSubtitleText,
        showProcessingSplash,
        processingSplashLine,
        roiProgressStep,
        requiredNumericCount,
        collectedNumericCount,
        terminalRecognizedLines,
        terminalCancelMessage,
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
          disabled={isStartupLocked || state === "processing" || isDimmed}
        />
        {isDebugMode && !showConsole && <div className={s.demoStatus}>{statusLabel[state]}</div>}
        {interactionHint && !showConsole && <div className={s.demoHint}>{interactionHint}</div>}
        {currentQuestionText && (
          <div className={s.screenReaderOnly} role="status" aria-live="polite">
            {currentQuestionText}
          </div>
        )}
        {currentQuestionText && isDebugMode && !showConsole && (
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
      </div>

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

function buildShowConsoleLines({
  state,
  activeSubtitleText,
  showProcessingSplash,
  processingSplashLine,
  roiProgressStep,
  requiredNumericCount,
  collectedNumericCount,
  terminalRecognizedLines,
  terminalCancelMessage,
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
  terminalRecognizedLines: JuliaTerminalRecognizedLine[];
  terminalCancelMessage: string | null;
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
  lines.push(...terminalRecognizedLines.map((line) => ({ prefix: line.prefix, message: line.message })));
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
  if (terminalCancelMessage) {
    lines.push({ prefix: "[cancel]", message: compactConsoleText(terminalCancelMessage) });
  }
  if (roiPendingDetail) {
    lines.push({ prefix: "[input]", message: compactConsoleText(roiPendingDetail) });
  }
  if (errorToast) {
    lines.push({ prefix: "[error]", message: compactConsoleText(errorToast) });
  }
  return lines.slice(0, 9);
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
