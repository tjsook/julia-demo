import s from "../../../styles/julia.module.css";
import type { JuliaVoiceStopReason } from "../../../hooks/julia/useJuliaVoice";
import type { JuliaDebugStageTranscript } from "../../../hooks/julia/useJuliaDemo";

type JuliaDebugPanelProps = {
  transcript: string | null;
  stopReason: JuliaVoiceStopReason | null;
  audioSizeMb: number | null;
  durationSeconds: number | null;
  recording: boolean;
  stageTranscripts: JuliaDebugStageTranscript[];
  currentQuestionText: string | null;
};

export function JuliaDebugPanel({
  transcript,
  stopReason,
  audioSizeMb,
  durationSeconds,
  recording,
  stageTranscripts,
  currentQuestionText,
}: JuliaDebugPanelProps) {
  if (process.env.NEXT_PUBLIC_JULIA_DEBUG_MODE !== "true") {
    return null;
  }

  const transcriptText = transcript ?? "No recording yet.";
  const transcriptIsError =
    transcriptText.startsWith("[") && transcriptText.endsWith("]");

  return (
    <aside className={s.juliaDebugPanel} aria-label="Julia debug panel">
      <div className={s.juliaDebugHeader}>Julia debug</div>
      {recording ? (
        <div className={s.juliaDebugRecording}>Recording...</div>
      ) : (
        <>
          <div className={s.juliaDebugRow}>
            <span>Stop</span>
            <span>{stopReason ?? "n/a"}</span>
          </div>
          <div className={s.juliaDebugRow}>
            <span>Size</span>
            <span>{audioSizeMb === null ? "n/a" : `${audioSizeMb.toFixed(1)} MB`}</span>
          </div>
          <div className={s.juliaDebugRow}>
            <span>Duration</span>
            <span>{durationSeconds === null ? "n/a" : `${durationSeconds.toFixed(1)}s`}</span>
          </div>
          <div className={s.juliaDebugHistory}>
            <div className={s.juliaDebugTranscriptLabel}>Stage transcript history</div>
            {stageTranscripts.length === 0 ? (
              <div className={s.juliaDebugHistoryEmpty}>No stage transcripts yet.</div>
            ) : (
              <ul className={s.juliaDebugHistoryList}>
                {stageTranscripts.map((entry) => (
                  <li key={entry.id} className={s.juliaDebugHistoryItem}>
                    <div className={s.juliaDebugHistoryMeta}>
                      <span>{formatStageLabel(entry.stage)}</span>
                      {entry.expectedField && <span>field: {entry.expectedField}</span>}
                      {entry.intent && <span>intent: {entry.intent}</span>}
                    </div>
                    <pre>{entry.transcript}</pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={s.juliaDebugTranscript}>
            <div className={s.juliaDebugTranscriptLabel}>Current question</div>
            <pre>{currentQuestionText ?? "n/a"}</pre>
          </div>
          <div className={s.juliaDebugTranscript}>
            <div className={s.juliaDebugTranscriptLabel}>Transcript</div>
            <pre className={transcriptIsError ? s.juliaDebugTranscriptError : undefined}>
              {transcriptText}
            </pre>
          </div>
        </>
      )}
    </aside>
  );
}

function formatStageLabel(stage: JuliaDebugStageTranscript["stage"]): string {
  if (stage === "initial_intent") return "initial_intent";
  return stage;
}
