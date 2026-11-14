import { describe, expect, it } from 'vitest';
import { type AnalysisTransport, analyze, type SignedCompletion } from '../../src/analyze/client';
import { parseSavedSession } from '../../src/history/session';
import { classify } from '../../src/ledger/fetch';
import { buildReceipt, verificationCenterUrl } from '../../src/receipt/receipt';
import { parseSettings, DEFAULT_SETTINGS } from '../../src/chat/settings';
import { checkBaseUrl } from '../../src/providers/custom';

const reportJson = JSON.stringify({
  summary: 'Lease for [ADDRESS-1].',
  keyTerms: [],
  riskyClauses: [{ severity: 'high', title: 'Entry', quote: 'at any time', why: 'x', askLandlord: 'y' }],
  missingOrUnusual: [],
  datesAndObligations: [],
});

const signed: SignedCompletion = {
  signatureKind: 'provider_tee',
  signingAlgo: 'ed25519',
  signingAddress: '0xsigner',
  signedText: 'model:req:res',
  signature: 'sig',
  tcbStatus: 'UpToDate',
  advisoryIds: [],
  composeHash: 'compose',
  osImageHash: 'os',
  nonce: 'n'.repeat(64),
};

function transport(replies: string[], verify: () => Promise<SignedCompletion>): AnalysisTransport & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() { return state.calls; },
    async complete() {
      const text = replies[state.calls] ?? '';
      state.calls += 1;
      return { id: `chat-${state.calls}`, text };
    },
    verifyResponse: verify,
  };
}

const base = { outgoing: 'The Landlord may enter at any time.', model: 'z-ai/glm-5.3-flash', signal: new AbortController().signal, wait: async () => undefined };

describe('analyze', () => {
  it('returns a signed report', async () => {
    const result = await analyze({ ...base, transport: transport([reportJson], async () => signed) });
    expect(result.signatureStatus).toBe('provider_tee');
    expect(result.report.riskyClauses).toHaveLength(1);
  });

  it('repairs invalid JSON once, then gives up with the raw reply kept', async () => {
    const repaired = transport(['not json', reportJson], async () => signed);
    expect((await analyze({ ...base, transport: repaired })).report.summary).toContain('Lease');
    expect(repaired.calls).toBe(2);
    const failing = transport(['nope', 'still nope'], async () => signed);
    await expect(analyze({ ...base, transport: failing })).rejects.toMatchObject({ name: 'AnalysisError', raw: 'still nope' });
    expect(failing.calls).toBe(2);
  });

  it('marks a gateway signature as gateway only', async () => {
    const result = await analyze({ ...base, transport: transport([reportJson], async () => ({ ...signed, signatureKind: 'gateway' })) });
    expect(result.signatureStatus).toBe('gateway');
  });

  it('retries the signature three times, then reports unsigned', async () => {
    let attempts = 0;
    const result = await analyze({ ...base, transport: transport([reportJson], async () => { attempts += 1; throw new Error('404'); }) });
    expect(attempts).toBe(3);
    expect(result.signatureStatus).toBe('unsigned');
    expect(result.signed).toBeUndefined();
  });
});

describe('receipt', () => {
  it('holds hashes only and never document text, names or keys', async () => {
    const outgoing = 'Rent for [LANDLORD] CANARY_TEXT';
    const outcome = await analyze({ ...base, outgoing, transport: transport([reportJson], async () => signed) });
    const receipt = await buildReceipt({ completionId: outcome.completionId, model: outcome.model, signed, outgoing, report: outcome.report, verifiedAt: '2026-11-11T14:02:00.000Z' });
    const text = JSON.stringify(receipt);
    for (const secret of ['CANARY_TEXT', '[LANDLORD]', 'Vikram', 'sk-test-key']) expect(text).not.toContain(secret);
    expect(receipt.app.outgoingTextSha256).toMatch(/^[0-9a-f]{64}$/);
    const url = verificationCenterUrl(receipt);
    expect(url.startsWith('https://cloud.near.ai/verify?model=')).toBe(true);
    expect(url).toContain('#receipt=');
    expect(url).not.toContain('CANARY_TEXT');
  });
});

describe('settings', () => {
  it('persists only known fields, rejects models outside the allowlist and unsafe provider URLs', () => {
    const parsed = parseSettings(JSON.stringify({ model: 'evil/model', strict: true, extra: 'x', apiKey: 'sk-secret', reduceMotion: 'yes' }));
    expect(parsed).toEqual({ ...DEFAULT_SETTINGS, strict: true });
    expect(JSON.stringify(parsed)).not.toContain('sk-secret');
    expect(parseSettings('{bad')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ model: 'Qwen/Qwen3.8-27B' })).model).toBe('Qwen/Qwen3.8-27B');
    expect(parseSettings(JSON.stringify({ provider: 'custom', customBaseUrl: 'http://evil.example/v1' })).customBaseUrl).toBe('');
    expect(parseSettings(JSON.stringify({ provider: 'custom', customBaseUrl: 'https://user:pw@api.example.com/v1' })).customBaseUrl).toBe('');
    expect(parseSettings(JSON.stringify({ provider: 'custom', customBaseUrl: 'http://localhost:11434/v1', customModel: 'llama3.1' }))).toMatchObject({ provider: 'custom', customBaseUrl: 'http://localhost:11434/v1' });
  });

  it('normalises provider URLs', () => {
    expect(checkBaseUrl('https://api.example.com/v1/')).toEqual({ ok: true, baseUrl: 'https://api.example.com/v1' });
    expect(checkBaseUrl('https://api.example.com/v1?key=1').ok).toBe(false);
    expect(checkBaseUrl('ftp://x.example').ok).toBe(false);
    expect(checkBaseUrl('not a url').ok).toBe(false);
  });
});

describe('restored sessions', () => {
  const session = {
    schemaVersion: 1,
    review: { phase: 'reviewing', name: 'a', text: 'hello world', proposals: [{ id: 'p', category: 'party', start: 0, end: 5, text: 'hello', source: 'rule', basis: 'pattern' }], accepted: ['p'], view: 'original' },
    messages: [],
  };

  it('accepts a valid session and rejects out-of-range or malformed ones', () => {
    expect(parseSavedSession(session)).not.toBeNull();
    const outOfRange = { ...session, review: { ...session.review, proposals: [{ ...session.review.proposals[0], end: 999 }] } };
    expect(parseSavedSession(outOfRange)).toBeNull();
    expect(parseSavedSession({ ...session, messages: [{ id: 'x', role: 'system', createdAt: '', blocks: [] }] })).toBeNull();
    expect(parseSavedSession('nope')).toBeNull();
  });
});

describe('ledger classification', () => {
  it('flags only the encrypted analysis POST as carrying the document', () => {
    expect(classify('POST', 'cloud-api.near.ai', '/v1/chat/completions').carriesDocument).toBe(true);
    expect(classify('GET', 'cloud-api.near.ai', '/v1/attestation/report').carriesDocument).toBe(false);
    expect(classify('GET', 'cloud-api.near.ai', '/v1/signature/abc').carriesDocument).toBe(false);
    expect(classify('POST', 'nras.attestation.nvidia.com', '/v3/attest/gpu').carriesDocument).toBe(false);
  });
});
