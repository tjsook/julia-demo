declare module "@ricky0123/vad-web" {
  export interface MicVADOptions {
    baseAssetPath?: string;
    model?: "v5" | "legacy";
    onnxWASMBasePath?: string;
    onSpeechEnd?: (audio: Float32Array) => void;
    onVADMisfire?: () => void;
    positiveSpeechThreshold?: number;
    negativeSpeechThreshold?: number;
    redemptionMs?: number;
  }

  export class MicVAD {
    static new(options: MicVADOptions): Promise<MicVAD>;
    start(): void;
    pause(): void;
    destroy?(): void;
  }
}
