import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientIp, createRateLimiter, fromOwnPage, upstreamPath } from '../../api/_lib/routes';

describe('proxy allowlist', () => {
  it('forwards only what one verified, encrypted analysis needs', () => {
    expect(upstreamPath('POST', 'ohttp')).toBe('/ohttp');
    expect(upstreamPath('POST', 'v1/chat/completions')).toBe('/v1/chat/completions');
    expect(upstreamPath('GET', 'v1/attestation/report')).toBe('/v1/attestation/report');
    expect(upstreamPath('GET', 'v1/model/z-ai/glm-5.3-flash')).toBe('/v1/model/z-ai%2Fglm-5.3-flash');
    expect(upstreamPath('GET', 'v1/model/z-ai%2Fglm-5.3-flash')).toBe('/v1/model/z-ai%2Fglm-5.3-flash');
    expect(upstreamPath('GET', 'v1/signature/chatcmpl-1')).toBe('/v1/signature/chatcmpl-1');
  });

  it('refuses everything else, including key management and path tricks', () => {
    for (const [method, path] of [
      ['GET', 'ohttp'],
      ['GET', 'v1/chat/completions'],
      ['POST', 'v1/workspaces/abc/api-keys'],
      ['GET', 'v1/users/me'],
      ['POST', 'v1/users/me/access-tokens'],
      ['GET', 'v1/signature/../users/me'],
      ['POST', 'v1/responses'],
      ['GET', ''],
    ] as const) {
      expect(upstreamPath(method, path)).toBeNull();
    }
  });
});

describe('own-page check', () => {
  const headers = (entries: Record<string, string>) => new Headers({ host: 'fineprint.vercel.app', ...entries });
  it('accepts requests from this site in a browser', () => {
    expect(fromOwnPage(headers({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(fromOwnPage(headers({ 'sec-fetch-site': 'same-origin', origin: 'https://fineprint.vercel.app' }))).toBe(true);
    expect(fromOwnPage(headers({ origin: 'https://fineprint.vercel.app' }))).toBe(true);
  });

  it('refuses other sites and requests with no browser signals', () => {
    expect(fromOwnPage(headers({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }))).toBe(false);
    expect(fromOwnPage(headers({ origin: 'https://evil.example' }))).toBe(false);
    expect(fromOwnPage(headers({ 'sec-fetch-site': 'same-site' }))).toBe(false);
    expect(fromOwnPage(headers({}))).toBe(false);
    expect(fromOwnPage(headers({ origin: 'not a url' }))).toBe(false);
  });
});

describe('rate limiter', () => {
  it('allows up to the limit per window and per key', () => {
    const allow = createRateLimiter(2, 1000);
    expect([allow('a', 0), allow('a', 1), allow('a', 2), allow('b', 2)]).toEqual([true, true, false, true]);
    expect(allow('a', 2000)).toBe(true);
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
  });
});

describe('proxy handler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('needs no wallet signature, refuses other sites, swaps in the server key, and forwards only allowed paths', async () => {
    vi.stubEnv('NEARAI_API_KEY', 'sk-server-secret');
    const { POST, GET } = await import('../../api/nearai');
    const seen: Request[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: URL, init: RequestInit) => {
      seen.push(new Request(input, init));
      return new Response('ciphertext', { status: 200, headers: { 'content-type': 'message/ohttp-chunked-res', 'set-cookie': 'x=1' } });
    }));
    const own = { host: 'fineprint.test', 'sec-fetch-site': 'same-origin', origin: 'https://fineprint.test' };
    const call = (path: string, headers: Record<string, string>) =>
      POST(new Request(`https://fineprint.test/api/nearai?path=${encodeURIComponent(path)}`, { method: 'POST', headers, body: 'sealed' }));

    expect((await call('ohttp', { host: 'fineprint.test', 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('ohttp', { host: 'fineprint.test' })).status).toBe(403);
    expect((await call('v1/workspaces/w/api-keys', own)).status).toBe(404);
    expect(seen).toHaveLength(0);

    const response = await call('ohttp', { ...own, authorization: 'Bearer client-value', cookie: 'c=1' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ciphertext');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(seen[0]?.url).toBe('https://cloud-api.near.ai/ohttp');
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer sk-server-secret');
    for (const header of ['cookie', 'origin', 'sec-fetch-site']) expect(seen[0]?.headers.get(header)).toBeNull();

    await GET(new Request('https://fineprint.test/api/nearai?path=v1/attestation/report&model=z-ai%2Fglm&nonce=ab', { headers: { host: 'fineprint.test', 'sec-fetch-site': 'same-origin' } }));
    expect(seen[1]?.url).toBe('https://cloud-api.near.ai/v1/attestation/report?model=z-ai%2Fglm&nonce=ab');
  });
});
