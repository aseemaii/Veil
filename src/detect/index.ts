import { passesIban, passesLuhn, passesVerhoeff } from './checksums';
import type { Category, Proposal } from './types';

interface Candidate extends Omit<Proposal, 'id'> {
  priority: number;
}

function stableId(candidate: Omit<Candidate, 'priority'>): string {
  const input = `${candidate.category}:${candidate.text.toLocaleLowerCase().replace(/\s+/g, ' ').trim()}`;
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${candidate.category}-${(hash >>> 0).toString(36)}`;
}

function addMatches(
  target: Candidate[],
  text: string,
  expression: RegExp,
  category: Category,
  basis: Proposal['basis'],
  priority: number,
  validate: (value: string) => boolean = () => true,
) {
  for (const match of text.matchAll(expression)) {
    if (match.index === undefined || !validate(match[0])) continue;
    target.push({
      category,
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      source: 'rule',
      basis,
      priority,
    });
  }
}

const NAME_STOPWORDS = new Set([
  'page', 'code', 'diagram', 'link', 'summary', 'introduction', 'conclusion', 'abstract', 'agreement', 'lease', 'rental', 'residential',
  'rent', 'deposit', 'security', 'term', 'terms', 'renewal', 'notice', 'notices', 'tenant', 'landlord', 'property', 'premises', 'utilities',
  'repairs', 'entry', 'liability', 'disputes', 'use', 'late', 'fees', 'lock', 'in', 'termination', 'signature', 'signed', 'date', 'table',
  'contents', 'chapter', 'section', 'figure', 'references', 'appendix', 'project', 'report', 'assignment', 'name', 'and', 'of', 'the', 'for',
  'with', 'to', 'a', 'an', 'on', 'at', 'by', 'conditions', 'policy', 'schedule', 'annexure', 'exhibit', 'witness', 'parties', 'party', 'sample',
]);

/** IBANs are uppercase; a match can run into the next words, so shorten it a group at a time until the checksum passes. */
function addIbans(target: Candidate[], text: string) {
  for (const match of text.matchAll(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/gu)) {
    if (match.index === undefined) continue;
    let value = match[0];
    while (value.replace(/\s/g, '').length >= 15 && !passesIban(value)) {
      const cut = value.search(/\s\S+$/);
      if (cut < 0) break;
      value = value.slice(0, cut);
    }
    if (!passesIban(value)) continue;
    target.push({ category: 'iban', start: match.index, end: match.index + value.length, text: value, source: 'rule', basis: 'checksum', priority: 100 });
  }
}

export function detect(text: string): Proposal[] {
  const candidates: Candidate[] = [];
  addIbans(candidates, text);
  addMatches(candidates, text, /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, 'card', 'checksum', 95, passesLuhn);
  addMatches(candidates, text, /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/g, 'gov_id', 'checksum', 95, passesVerhoeff);
  addMatches(candidates, text, /\b[A-Z]{5}\d{4}[A-Z]\b/g, 'gov_id', 'pattern', 90);
  addMatches(candidates, text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, 'email', 'pattern', 85);
  addMatches(candidates, text, /(?<![\d\w])(?:\+?\d{1,3}[ -]?)?(?:\d[ -]?){9,11}(?!\d)/g, 'phone', 'pattern', 50,
    (value) => value.replace(/\D/g, '').length >= 10 && value.replace(/\D/g, '').length <= 12);
  // PDF text extraction can turn "tt" into "<", so accept h<ps:// as well.
  // A URL wrapped onto the next line leaves a short digit-bearing tail, which must be masked with it.
  addMatches(candidates, text, /(?:\bh[t<]{1,2}ps?:\/\/|\bwww\.)[^\s<>"')\]]+(?:\r?\n[\w./~%-]{0,19}\d[\w./~%-]{0,19}(?=\r?\n|$))?/gi, 'other', 'pattern', 70);
  // Plain 6 to 11 digit numbers: student, account, reference and PIN codes. Amounts after a currency marker are left alone (DET-8).
  addMatches(candidates, text, /(?<!(?:INR|USD|EUR|GBP|Rs\.?|[$€£₹])\s?)(?<![\d.,])\d{6,11}(?![\d,.]\d)(?!\d)/g, 'account', 'pattern', 40);
  for (const match of text.matchAll(/^[ \t]*(?:(?:Student|Candidate|Applicant|Employee|Full|Patient|Customer|Client)[ \t]+)?(?:Name|Signed[ \t]+by|Submitted[ \t]+by|Prepared[ \t]+by)[ \t]*[:\-][ \t]*([^\n]{2,60})$/gim)) {
    if (match.index === undefined || !match[1]) continue;
    const start = match.index + match[0].lastIndexOf(match[1]);
    candidates.push({ category: 'party', start, end: start + match[1].trimEnd().length, text: match[1].trimEnd(), source: 'party', basis: 'user', priority: 80 });
  }
  for (const match of text.matchAll(/\b(?:Reg(?:istration)?\.?|Roll|Student|Employee|Account|Customer|Passport|Licen[cs]e|ID)[ \t]*(?:No\.?|Number|ID|#)?[ \t]*[:#\-][ \t]*([A-Z0-9][A-Z0-9-]{3,})/gi)) {
    if (match.index === undefined || !match[1]) continue;
    const start = match.index + match[0].lastIndexOf(match[1]);
    candidates.push({ category: 'account', start, end: start + match[1].length, text: match[1], source: 'rule', basis: 'pattern', priority: 60 });
  }
  // A short line made only of 2 to 4 capitalised words (or initials) is very likely a person's name.
  for (const match of text.matchAll(/^[ \t\u00a0]*((?:[A-Z][a-z'’-]{1,}|[A-Z]\.?)(?:[ \t\u00a0]+(?:[A-Z][a-z'’-]{1,}|[A-Z]\.?)){1,3})[ \t\u00a0]*$/gm)) {
    if (match.index === undefined || !match[1]) continue;
    const words = match[1].toLocaleLowerCase().split(/[ \t\u00a0]+/);
    if (words.some((word) => NAME_STOPWORDS.has(word.replace(/\.$/, '')))) continue;
    if (words.filter((word) => word.length > 2).length < 1) continue;
    const start = match.index + match[0].indexOf(match[1]);
    candidates.push({ category: 'party', start, end: start + match[1].length, text: match[1], source: 'rule', basis: 'pattern', priority: 45 });
  }

  for (const match of text.matchAll(/^(Landlord|Lessor|Tenant|Lessee)[ \t]*:[ \t]*([A-Z][A-Za-z'.-]+(?:[ \t]+[A-Z][A-Za-z'.-]+){1,3})/gm)) {
    if (match.index === undefined || !match[2]) continue;
    const start = match.index + match[0].lastIndexOf(match[2]);
    const role = match[1]?.toLocaleLowerCase();
    candidates.push({
      category: 'party',
      start,
      end: start + match[2].length,
      text: match[2],
      source: 'party',
      basis: 'user',
      placeholderHint: role === 'landlord' || role === 'lessor' ? 'LANDLORD' : 'TENANT',
      priority: 80,
    });
  }

  for (const match of text.matchAll(/^(?:Property|Premises|Address)\s*:\s*(.+)$/gm)) {
    if (match.index === undefined || !match[1]) continue;
    const start = match.index + match[0].lastIndexOf(match[1]);
    candidates.push({
      category: 'address',
      start,
      end: start + match[1].length,
      text: match[1],
      source: 'party',
      basis: 'user',
      priority: 80,
    });
  }

  const accepted: Candidate[] = [];
  for (const candidate of candidates.sort((left, right) => right.priority - left.priority || left.start - right.start)) {
    const overlaps = accepted.some((entry) => candidate.start < entry.end && candidate.end > entry.start);
    const duplicate = accepted.some((entry) =>
      entry.category === candidate.category && entry.text.toLocaleLowerCase() === candidate.text.toLocaleLowerCase());
    if (!overlaps && !duplicate) accepted.push(candidate);
  }

  return accepted
    .sort((left, right) => left.start - right.start)
    .map(({ priority: _priority, ...candidate }) => ({ ...candidate, id: stableId(candidate) }));
}

export type { Proposal } from './types';
