export function createAmplitudeMeter(
  stream: MediaStream,
  onLevel: (level: number) => void,
): () => void {
  const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) {
    throw new Error("AudioContext is not available for amplitude metering.");
  }

  const audioContext = new Context();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.82;
  sourceNode.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  let rafId: number | null = null;
  let lastEmitAt = 0;
  let envelope = 0;

  const tick = (now: number) => {
    analyser.getByteTimeDomainData(samples);
    let sumSquares = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const normalized = (samples[index] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    const noiseGate = 0.008;
    const gated = Math.max(0, rms - noiseGate);
    const normalized = clamp01(gated * 17.5);
    const sensitive = Math.pow(normalized, 0.68);
    const lerp = sensitive > envelope ? 0.42 : 0.12;
    envelope += (sensitive - envelope) * lerp;

    if (now - lastEmitAt >= 33) {
      lastEmitAt = now;
      onLevel(clamp01(envelope));
    }
    rafId = window.requestAnimationFrame(tick);
  };

  rafId = window.requestAnimationFrame(tick);

  return () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    try {
      sourceNode.disconnect();
    } catch {}
    try {
      analyser.disconnect();
    } catch {}
    void audioContext.close().catch(() => undefined);
  };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
