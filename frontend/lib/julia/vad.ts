import { MicVAD } from "@ricky0123/vad-web";

export type JuliaVad = Pick<MicVAD, "start" | "pause"> & {
  destroy?: () => void;
};

export async function createJuliaVad(onSpeechEnd: () => void): Promise<JuliaVad> {
  try {
    return await MicVAD.new({
      onSpeechEnd: () => onSpeechEnd(),
      redemptionFrames: 24,
    });
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Voice activity detection failed to start: ${err.message}`
        : "Voice activity detection failed to start.",
    );
  }
}

export function stopJuliaVad(vad: JuliaVad | null): void {
  if (!vad) return;
  vad.pause();
  vad.destroy?.();
}
