import { detect } from '../detect';
import type { Category } from '../detect/types';
import { prefixByCategory } from '../mask/masker';
import { AMBIGUOUS_NAMES, COMMON_WORDS, GIVEN_NAMES } from './names';

/**
 * Incognito mode: a conversation-wide placeholder vault that lives only in this tab's memory.
 * The same value always gets the same placeholder, so the model can follow who is who across turns,
 * and replies are swapped back to real values on this device only.
 */
export interface Vault {
  byKey: ReadonlyMap<string, string>;
  byPlaceholder: ReadonlyMap<string, string>;
  counts: ReadonlyMap<string, number>;
  /** Values the user chose to send as typed ("don't hide"), normalised. */
  allow: ReadonlySet<string>;
}

export interface HiddenDetail {
  placeholder: string;
  value: string;
}

export interface MaskedMessage {
  outgoing: string;
  hidden: HiddenDetail[];
  vault: Vault;
}

const PLACEHOLDER = /\[([A-Z]+)(?:-(\d+))?\]/g;
const MIN_KNOWN_LENGTH = 3;

interface Rule {
  prefix: string;
  pattern: RegExp;
  /** Capture group holding the value; 0 means the whole match. */
  group?: number;
}

// Free-form chat has no "Landlord:" labels, so these rules look for how people actually write personal details.
// Rules with a group only hide the value after a cue ("my password is …"), which keeps false positives low.
const NAME = "[A-Z][a-zA-Z'-]+(?:\\s+[A-Z][a-zA-Z'-]+){0,2}";
const RELATION = 'wife|husband|son|daughter|mother|mom|mum|father|dad|brother|sister|partner|friend|boss|manager|landlord|landlady|tenant|roommate|flatmate|neighbour|neighbor|lawyer|doctor|colleague|girlfriend|boyfriend|fianc[eé]e?';
const CUE = '\\s*(?:is|:|=|-|#)?\\s*';
export const CHAT_RULES: readonly Rule[] = [
  // Names
  { prefix: 'PERSON', group: 1, pattern: new RegExp(`\\b(?:[Mm]y name is|[Mm]y name's|[Cc]all me|[Nn]ame:|[Ss]igned,|[Rr]egards,|[Ss]incerely,|[Tt]hanks,|[Cc]heers,|[Bb]est,)\\s+(${NAME})`, 'g') },
  { prefix: 'PERSON', group: 1, pattern: /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Shri|Smt)\.?\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/g },
  { prefix: 'PERSON', group: 1, pattern: /\b(?:I am|I'm|this is)\s+([A-Z][a-zA-Z'-]+\s+[A-Z][a-zA-Z'-]+)/g },
  { prefix: 'PERSON', group: 1, pattern: new RegExp(`\\b[Mm]y (?:${RELATION})(?:'s name)?(?:,)?\\s+(?:is\\s+|named\\s+|called\\s+)?(${NAME})`, 'g') },
  // Secrets and credentials
  { prefix: 'SECRET', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { prefix: 'SECRET', pattern: /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant|or)?[-_]?[A-Za-z0-9_-]{16,}/g },
  { prefix: 'SECRET', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/g },
  { prefix: 'SECRET', pattern: /\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { prefix: 'SECRET', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { prefix: 'SECRET', pattern: /\bed25519:[1-9A-HJ-NP-Za-km-z]{40,}/g },
  { prefix: 'SECRET', pattern: /\b[A-Fa-f0-9]{40,}\b/g },
  { prefix: 'SECRET', group: 1, pattern: /\b(?:seed phrase|recovery phrase|secret phrase|mnemonic)\s*(?:is|:)?\s*((?:[a-z]+\s+){11,23}[a-z]+)/gi },
  { prefix: 'PASSWORD', group: 1, pattern: new RegExp(`\\b(?:password|passcode|passwd|pwd|pin(?! ?code)|otp|one[- ]time code|security code|cvv)${CUE}([^\\s,;]{3,64})`, 'gi') },
  // Accounts, money and IDs
  { prefix: 'ACCOUNT', group: 1, pattern: new RegExp(`\\b(?:account(?: no\\.?| number)?|a\\/c(?: no\\.?)?|acct)${CUE}(\\d[\\d -]{5,22}\\d)`, 'gi') },
  { prefix: 'ACCOUNT', pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { prefix: 'ACCOUNT', pattern: /\b[\w.-]{2,}@(?:ok[a-z]+|upi|ybl|paytm|ibl|axl|apl|[a-z]{2,10}bank)\b/gi },
  { prefix: 'ID', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { prefix: 'ID', group: 1, pattern: new RegExp(`\\b(?:passport(?: no\\.?| number)?|driving licen[cs]e(?: no\\.?| number)?|licen[cs]e no\\.?|voter id|national id|ssn|social security(?: number)?|tax id|aadhaa?r(?: no\\.?| number)?|pan(?: no\\.?| number)?)${CUE}([A-Z0-9][A-Z0-9 -]{4,18}[A-Z0-9])`, 'gi') },
  // Crypto wallets
  { prefix: 'WALLET', pattern: /\b0x[a-fA-F0-9]{40}\b/g },
  { prefix: 'WALLET', pattern: /\bbc1[a-z0-9]{25,59}\b/g },
  { prefix: 'WALLET', pattern: /\b[a-z0-9][a-z0-9_-]{1,62}\.(?:near|tg)\b/g },
  // Places and network
  { prefix: 'ADDRESS', group: 1, pattern: /\b(?:i live at|i live in|my address is|address:|located at|i stay at|ship to|deliver to)\s+([^\n.;!?]{4,80})/gi },
  { prefix: 'ADDRESS', pattern: /\b\d{1,5}[A-Za-z]?,?\s+(?:[A-Z][a-z]+\s){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Boulevard|Blvd|Drive|Dr|Court|Ct|Way|Place|Pl|Nagar|Marg|Colony|Sector|Layout|Terrace|Close)\b\.?/g },
  { prefix: 'POSTCODE', group: 1, pattern: new RegExp(`\\b(?:pin ?code|zip(?: code)?|postal code|postcode)${CUE}([A-Z0-9][A-Z0-9 -]{2,9}[A-Z0-9])`, 'gi') },
  { prefix: 'POSTCODE', pattern: /\b[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}\b/g },
  { prefix: 'IP', pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  // Dates of birth (only with a cue: ordinary dates are not personal)
  { prefix: 'DOB', group: 1, pattern: new RegExp(`\\b(?:born on|date of birth|dob|birthday)${CUE}([^\\n,;!?]{4,30}?)(?=[\\n,;!?]|\\.(?:\\s|$)|$)`, 'gi') },
];

export function createVault(): Vault {
  return { byKey: new Map(), byPlaceholder: new Map(), counts: new Map(), allow: new Set() };
}

function normalise(value: string) {
  return value.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/** Matches the value as a whole token: "cat" never matches inside "category". */
function valuePattern(value: string) {
  const body = value.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const start = /^[\p{L}\p{N}_]/u.test(value.trim()) ? '(?<![\\p{L}\\p{N}_])' : '';
  const end = /[\p{L}\p{N}_]$/u.test(value.trim()) ? '(?![\\p{L}\\p{N}_])' : '';
  return new RegExp(`${start}${body}${end}`, 'giu');
}

function bump(counts: Map<string, number>, placeholder: string) {
  for (const match of placeholder.matchAll(PLACEHOLDER)) {
    const [, prefix, number] = match;
    if (prefix && number) counts.set(prefix, Math.max(counts.get(prefix) ?? 0, Number(number)));
  }
}

/** Adds values that already have placeholders (the document's masks). Existing entries win, so a placeholder never changes meaning mid-conversation. */
export function seedVault(vault: Vault, entries: Iterable<readonly [placeholder: string, value: string]>): Vault {
  const byKey = new Map(vault.byKey);
  const byPlaceholder = new Map(vault.byPlaceholder);
  const counts = new Map(vault.counts);
  for (const [placeholder, value] of entries) {
    const key = normalise(value);
    if (!key || byPlaceholder.has(placeholder) || byKey.has(key)) continue;
    byPlaceholder.set(placeholder, value);
    byKey.set(key, placeholder);
    bump(counts, placeholder);
  }
  return { byKey, byPlaceholder, counts, allow: vault.allow };
}

/** The user marked something to hide that the rules missed. It stays hidden for the rest of the conversation. */
export function hideValue(vault: Vault, value: string): Vault {
  const key = normalise(value);
  const allow = new Set(vault.allow);
  allow.delete(key);
  if (!key || vault.byKey.has(key)) return { ...vault, allow };
  const counts = new Map(vault.counts);
  const count = (counts.get('HIDDEN') ?? 0) + 1;
  counts.set('HIDDEN', count);
  const placeholder = `[HIDDEN-${count}]`;
  return {
    byKey: new Map(vault.byKey).set(key, placeholder),
    byPlaceholder: new Map(vault.byPlaceholder).set(placeholder, value.trim()),
    counts,
    allow,
  };
}

/** The user said a hidden value is fine to send as typed (a false positive). Reversible with hideValue. */
export function allowValue(vault: Vault, value: string): Vault {
  return { ...vault, allow: new Set(vault.allow).add(normalise(value)) };
}

interface Found {
  value: string;
  prefix: string;
}

export interface DetectOptions {
  /** Strict: also hide unusual capitalised words, long standalone numbers and code-like strings. */
  strict?: boolean;
}

const WORD = /[\p{L}][\p{L}'’-]*/gu;

function atSentenceStart(text: string, index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const character = text[cursor] ?? '';
    if (/\s/.test(character) || character === '"' || character === '“' || character === '(') continue;
    return /[.!?\n:]/.test(character);
  }
  return true;
}

const isCapitalised = (word: string) => /^\p{Lu}\p{Ll}/u.test(word);

/**
 * Names written with no cue ("ask Rohit", "rohit said"), from a list of common given names. A following capitalised
 * word is taken as the surname. Names that are also ordinary words ("Will", "Mark") count only when capitalised and
 * not at the start of a sentence.
 */
function dictionaryNames(text: string): Found[] {
  const found: Found[] = [];
  const words = [...text.matchAll(WORD)];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word || word.index === undefined) continue;
    const lower = word[0].toLocaleLowerCase();
    if ((!GIVEN_NAMES.has(lower) && !AMBIGUOUS_NAMES.has(lower)) || COMMON_WORDS.has(lower)) continue;
    if (AMBIGUOUS_NAMES.has(lower) && (!isCapitalised(word[0]) || atSentenceStart(text, word.index))) continue;
    let end = word.index + word[0].length;
    for (let next = index + 1; next < words.length && next <= index + 2; next += 1) {
      const surname = words[next];
      if (!surname || surname.index === undefined || !isCapitalised(surname[0]) || COMMON_WORDS.has(surname[0].toLocaleLowerCase())) break;
      if (!/^[ \t]+$/.test(text.slice(end, surname.index))) break;
      end = surname.index + surname[0].length;
      index = next;
    }
    found.push({ value: text.slice(word.index, end), prefix: 'PERSON' });
  }
  return found;
}

/** Strict mode: anything that looks like a proper noun, an ID-sized number or a code. Over-hides on purpose. */
function strictDetails(text: string): Found[] {
  const found: Found[] = [];
  const words = [...text.matchAll(WORD)];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word || word.index === undefined || !isCapitalised(word[0]) || COMMON_WORDS.has(word[0].toLocaleLowerCase()) || atSentenceStart(text, word.index)) continue;
    let end = word.index + word[0].length;
    while (index + 1 < words.length) {
      const next = words[index + 1];
      if (!next || next.index === undefined || !isCapitalised(next[0]) || !/^[ \t]+$/.test(text.slice(end, next.index))) break;
      end = next.index + next[0].length;
      index += 1;
    }
    found.push({ value: text.slice(word.index, end), prefix: 'NAME' });
  }
  for (const match of text.matchAll(/(?<![\d.,])\d{4,}(?![\d.,]?\d)/g)) {
    if (/^(19|20)\d{2}$/.test(match[0])) continue; // a year on its own is not personal
    found.push({ value: match[0], prefix: 'NUMBER' });
  }
  for (const match of text.matchAll(/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,}\b/g)) {
    found.push({ value: match[0], prefix: 'CODE' });
  }
  return found;
}

export function findDetails(text: string, options: DetectOptions = {}): Found[] {
  const found: Found[] = detect(text).map((proposal) => ({ value: proposal.text.trim(), prefix: proposal.placeholderHint ?? prefixByCategory[proposal.category as Category] }));
  for (const rule of CHAT_RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const value = match[rule.group ?? 0]?.trim().replace(/[.,:;!?)]+$/, '');
      if (value && value.length >= 2) found.push({ value, prefix: rule.prefix });
    }
  }
  found.push(...dictionaryNames(text));
  if (options.strict) found.push(...strictDetails(text));
  return found;
}

/** Replaces every detected or already-known detail with its placeholder. Pure: returns the grown vault instead of changing it. */
export function maskMessage(text: string, vault: Vault, options: DetectOptions = {}): MaskedMessage {
  const byKey = new Map(vault.byKey);
  const byPlaceholder = new Map(vault.byPlaceholder);
  const counts = new Map(vault.counts);

  const placeholderFor = (value: string, prefix: string) => {
    const key = normalise(value);
    const known = byKey.get(key);
    if (known) return known;
    const count = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, count);
    const placeholder = `[${prefix}-${count}]`;
    byKey.set(key, placeholder);
    byPlaceholder.set(placeholder, value);
    return placeholder;
  };

  const values = new Map<string, { value: string; placeholder: string }>();
  for (const { value, prefix } of findDetails(text, options)) {
    const key = normalise(value);
    if (key && !values.has(key) && !vault.allow.has(key)) values.set(key, { value, placeholder: placeholderFor(value, prefix) });
  }
  // Values hidden earlier (by a rule, by hand, or in the document) stay hidden when they come up again.
  const lowered = text.toLocaleLowerCase();
  for (const [key, placeholder] of byKey) {
    if (values.has(key) || vault.allow.has(key) || key.length < MIN_KNOWN_LENGTH || !lowered.includes(key.split(' ')[0] ?? key)) continue;
    values.set(key, { value: byPlaceholder.get(placeholder) ?? key, placeholder });
  }

  const occurrences: Array<{ start: number; end: number; placeholder: string; value: string }> = [];
  for (const { value, placeholder } of values.values()) {
    for (const match of text.matchAll(valuePattern(value))) {
      if (match.index === undefined) continue;
      occurrences.push({ start: match.index, end: match.index + match[0].length, placeholder, value });
    }
  }
  // Text the user chose to send as typed stays whole: nothing inside it is hidden (e.g. a name inside an allowed email).
  const keep: Array<[number, number]> = [];
  for (const allowed of vault.allow) {
    if (!allowed) continue;
    for (const match of text.matchAll(valuePattern(allowed))) {
      if (match.index !== undefined) keep.push([match.index, match.index + match[0].length]);
    }
  }
  const kept = occurrences.filter((occurrence) => !keep.some(([start, end]) => occurrence.start < end && occurrence.end > start));
  occurrences.length = 0;
  occurrences.push(...kept);
  occurrences.sort((left, right) => left.start - right.start || right.end - left.end);

  let cursor = 0;
  let outgoing = '';
  const hidden = new Map<string, HiddenDetail>();
  for (const occurrence of occurrences) {
    if (occurrence.start < cursor) continue;
    outgoing += text.slice(cursor, occurrence.start) + occurrence.placeholder;
    cursor = occurrence.end;
    if (!hidden.has(occurrence.placeholder)) hidden.set(occurrence.placeholder, { placeholder: occurrence.placeholder, value: occurrence.value });
  }
  outgoing += text.slice(cursor);
  return { outgoing, hidden: [...hidden.values()], vault: { byKey, byPlaceholder, counts, allow: vault.allow } };
}

/** Swaps placeholders back to real values for display on this device. Unknown placeholders are left as they are. */
export function unmask(text: string, vault: Vault): string {
  return text.replace(PLACEHOLDER, (placeholder) => vault.byPlaceholder.get(placeholder) ?? placeholder);
}

export interface Segment {
  text: string;
  /** Set when this piece of the shown text was replaced by a placeholder on the wire. */
  placeholder?: string;
}

const SPLIT = /(\[[A-Z]+(?:-\d+)?\])/;

/**
 * Lines up the text shown on screen with the text that crossed the wire, so each hidden value can be highlighted
 * with the placeholder it was sent as. Returns null when the two cannot be matched unambiguously.
 */
export function alignHidden(shown: string, wire: string): Segment[] | null {
  if (shown === wire) return [{ text: shown }];
  const parts = wire.split(SPLIT);
  const segments: Segment[] = [];
  let position = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    if (index % 2 === 0) {
      if (!shown.startsWith(part, position)) return null;
      if (part) segments.push({ text: part });
      position += part.length;
      continue;
    }
    const next = parts[index + 1] ?? '';
    let end: number;
    if (next) {
      end = shown.indexOf(next, position);
    } else if (index + 1 >= parts.length - 1) {
      end = shown.length;
    } else {
      return null; // two placeholders back to back: the boundary between their values is unknown
    }
    if (end < 0) return null;
    const value = shown.slice(position, end);
    segments.push(value ? { text: value, placeholder: part } : { text: part });
    position = end;
  }
  return position === shown.length ? segments : null;
}

/** Rebuilds the placeholder vault from saved messages, so Incognito keeps its mapping after a page refresh. */
export function vaultFromMessages(messages: ReadonlyArray<{ wire?: string; blocks: ReadonlyArray<{ type: string; text?: string }> }>, base: Vault = createVault()): Vault {
  const pairs: Array<[string, string]> = [];
  for (const message of messages) {
    const shown = message.blocks.find((block) => block.type === 'text')?.text;
    if (!message.wire || shown === undefined) continue;
    for (const segment of alignHidden(shown, message.wire) ?? []) {
      if (segment.placeholder) pairs.push([segment.placeholder, segment.text]);
    }
  }
  return seedVault(base, pairs);
}

/** Starts a vault that already hides everything the user asked to always hide. */
export function vaultWithHidden(values: readonly string[], base: Vault = createVault()): Vault {
  return values.reduce((vault, value) => hideValue(vault, value), base);
}
