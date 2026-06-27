import type { JuliaRecordedAudio } from "./types";

export function assertMediaRecordingSupported(): void {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not supported in this browser.");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Audio recording is not supported in this browser.");
  }
}

export async function requestMicrophoneStream(): Promise<MediaStream> {
  assertMediaRecordingSupported();
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

export function createMediaRecorder(stream: MediaStream): MediaRecorder {
  assertMediaRecordingSupported();
  return new MediaRecorder(stream);
}

export function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function buildRecordedAudio(chunks: Blob[], mimeType: string): JuliaRecordedAudio {
  if (chunks.length === 0) {
    throw new Error("No audio was recorded.");
  }
  const blob = new Blob(chunks, { type: mimeType || "application/octet-stream" });
  return {
    blob,
    filename: filenameForAudioType(blob.type),
  };
}

function filenameForAudioType(mimeType: string): string {
  if (mimeType.includes("mp4")) return "julia-voice.mp4";
  if (mimeType.includes("mpeg")) return "julia-voice.mp3";
  if (mimeType.includes("ogg")) return "julia-voice.ogg";
  return "julia-voice.webm";
}
