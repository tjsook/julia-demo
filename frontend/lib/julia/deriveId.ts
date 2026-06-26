export function deriveJuliaDocumentId(filename: string): string {
  const stem = filename.replace(/\.[^/.]+$/, "").toLowerCase();
  return stem
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function titleFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^/.]+$/, "");
  return stem
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
