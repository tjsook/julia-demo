const FILLER_CLIPS = [
  "/julia/fillers/one-moment.mp3",
  "/julia/fillers/let-me-think.mp3",
  "/julia/fillers/checking-that.mp3",
  "/julia/fillers/almost-there.mp3",
] as const;

export function pickFillerSrc(exclude: Set<string>): string {
  const available = FILLER_CLIPS.filter((clip) => !exclude.has(clip));
  if (available.length === 0) {
    return FILLER_CLIPS[0];
  }
  const index = Math.floor(Math.random() * available.length);
  const selected = available[index];
  if (!selected) {
    throw new Error("No filler clip is available for playback.");
  }
  return selected;
}
