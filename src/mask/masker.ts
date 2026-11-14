import type { Category, Proposal } from '../detect/types';

export interface PlaceholderMap {
  toValue: Map<string, string>;
  toPlaceholder: Map<string, string>;
  occurrenceValues: Map<string, string[]>;
}

export interface OutSpan {
  placeholder: string;
  origStart: number;
  origEnd: number;
  outStart: number;
  outEnd: number;
}

export interface MaskResult {
  outgoing: string;
  map: PlaceholderMap;
  spans: OutSpan[];
}

export const prefixByCategory: Record<Category, string> = {
  party: 'PARTY',
  address: 'ADDRESS',
  email: 'EMAIL',
  phone: 'PHONE',
  card: 'CARD',
  iban: 'ACCOUNT',
  gov_id: 'ID',
  account: 'ACCOUNT',
  other: 'DETAIL',
};

function normalise(value: string) {
  return value.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function flexiblePattern(value: string) {
  return value.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
}

export function mask(text: string, accepted: Proposal[]): MaskResult {
  const toValue = new Map<string, string>();
  const toPlaceholder = new Map<string, string>();
  const occurrenceValues = new Map<string, string[]>();
  const categoryCounts = new Map<string, number>();
  const values = new Map<string, { value: string; placeholder: string }>();

  for (const proposal of [...accepted].sort((left, right) => left.start - right.start)) {
    const key = normalise(proposal.text);
    if (values.has(key)) continue;
    const prefix = proposal.placeholderHint ?? prefixByCategory[proposal.category];
    const count = proposal.placeholderHint ? 0 : (categoryCounts.get(prefix) ?? 0) + 1;
    if (!proposal.placeholderHint) categoryCounts.set(prefix, count);
    const placeholder = `[${prefix}${count ? `-${count}` : ''}]`;
    values.set(key, { value: proposal.text, placeholder });
    toValue.set(placeholder, proposal.text);
    toPlaceholder.set(key, placeholder);
  }

  const occurrences: Array<{ start: number; end: number; value: string; placeholder: string }> = [];
  for (const { value, placeholder } of values.values()) {
    const expression = new RegExp(flexiblePattern(value), 'giu');
    for (const match of text.matchAll(expression)) {
      if (match.index === undefined) continue;
      occurrences.push({ start: match.index, end: match.index + match[0].length, value: match[0], placeholder });
    }
  }

  occurrences.sort((left, right) => left.start - right.start || right.end - left.end);
  const filtered = occurrences.filter((entry, index, entries) =>
    !entries.slice(0, index).some((previous) => entry.start < previous.end && entry.end > previous.start));
  for (const occurrence of filtered) {
    const valuesForPlaceholder = occurrenceValues.get(occurrence.placeholder) ?? [];
    valuesForPlaceholder.push(occurrence.value);
    occurrenceValues.set(occurrence.placeholder, valuesForPlaceholder);
  }

  let cursor = 0;
  let outgoing = '';
  const spans: OutSpan[] = [];
  for (const occurrence of filtered) {
    outgoing += text.slice(cursor, occurrence.start);
    const outStart = outgoing.length;
    outgoing += occurrence.placeholder;
    spans.push({
      placeholder: occurrence.placeholder,
      origStart: occurrence.start,
      origEnd: occurrence.end,
      outStart,
      outEnd: outgoing.length,
    });
    cursor = occurrence.end;
  }
  outgoing += text.slice(cursor);
  return { outgoing, map: { toValue, toPlaceholder, occurrenceValues }, spans };
}

export function restore(value: string, map: PlaceholderMap): string {
  const queues = new Map(
    [...map.occurrenceValues].map(([placeholder, values]) => [placeholder, values.slice()]),
  );
  return value.replace(/\[[A-Z]+(?:-\d+)?\]/g, (placeholder) =>
    queues.get(placeholder)?.shift() ?? map.toValue.get(placeholder) ?? placeholder);
}
