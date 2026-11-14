import type { WalletUnlock } from './crypto';

const READY = 'fineprint:ready';
const HISTORY = 'fineprint:history';

export interface Handoff {
  fileText: string;
  unlock: WalletUnlock;
}

function isUnlock(value: unknown): value is WalletUnlock {
  const candidate = value as Partial<Record<keyof WalletUnlock, unknown>> | null;
  return !!candidate && ['accountId', 'publicKey', 'signature', 'walletId', 'walletName'].every((key) => typeof candidate[key as keyof WalletUnlock] === 'string');
}

/** Opener side: hands the encrypted file and the in-memory unlock to the viewer tab we opened, same origin only. */
export function serveHistoryTab(tab: Window, payload: () => Promise<Handoff>, timeoutMs = 60_000) {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== tab || event.origin !== window.location.origin) return;
    if ((event.data as { type?: unknown } | null)?.type !== READY) return;
    cleanup();
    void payload().then((value) => tab.postMessage({ type: HISTORY, ...value }, window.location.origin));
  };
  const timer = setTimeout(() => cleanup(), timeoutMs);
  function cleanup() {
    window.removeEventListener('message', onMessage);
    clearTimeout(timer);
  }
  window.addEventListener('message', onMessage);
  return cleanup;
}

/** Viewer side: asks the opener for the file; resolves null when there is no opener or it does not answer. */
export function awaitHistoryHandoff(timeoutMs = 4000): Promise<Handoff | null> {
  return new Promise((resolve) => {
    const opener = window.opener as Window | null;
    if (!opener) {
      resolve(null);
      return;
    }
    const ask = () => opener.postMessage({ type: READY }, window.location.origin);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== opener || event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; fileText?: unknown; unlock?: unknown } | null;
      if (data?.type !== HISTORY || typeof data.fileText !== 'string' || !isUnlock(data.unlock)) return;
      finish({ fileText: data.fileText, unlock: data.unlock });
    };
    const interval = setInterval(ask, 400);
    const timer = setTimeout(() => finish(null), timeoutMs);
    function finish(value: Handoff | null) {
      clearInterval(interval);
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(value);
    }
    window.addEventListener('message', onMessage);
    ask();
  });
}
