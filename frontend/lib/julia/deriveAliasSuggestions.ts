const PUNCTUATION_RE = /[.,!?;:"()[\]\-/\\]+/g;
const APOSTROPHE_RE = /[']/g;
const MAX_ALIAS_SUGGESTIONS = 10;

export function deriveAliasSuggestions(title: string): string[] {
  const tokens = tokenizeTitle(title);
  const suggestions: string[] = [];
  const seen = new Set<string>();

  for (let size = tokens.length; size >= 1; size -= 1) {
    for (let start = 0; start <= tokens.length - size; start += 1) {
      const window = tokens.slice(start, start + size);
      if (isRepeatedTokenPhrase(window)) continue;

      const phrase = window.join(" ");
      if (seen.has(phrase)) continue;

      seen.add(phrase);
      suggestions.push(phrase);
      if (suggestions.length === MAX_ALIAS_SUGGESTIONS) return suggestions;
    }
  }

  return suggestions;
}

function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(APOSTROPHE_RE, "")
    .replace(PUNCTUATION_RE, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function isRepeatedTokenPhrase(tokens: string[]): boolean {
  return tokens.length > 1 && tokens.every((token) => token === tokens[0]);
}
