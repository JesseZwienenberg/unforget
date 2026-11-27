/** First letter as a capital. Links are left alone ("https://…" must stay a working link). */
export function capitalizeFirst(text: string): string {
  const trimmed = text.trimStart();
  if (!trimmed || /^(https?:\/\/|www\.)/i.test(trimmed)) return trimmed;
  const first = String.fromCodePoint(trimmed.codePointAt(0)!);
  return first.toLocaleUpperCase('nl') + trimmed.slice(first.length);
}
