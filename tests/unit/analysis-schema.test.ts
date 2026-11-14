import { describe, expect, it } from 'vitest';
import { matchQuote } from '../../src/analyze/quotes';
import { extractJson, parseReport } from '../../src/analyze/schema';

describe('matchQuote', () => {
  const outgoing = 'The Landlord may enter the premises\nat any time, with or without notice.\nTenant’s duty';

  it('matches exact text after whitespace and quote normalisation', () => {
    expect(matchQuote('may enter the premises at any time', outgoing)).toBe(true);
    expect(matchQuote("Tenant's duty", outgoing)).toBe(true);
  });

  it('does not match altered, fuzzy or empty quotes', () => {
    expect(matchQuote('may enter the premises at any time without notice', outgoing)).toBe(false);
    expect(matchQuote('the Landlord may NOT enter', outgoing)).toBe(false);
    expect(matchQuote('   ', outgoing)).toBe(false);
  });
});

describe('parseReport', () => {
  const valid = {
    summary: 'A lease.',
    keyTerms: [{ term: 'rent', label: 'Rent', value: 'INR 32,000' }, { term: 'weird', label: 'Other', value: 'x' }],
    riskyClauses: [{ severity: 'high', title: 'Entry', quote: 'at any time', why: 'No notice.', askLandlord: 'Can entry need notice?' }],
    missingOrUnusual: [],
    datesAndObligations: [{ who: 'tenant', what: 'Pay rent', when: 'the 5th' }],
  };

  it('accepts JSON in a fence, fills ids and forces the legal notice flag', () => {
    const result = parseReport(`Here you go:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.riskyClauses[0]?.id).toBe('clause-1');
    expect(result.report.keyTerms[1]?.term).toBe('other');
    expect(result.report.notLegalAdvice).toBe(true);
  });

  it('rejects invalid JSON and schema violations with a short reason', () => {
    expect(parseReport('nope')).toEqual({ ok: false, error: 'the reply was not valid JSON' });
    const bad = parseReport(JSON.stringify({ ...valid, riskyClauses: [{ ...valid.riskyClauses[0], severity: 'extreme' }] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('riskyClauses');
  });

  it('extracts the outermost object', () => {
    expect(extractJson('x {"a":{"b":1}} y')).toBe('{"a":{"b":1}}');
  });
});
