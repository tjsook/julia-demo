import { useCallback, useEffect, useRef, useState } from "react";

import { postJuliaVoiceIntent } from "../../lib/julia/api";
import {
  buildRecordedAudio,
  createMediaRecorder,
  requestMicrophoneStream,
  stopMediaStream,
} from "../../lib/julia/recorder";
import type { JuliaRecordedAudio, JuliaVoiceIntentResponse } from "../../lib/julia/types";
import { createJuliaVad, stopJuliaVad, type JuliaVad } from "../../lib/julia/vad";

export type JuliaVoiceStatus = "idle" | "listening" | "processing";

type UseJuliaVoiceOptions = {
  onIntent: (response: JuliaVoiceIntentResponse) => void;
  onError: (message: string) => void;
};

export function useJuliaVoice({ onIntent, onError }: UseJuliaVoiceOptions) {
  const [status, setStatus] = useState<JuliaVoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<JuliaVoiceStatus>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const vadRef = useRef<JuliaVad | null>(null);
  const stopAndSubmitRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearRecordingResources = useCallback(() => {
    stopJuliaVad(vadRef.current);
    vadRef.current = null;
    if (streamRef.current) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const reportError = useCallback(
    (message: string) => {
      setError(message);
      onError(message);
    },
    [onError],
  );

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

  const cancelListening = useCallback(() => {
    if (statusRef.current === "idle") return;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    clearRecordingResources();
    setStatus("idle");
    setError(null);
  }, [clearRecordingResources]);

  const stopAndSubmit = useCallback(async () => {
    if (statusRef.current !== "listening") return;
    statusRef.current = "processing";
    setStatus("processing");
    stopJuliaVad(vadRef.current);
    vadRef.current = null;

    try {
      const recording = await stopRecorderForAudio();
      if (streamRef.current) {
        stopMediaStream(streamRef.current);
        streamRef.current = null;
      }
      recorderRef.current = null;
      chunksRef.current = [];
      const response = await postJuliaVoiceIntent(recording);
      onIntent(response);
      setError(null);
    } catch (err) {
      reportError(err instanceof Error ? err.message : "Julia voice processing failed.");
    } finally {
      clearRecordingResources();
      statusRef.current = "idle";
      setStatus("idle");
    }
  }, [clearRecordingResources, onIntent, reportError, stopRecorderForAudio]);

  useEffect(() => {
    stopAndSubmitRef.current = stopAndSubmit;
  }, [stopAndSubmit]);

  const startListening = useCallback(async () => {
    if (statusRef.current !== "idle") return;
    statusRef.current = "listening";
    setStatus("listening");
    setError(null);

    try {
      const stream = await requestMicrophoneStream();
      const recorder = createMediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();

      const vad = await createJuliaVad(() => {
        void stopAndSubmitRef.current();
      });
      vadRef.current = vad;
      vad.start();
    } catch (err) {
      clearRecordingResources();
      statusRef.current = "idle";
      setStatus("idle");
      reportError(err instanceof Error ? err.message : "Julia voice recording failed to start.");
    }
  }, [clearRecordingResources, reportError]);

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
  };
}
