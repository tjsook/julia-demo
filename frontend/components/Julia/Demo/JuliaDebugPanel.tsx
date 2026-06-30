import s from "../../../styles/julia.module.css";
import type { JuliaVoiceStopReason } from "../../../hooks/julia/useJuliaVoice";

type JuliaDebugPanelProps = {
  transcript: string | null;
  stopReason: JuliaVoiceStopReason | null;
  audioSizeMb: number | null;
  durationSeconds: number | null;
  recording: boolean;
};

export function JuliaDebugPanel({
  transcript,
  stopReason,
  audioSizeMb,
  durationSeconds,
  recording,
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
