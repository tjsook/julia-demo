const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_TITLE_CHARS = 200;
const MAX_ALIASES = 10;
const MIN_ALIAS_CHARS = 2;
const MAX_ALIAS_CHARS = 80;

export function validateJuliaFile(file: File | null | undefined): string | null {
  if (!file) return "Choose a PDF file.";
  if (file.size > MAX_PDF_BYTES) return "PDF must be 25 MB or smaller.";
  if (file.type !== "application/pdf") return "File must be a PDF.";
  return null;
}

export function validateJuliaTitle(title: string): string | null {
  const cleaned = title.trim();
  if (!cleaned) return "Title is required.";
  if (cleaned.length > MAX_TITLE_CHARS) return "Title must be 200 characters or fewer.";
  return null;
}

export function normalizeJuliaAliases(rawAliases: string): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const part of rawAliases.split(",")) {
    const cleaned = part.trim().toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    aliases.push(cleaned);
  }
  return aliases;
}

export function validateJuliaAliases(rawAliases: string): string | null {
  const aliases = normalizeJuliaAliases(rawAliases);
  if (aliases.length === 0) return "At least one alias is required.";
  if (aliases.length > MAX_ALIASES) return "At most 10 aliases are allowed.";
  if (aliases.some((alias) => alias.length < MIN_ALIAS_CHARS || alias.length > MAX_ALIAS_CHARS)) {
    return "Each alias must be 2-80 characters.";
  }
  return null;
}
