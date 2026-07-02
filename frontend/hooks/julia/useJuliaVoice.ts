import { useCallback, useEffect, useRef, useState } from "react";

import { JuliaApiError, postJuliaVoiceIntent } from "../../lib/julia/api";
import { createAmplitudeMeter } from "../../lib/julia/amplitude";
import {
  buildRecordedAudio,
  createMediaRecorder,
  requestMicrophoneStream,
  stopMediaStream,
} from "../../lib/julia/recorder";
import type { JuliaRecordedAudio, JuliaVoiceIntentResponse } from "../../lib/julia/types";

export type JuliaVoiceStatus = "idle" | "listening" | "processing";
export type JuliaVoiceStopReason = "button" | "error";

export type JuliaVoiceDebugSnapshot = {
  transcript: string | null;
  stopReason: JuliaVoiceStopReason | null;
  audioSizeMb: number | null;
  durationSeconds: number | null;
  recording: boolean;
};

type UseJuliaVoiceOptions = {
  onIntent: (response: JuliaVoiceIntentResponse) => void;
  onError: (message: string) => void;
  onAmplitude?: (level: number) => void;
};

export type JuliaVoiceSubmitter = (
  recording: JuliaRecordedAudio,
) => Promise<JuliaVoiceIntentResponse>;

export function useJuliaVoice({ onIntent, onError, onAmplitude }: UseJuliaVoiceOptions) {
  const [status, setStatus] = useState<JuliaVoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<JuliaVoiceDebugSnapshot>({
    transcript: null,
    stopReason: null,
    audioSizeMb: null,
    durationSeconds: null,
    recording: false,
  });
  const statusRef = useRef<JuliaVoiceStatus>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const amplitudeTeardownRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearRecordingResources = useCallback(() => {
    if (amplitudeTeardownRef.current) {
      amplitudeTeardownRef.current();
      amplitudeTeardownRef.current = null;
      onAmplitude?.(0);
    }
    if (streamRef.current) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, [onAmplitude]);

  const reportError = useCallback(
    (message: string) => {
      setError(message);
      onError(message);
    },
    [onError],
  );

  const recordingDurationSeconds = useCallback((): number | null => {
    if (recordingStartedAtRef.current === null) return null;
    const elapsedMs = Date.now() - recordingStartedAtRef.current;
    return Math.round((elapsedMs / 1000) * 10) / 10;
  }, []);

  const stopRecorderForAudio = useCallback(async (): Promise<JuliaRecordedAudio> => {
    const recorder = recorderRef.current;
    if (!recorder) {
      throw new Error("No active recording is available.");
    }
    if (recorder.state === "inactive") {
      return buildRecordedAudio(chunksRef.current, recorder.mimeType);
    }

    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        try {
          resolve(buildRecordedAudio(chunksRef.current, recorder.mimeType));
        } catch (err) {
          reject(err);
        }
      };
      recorder.stop();
    });
  }, []);

  const chunkAudioSizeMb = useCallback((): number => {
    const bytes = chunksRef.current.reduce((total, chunk) => total + chunk.size, 0);
    return Math.round((bytes / 1_000_000) * 10) / 10;
  }, []);

  const cancelListening = useCallback(() => {
    if (statusRef.current === "idle") return;
    const durationSeconds = recordingDurationSeconds();
    const audioSizeMb = chunkAudioSizeMb();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      recorder.stop();
    }
    clearRecordingResources();
    recordingStartedAtRef.current = null;
    setStatus("idle");
    setError(null);
    setDebugSnapshot({
      transcript: "[recording_cancelled]",
      stopReason: "error",
      audioSizeMb,
      durationSeconds,
      recording: false,
    });
  }, [chunkAudioSizeMb, clearRecordingResources, recordingDurationSeconds]);

  const stopAndSubmit = useCallback(async (submitter?: JuliaVoiceSubmitter) => {
    if (statusRef.current !== "listening") return;
    statusRef.current = "processing";
    setStatus("processing");
    setDebugSnapshot((current) => ({ ...current, recording: false }));
    const durationSeconds = recordingDurationSeconds();

    try {
      const recording = await stopRecorderForAudio();
      const audioSizeMb = Math.round((recording.blob.size / 1_000_000) * 10) / 10;
      if (streamRef.current) {
        stopMediaStream(streamRef.current);
        streamRef.current = null;
      }
      recorderRef.current = null;
      chunksRef.current = [];
      const submit = submitter ?? postJuliaVoiceIntent;
      const response = await submit(recording);
      onIntent(response);
      setError(null);
      setDebugSnapshot({
        transcript: response.transcript,
        stopReason: "button",
        audioSizeMb,
        durationSeconds,
        recording: false,
      });
    } catch (err) {
      const audioSizeMb = chunkAudioSizeMb();
      if (err instanceof JuliaApiError) {
        setDebugSnapshot({
          transcript: `[${err.code}]`,
          stopReason: "button",
          audioSizeMb,
          durationSeconds,
          recording: false,
        });
        reportError(err.detail);
      } else {
        setDebugSnapshot({
          transcript: "[voice_processing_failed]",
          stopReason: "button",
          audioSizeMb,
          durationSeconds,
          recording: false,
        });
        reportError(err instanceof Error ? err.message : "Julia voice processing failed.");
      }
    } finally {
      clearRecordingResources();
      recordingStartedAtRef.current = null;
      statusRef.current = "idle";
      setStatus("idle");
    }
  }, [chunkAudioSizeMb, clearRecordingResources, onIntent, recordingDurationSeconds, reportError, stopRecorderForAudio]);

  const startListening = useCallback(async () => {
    if (statusRef.current !== "idle") return;
    statusRef.current = "listening";
    setStatus("listening");
    setError(null);
    setDebugSnapshot({
      transcript: null,
      stopReason: null,
      audioSizeMb: null,
      durationSeconds: null,
      recording: true,
    });
    recordingStartedAtRef.current = Date.now();

    try {
      const stream = await requestMicrophoneStream();
      const recorder = createMediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      if (onAmplitude) {
        try {
          amplitudeTeardownRef.current = createAmplitudeMeter(stream, onAmplitude);
        } catch (err) {
          console.log("julia.voice.amplitude_unavailable", {
            event: "julia.voice.amplitude_unavailable",
            error: err instanceof Error ? err.message : "Amplitude meter unavailable.",
          });
          onAmplitude(0);
          amplitudeTeardownRef.current = null;
        }
      }
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        if (statusRef.current !== "listening") return;
        clearRecordingResources();
        const durationSeconds = recordingDurationSeconds();
        const audioSizeMb = chunkAudioSizeMb();
        recordingStartedAtRef.current = null;
        statusRef.current = "idle";
        setStatus("idle");
        setDebugSnapshot({
          transcript: "[media_recorder_error]",
          stopReason: "error",
          audioSizeMb,
          durationSeconds,
          recording: false,
        });
        reportError("Julia voice recording failed during capture.");
      };
      recorder.start();

      // VAD deactivated per JULIA-VOICE-CAPTURE-ARCHITECTURE.md (julia-optimization-2).
      // Click-to-end is the only stop mechanism. The vad.ts wrapper and the
      // @ricky0123/vad-web dep are intentionally retained so VAD can be re-enabled
      // by re-instantiating MicVAD here. Do not delete without a planning revisit.
    } catch (err) {
      clearRecordingResources();
      recordingStartedAtRef.current = null;
      statusRef.current = "idle";
      setStatus("idle");
      setDebugSnapshot({
        transcript: "[recording_start_failed]",
        stopReason: "error",
        audioSizeMb: null,
        durationSeconds: null,
        recording: false,
      });
      reportError(err instanceof Error ? err.message : "Julia voice recording failed to start.");
    }
  }, [chunkAudioSizeMb, clearRecordingResources, onAmplitude, recordingDurationSeconds, reportError]);

  useEffect(() => {
    return () => {
      clearRecordingResources();
    };
  }, [clearRecordingResources]);

  return {
    status,
    error,
    startListening,
    stopAndSubmit,
    cancelListening,
    debugSnapshot,
  };
}
