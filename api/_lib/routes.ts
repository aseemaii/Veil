// Request rules for the shared-key proxy. WebCrypto-free and fetch-free, so Vitest can run them directly.

/**
 * Maps a proxied path to its NEAR AI path. Only what the SDK needs for one verified, encrypted analysis is allowed:
 * the OHTTP relay, attestation evidence, model metadata, response signatures and the encrypted chat endpoint.
 */
export function upstreamPath(method: string, path: string): string | null {
  const clean = path.replace(/^\/+/, '');
  if (method === 'POST' && clean === 'ohttp') return '/ohttp';
  if (method === 'POST' && clean === 'v1/chat/completions') return '/v1/chat/completions';
  if (method === 'GET' && clean === 'v1/attestation/report') return '/v1/attestation/report';
  const model = clean.match(/^v1\/model\/(.+)$/);
  if (method === 'GET' && model?.[1]) return `/v1/model/${encodeURIComponent(decodeURIComponent(model[1]))}`;
  const signature = clean.match(/^v1\/signature\/([A-Za-z0-9._:-]{1,200})$/);
  if (method === 'GET' && signature?.[1]) return `/v1/signature/${signature[1]}`;
  return null;
}

/**
 * Browser-only gate: the request must come from this site's own pages. Browsers set Sec-Fetch-Site and Origin
 * themselves and pages cannot forge them, so other websites cannot spend the shared key from a visitor's browser.
 * Scripts outside a browser can fake headers; the spend limit on the NEAR AI key is the hard cap.
 */
export function fromOwnPage(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  const origin = headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return site === 'same-origin';
}

/** Best-effort per-IP limit, kept in this function instance's memory (no database). */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; start: number }>();
  return (key: string, now = Date.now()): boolean => {
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      if (hits.size > 5_000) hits.clear();
      hits.set(key, { count: 1, start: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
}
