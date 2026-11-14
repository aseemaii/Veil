export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** The shared NEAR AI key. Server-side only: it is never sent to the browser. */
export function apiKey(): string | undefined {
  return process.env.NEARAI_API_KEY?.trim() || undefined;
}
