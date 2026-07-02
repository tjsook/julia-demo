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
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.7;
  sourceNode.connect(analyser);

  const bins = new Uint8Array(analyser.frequencyBinCount);
  let rafId: number | null = null;
  let lastEmitAt = 0;
  let smoothed = 0;

  const tick = (now: number) => {
    analyser.getByteFrequencyData(bins);
    const start = 2;
    const end = Math.min(30, bins.length - 1);
    let sumSquares = 0;
    let count = 0;
    for (let index = start; index <= end; index += 1) {
      const normalized = bins[index] / 255;
      sumSquares += normalized * normalized;
      count += 1;
    }
    const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
    smoothed = smoothed * 0.82 + rms * 0.18;

    if (now - lastEmitAt >= 33) {
      lastEmitAt = now;
      onLevel(clamp01(smoothed * 2.2));
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
