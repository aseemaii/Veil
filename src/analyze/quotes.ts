function normalise(value: string) {
  return value
    .normalize('NFC')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact substring after NFC, whitespace and curly-quote normalisation. No fuzzy matching. */
export function matchQuote(quote: string, outgoing: string): boolean {
  const needle = normalise(quote);
  return needle.length > 0 && normalise(outgoing).includes(needle);
}
