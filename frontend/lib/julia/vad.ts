import { MicVAD } from "@ricky0123/vad-web";

const JULIA_VAD_ASSET_PATH = "/julia-vad/";
const JULIA_VAD_SILENCE_MS = 1000;

export type JuliaVad = Pick<MicVAD, "start" | "pause"> & {
  destroy?: () => void;
};

export async function createJuliaVad(onSpeechEnd: () => void): Promise<JuliaVad> {
  try {
    return await MicVAD.new({
      baseAssetPath: JULIA_VAD_ASSET_PATH,
      model: "legacy",
      onnxWASMBasePath: JULIA_VAD_ASSET_PATH,
      onSpeechEnd: () => onSpeechEnd(),
      redemptionMs: JULIA_VAD_SILENCE_MS,
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
