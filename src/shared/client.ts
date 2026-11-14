/**
 * The free shared key: a same-origin proxy (api/nearai.ts) adds the server-side NEAR AI key.
 * It only ever sees end-to-end encrypted traffic, and it needs no wallet signature.
 */
export function sharedBaseUrl() {
  return `${window.location.origin}/nearai/v1`;
}

/** On in production builds (Vercel serves /api). Locally, set VITE_SHARED_ANALYSIS=on when running `vercel dev`. */
export function sharedConfigured() {
  const flag = import.meta.env.VITE_SHARED_ANALYSIS?.trim().toLowerCase();
  return flag ? flag === 'on' : import.meta.env.PROD;
}
