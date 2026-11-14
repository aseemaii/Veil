import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportEncryptedFile, type WalletUnlock } from '../../src/history/crypto';
import { serveHistoryTab } from '../../src/history/handoff';
import { History } from '../../src/pages/History';

const unlock: WalletUnlock = { accountId: 'tenant.near', publicKey: 'ed25519:pk', signature: 'sig-secret', walletId: 'hot', walletName: 'HOT Wallet' };
const session = {
  schemaVersion: 1,
  review: { phase: 'approved', name: 'Sample lease', text: 'Landlord: Vikram Mehta pays rent.', proposals: [{ id: 'p1', category: 'party', start: 10, end: 23, text: 'Vikram Mehta', source: 'rule', basis: 'pattern' }], accepted: ['p1'], view: 'outgoing', fingerprint: 'abcd1234' },
  messages: [
    { id: 'm1', role: 'user', createdAt: '2026-11-11T10:00:00.000Z', blocks: [{ type: 'text', text: 'Loaded Sample lease for a private review.' }] },
    { id: 'm2', role: 'assistant', createdAt: '2026-11-11T10:00:01.000Z', blocks: [{ type: 'text', text: 'I found 1 details.' }] },
  ],
};

let container: HTMLDivElement;
let root: Root;

const auth = (withUnlock: boolean) => ({ unlock: withUnlock ? unlock : undefined, connecting: false, connect: vi.fn(async () => undefined), logout: async () => undefined });

async function render(withUnlock: boolean) {
  await act(async () => {
    root.render(<History auth={auth(withUnlock)} />);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Object.defineProperty(window, 'opener', { value: null, configurable: true });
  vi.restoreAllMocks();
});

describe('saved chat viewer', () => {
  it('receives the file and unlock from the tab that downloaded it and shows every chat, read only', async () => {
    const { blob } = await exportEncryptedFile(unlock, session);
    const fileText = await blob.text();
    const posted: unknown[] = [];
    const opener = { postMessage: vi.fn((message: unknown) => posted.push(message)) };
    Object.defineProperty(window, 'opener', { value: opener, configurable: true });
    await render(false);
    expect(container.textContent).toContain('Opening your encrypted file');
    expect(posted[0]).toEqual({ type: 'fineprint:ready' });

    const reply = new MessageEvent('message', { data: { type: 'fineprint:history', fileText, unlock }, origin: window.location.origin });
    Object.defineProperty(reply, 'source', { value: opener });
    await act(async () => {
      window.dispatchEvent(reply);
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(container.textContent).toContain('Sample lease');
    expect(container.textContent).toContain('Loaded Sample lease for a private review.');
    expect(container.textContent).toContain('I found 1 details.');
    expect(container.textContent).toContain('Read only');
    expect(container.textContent).toContain('[PARTY-1]');
    expect(container.textContent).not.toContain('Vikram Mehta');
  });

  it('ignores handoff messages from another origin or window', async () => {
    const opener = { postMessage: vi.fn() };
    Object.defineProperty(window, 'opener', { value: opener, configurable: true });
    await render(false);
    const forged = new MessageEvent('message', { data: { type: 'fineprint:history', fileText: 'x', unlock }, origin: 'https://evil.example' });
    Object.defineProperty(forged, 'source', { value: opener });
    const wrongSource = new MessageEvent('message', { data: { type: 'fineprint:history', fileText: 'x', unlock }, origin: window.location.origin });
    Object.defineProperty(wrongSource, 'source', { value: { postMessage: vi.fn() } });
    await act(async () => {
      window.dispatchEvent(forged);
      window.dispatchEvent(wrongSource);
    });
    expect(container.textContent).toContain('Opening your encrypted file');
  });

  it('offers a login and a file picker when opened directly, and refuses another wallet\'s file', async () => {
    vi.useFakeTimers();
    await render(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });
    vi.useRealTimers();
    expect(container.textContent).toContain('Open an encrypted file');
    expect(container.textContent).toContain('Log in with NEAR to open a file');

    await act(async () => root.render(<History auth={auth(true)} />));
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]');
    const { blob } = await exportEncryptedFile({ ...unlock, signature: 'someone-else' }, session);
    await act(async () => {
      Object.defineProperty(picker, 'files', { value: [new File([await blob.text()], 'x.fineprint')], configurable: true });
      picker?.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(container.textContent).toContain('cannot be unlocked by the connected wallet key');
  });
});

describe('serveHistoryTab', () => {
  it('answers only the tab it opened', async () => {
    const tab = { postMessage: vi.fn() } as unknown as Window;
    const stop = serveHistoryTab(tab, async () => ({ fileText: 'cipher', unlock }));
    const stranger = new MessageEvent('message', { data: { type: 'fineprint:ready' }, origin: window.location.origin });
    Object.defineProperty(stranger, 'source', { value: { postMessage: vi.fn() } });
    window.dispatchEvent(stranger);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(tab.postMessage).not.toHaveBeenCalled();

    const ready = new MessageEvent('message', { data: { type: 'fineprint:ready' }, origin: window.location.origin });
    Object.defineProperty(ready, 'source', { value: tab });
    window.dispatchEvent(ready);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(tab.postMessage).toHaveBeenCalledWith({ type: 'fineprint:history', fileText: 'cipher', unlock }, window.location.origin);
    stop();
  });
});
