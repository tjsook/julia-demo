declare module "@ricky0123/vad-web" {
  export interface MicVADOptions {
    onSpeechEnd?: (audio: Float32Array) => void;
    onVADMisfire?: () => void;
    positiveSpeechThreshold?: number;
    negativeSpeechThreshold?: number;
    redemptionFrames?: number;
  }

  export class MicVAD {
    static new(options: MicVADOptions): Promise<MicVAD>;
    start(): void;
    pause(): void;
    destroy?(): void;
  }
}
