// Pass-through to cloud-api.near.ai for the free shared key. vercel.json rewrites /nearai/* and /ohttp here.
// The browser verifies the enclave and encrypts end to end (OHTTP), so this function forwards ciphertext only.
// It accepts requests from this site's own pages, adds the server-side NEARAI_API_KEY, and never logs or stores a body.
// No wallet signature is needed; the spend limit on the key is the hard cap.
import { apiKey, json } from './_lib/http.js';
import { clientIp, createRateLimiter, fromOwnPage, upstreamPath } from './_lib/routes.js';

const UPSTREAM = 'https://cloud-api.near.ai';
// One chat message is about 4 to 6 requests (evidence, message, signature), so this allows steady use and stops floods.
const allow = createRateLimiter(300, 10 * 60_000);

const DROP_REQUEST = new Set(['host', 'cookie', 'authorization', 'connection', 'content-length', 'accept-encoding', 'origin', 'referer']);
const DROP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie']);

async function handle(request: Request): Promise<Response> {
  const key = apiKey();
  if (!key) return json(503, { error: { code: 'not_configured', message: 'The free shared key is not configured for this deployment.' } });
  if (!fromOwnPage(request.headers)) return json(403, { error: { code: 'forbidden', message: 'Use Fineprint in the browser.' } });
  if (!allow(clientIp(request.headers))) return json(429, { error: { code: 'rate_limited', message: 'Too many requests. Wait a few minutes.' } });

  const incoming = new URL(request.url);
  const target = upstreamPath(request.method, incoming.searchParams.get('path') ?? '');
  if (!target) return json(404, { error: { code: 'not_found', message: 'Not found.' } });

  const url = new URL(target, UPSTREAM);
  for (const [name, value] of incoming.searchParams) if (name !== 'path') url.searchParams.append(name, value);

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (DROP_REQUEST.has(lower) || lower.startsWith('sec-') || lower.startsWith('x-forwarded-') || lower.startsWith('x-vercel-') || lower.startsWith('x-real-ip')) continue;
    headers.set(lower, value);
  }
  headers.set('authorization', `Bearer ${key}`);

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
    redirect: 'error',
    signal: request.signal,
  });

  const out = new Headers();
  for (const [name, value] of upstream.headers) if (!DROP_RESPONSE.has(name.toLowerCase())) out.set(name, value);
  out.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

async function safe(request: Request) {
  try {
    return await handle(request);
  } catch {
    return json(502, { error: { code: 'upstream_failed', message: "Couldn't reach NEAR AI. Try again." } });
  }
}

export const GET = safe;
export const POST = safe;
