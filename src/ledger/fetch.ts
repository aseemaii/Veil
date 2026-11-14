import { useEffect, useState } from 'react';

export interface LedgerEntry {
  id: string;
  at: string;
  method: string;
  host: string;
  path: string;
  purpose: string;
  requestBytes: number;
  status: number;
  carriesDocument: boolean;
}

type Listener = (entries: readonly LedgerEntry[]) => void;

const MAX_ENTRIES = 200;
const entries: LedgerEntry[] = [];
const listeners = new Set<Listener>();
let installed = false;

function notify() {
  const snapshot = entries.slice();
  for (const listener of listeners) listener(snapshot);
}

export function subscribeLedger(listener: Listener) {
  listeners.add(listener);
  listener(entries.slice());
  return () => {
    listeners.delete(listener);
  };
}

export function classify(method: string, host: string, path: string): { purpose: string; carriesDocument: boolean } {
  // Same-origin shared-key proxy (api/nearai.ts): /nearai/v1/* and /ohttp mirror cloud-api.near.ai.
  const sameOrigin = typeof window !== 'undefined' && host === window.location.host;
  if (sameOrigin && path.startsWith('/nearai/')) return classify(method, 'cloud-api.near.ai', path.slice('/nearai'.length));
  if (host === 'cloud-api.near.ai' || (sameOrigin && path === '/ohttp')) {
    if (path === '/ohttp') return { purpose: 'Encrypted message (OHTTP)', carriesDocument: method === 'POST' };
    if (path.includes('/attestation/')) return { purpose: 'Enclave evidence', carriesDocument: false };
    if (path.includes('/chat/completions')) return { purpose: 'Encrypted analysis', carriesDocument: method === 'POST' };
    if (path.includes('/signature/')) return { purpose: 'Response signature', carriesDocument: false };
    return { purpose: 'Model metadata', carriesDocument: false };
  }
  if (host === 'nras.attestation.nvidia.com') return { purpose: 'GPU evidence', carriesDocument: false };
  if (host === 'cloud.near.ai') return { purpose: 'Verifier collateral', carriesDocument: false };
  return { purpose: 'Wallet or other', carriesDocument: false };
}

async function measureBody(request: Request) {
  if (request.method === 'GET' || request.method === 'HEAD' || !request.body) return 0;
  try {
    return (await request.arrayBuffer()).byteLength;
  } catch {
    return 0;
  }
}

/** Wraps globalThis.fetch once so every request the page makes is recorded (host, path, size, status; never bodies or queries). */
export function installLedger() {
  if (installed) return;
  installed = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const sizing = measureBody(request.clone());
    const url = new URL(request.url);
    const { purpose, carriesDocument } = classify(request.method, url.host, url.pathname);
    let status = 0;
    try {
      const response = await nativeFetch(request);
      status = response.status;
      return response;
    } finally {
      const requestBytes = await sizing;
      entries.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        method: request.method,
        host: url.host,
        path: url.pathname,
        purpose,
        requestBytes,
        status,
        carriesDocument,
      });
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      notify();
    }
  };
}

export function useLedger() {
  const [snapshot, setSnapshot] = useState<readonly LedgerEntry[]>([]);
  useEffect(() => subscribeLedger(setSnapshot), []);
  return snapshot;
}
