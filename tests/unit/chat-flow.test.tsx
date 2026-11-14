import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisTransport, SignedCompletion } from '../../src/analyze/client';
import { exportEncryptedFile, importEncryptedFile, type WalletUnlock } from '../../src/history/crypto';
import { parseHistory } from '../../src/history/session';

const reportJson = JSON.stringify({
  summary: 'Lease between [LANDLORD] and [TENANT].',
  keyTerms: [{ term: 'rent', label: 'Rent', value: 'INR 32,000' }],
  riskyClauses: [
    { severity: 'high', title: 'Entry', quote: 'at any time, with or without notice', why: 'No notice needed.', askLandlord: 'Can entry require 24 hours notice?' },
    { severity: 'low', title: 'Invented', quote: 'this sentence is not in the lease', why: 'x', askLandlord: 'y' },
  ],
  missingOrUnusual: [],
  datesAndObligations: [],
});

const signed: SignedCompletion = {
  signatureKind: 'provider_tee',
  signingAlgo: 'ed25519',
  signingAddress: '0xsignersignersigner',
  signedText: 'm:a:b',
  signature: 'sig',
  tcbStatus: 'UpToDate',
  advisoryIds: [],
  composeHash: 'compose',
  osImageHash: 'os',
  nonce: 'f'.repeat(64),
};

const fakeTransport: AnalysisTransport = {
  complete: vi.fn(async () => ({ id: 'chatcmpl-test-1', text: reportJson })),
  verifyResponse: vi.fn(async () => signed),
};

vi.mock('../../src/gate/gate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/gate/gate')>();
  return {
    ...actual,
    runGate: vi.fn(async () => ({
      status: 'verified' as const,
      rows: actual.GATE_ROWS.map((row) => ({ ...row, state: 'passed' as const })),
      summary: {
        model: 'z-ai/glm-5.3-flash',
        verifiedAt: '2026-11-11T14:02:00.000Z',
        gatewayTcb: 'UpToDate',
        modelTcb: 'UpToDate',
        advisoryIds: [],
        signingAddress: '0xsignersignersigner',
        composeHash: 'compose',
        osImageHash: 'os',
        nonce: 'f'.repeat(64),
        candidates: 1,
      },
    })),
  };
});

// jsdom has no Web Worker; read text files directly in tests.
vi.mock('../../src/intake/parse', () => ({ parseDocument: async (file: File) => ({ text: await file.text(), pages: 1 }) }));

vi.mock('../../src/analyze/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analyze/client')>();
  return { ...actual, createSdkTransport: vi.fn(async () => fakeTransport) };
});

vi.mock('../../src/shared/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/client')>();
  return { ...actual, sharedConfigured: () => true };
});

const { createSdkTransport } = await import('../../src/analyze/client');
const { Chat } = await import('../../src/pages/Chat');

const unlock: WalletUnlock = { accountId: 'tenant.near', publicKey: 'ed25519:pk', signature: 'sig-secret', walletId: 'hot', walletName: 'HOT Wallet' };
const API_KEY_CANARY = 'sk-canary-key-123';

let container: HTMLDivElement;
let root: Root;
let logout: ReturnType<typeof vi.fn<() => Promise<void>>>;

async function flush(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function button(label: string | RegExp) {
  const match = [...container.querySelectorAll('button, a, summary')].find((element) => (typeof label === 'string' ? element.textContent?.includes(label) : label.test(element.textContent ?? '')));
  if (!match) throw new Error(`No control labelled ${String(label)}`);
  return match as HTMLElement;
}

async function click(label: string | RegExp) {
  await act(async () => {
    button(label).click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function typeInto(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`No input ${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function typeArea(value: string) {
  const area = container.querySelector<HTMLTextAreaElement>('#chat-input');
  if (!area) throw new Error('No chat input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  logout = vi.fn(async () => undefined);
  await act(async () => {
    root.render(<Chat auth={{ unlock, connecting: false, connect: async () => undefined, logout }} unlock={unlock} />);
  });
  await flush();
}

function captureDownload() {
  const captured: { blob?: Blob } = {};
  URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
    captured.blob = blob as Blob;
    return 'blob:test';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return captured;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function reachVerified() {
  await click('Use the sample lease');
  // Approving checks the enclave automatically, reusing the verification started when the chat opened.
  await click('Approve this text');
  await flush();
}

describe('chat workspace', () => {
  it('runs the full flow with the user\'s own key: review, approve, verify, analyze, report, encrypted download in a new tab, logout', async () => {
    await mount();
    expect(Chat).toBeTypeOf('function');
    expect(container.textContent).toContain('Drop a lease');
    expect(container.querySelector('.composer-note button')?.getAttribute('title')).toBe('No request has carried your document yet.');
    // Everything except the conversation is folded away.
    expect(container.querySelector('.drawer')).toBeNull();

    await click('Use the sample lease');
    expect(container.textContent).toContain('Review what will leave');
    expect(container.textContent).toMatch(/\d+ details will be masked/);
    expect(container.textContent).not.toContain('Send with my key');
    await click('Approve this text');
    await flush();
    expect(container.textContent).toContain('Approved. This text is locked.');
    expect(container.textContent).toContain('Enclave verified at');
    expect(container.textContent).toContain('8 of 8 enclave checks passed');

    await typeInto('#api-key', API_KEY_CANARY);
    expect(container.querySelector<HTMLInputElement>('#api-key')?.type).toBe('password');
    await click('Send with my key');
    await flush();

    expect(createSdkTransport).toHaveBeenCalledWith({ kind: 'own', apiKey: API_KEY_CANARY }, false);
    const sent = vi.mocked(fakeTransport.complete).mock.calls[0]?.[0].map((message) => message.content).join('\n') ?? '';
    for (const secret of ['Vikram Mehta', 'Ananya Rao', 'vikram.mehta@example.com', '4532 0151 1283 0366']) expect(sent).not.toContain(secret);
    expect(sent).toContain('[LANDLORD]');

    expect(container.textContent).toContain('Lease report');
    expect(container.textContent).toContain('Signed by the model');
    expect(container.textContent).toContain('Not legal advice. The model can be wrong.');
    expect(container.textContent).toContain('Not found in the text we sent.');
    expect(container.querySelectorAll('.clause').length).toBe(2);
    expect(container.querySelectorAll('blockquote.unmatched').length).toBe(1);

    expect(container.textContent).not.toContain('Vikram Mehta');
    await click('Show names');
    expect(container.textContent).toContain('Vikram Mehta');
    expect(JSON.stringify({ ...localStorage })).not.toContain('canary');

    // Download: the file is wallet-locked, holds no plaintext, and a viewer tab is opened for it.
    const captured = captureDownload();
    const tab = { postMessage: vi.fn(), close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(tab);
    await click('Details');
    await click('Download all chats (encrypted)');
    await flush();
    expect(open).toHaveBeenCalledWith('/history', '_blank');
    expect(captured.blob).toBeDefined();
    const fileText = (await captured.blob?.text()) ?? '';
    for (const secret of ['Vikram', 'Ananya', API_KEY_CANARY, 'Lotus Court']) expect(fileText).not.toContain(secret);
    const bundle = parseHistory((await importEncryptedFile<unknown>(unlock, fileText)).payload);
    expect(bundle?.schemaVersion).toBe(2);
    expect(bundle?.chats[0]?.session.analysis?.report.riskyClauses).toHaveLength(2);
    await expect(importEncryptedFile({ ...unlock, signature: 'another-wallet' }, fileText)).rejects.toThrow('cannot be unlocked');
    await click('Close');

    // Changing the mask list discards approval, verification and the report.
    await click('Original');
    const highlight = container.querySelector<HTMLButtonElement>('button.hl');
    await act(async () => highlight?.click());
    await flush();
    expect(container.textContent).toContain('Approval cleared');
    expect(container.textContent).toContain('Approve this text');
    expect(container.textContent).not.toContain('Send with my key');
    expect([...container.querySelectorAll('.view-tabs button')].some((tab) => tab.textContent === 'Report')).toBe(false);

    await click('Log out');
    expect(logout).toHaveBeenCalled();
  });

  it('sends with one click on the shared key, with no extra wallet signature', async () => {
    await mount();
    await reachVerified();
    expect(container.textContent).not.toContain('shared key');
    expect(container.textContent).toContain('only passes on ciphertext');

    await click('Send for analysis');
    await flush();
    // No session proof: the SDK gets the shared credential and the server adds its key at the proxy.
    expect(createSdkTransport).toHaveBeenCalledWith({ kind: 'shared' }, false);
    expect(container.textContent).toContain('Lease report');

    await click('Run the checks again');
    await flush();
    await click('Send for analysis');
    await flush();
    expect(createSdkTransport).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Lease report');
  });

  it('chats in Incognito: hides personal details before sending, streams the reply and shows real values only on screen', async () => {
    const seen: Array<Array<{ role: string; content: string }>> = [];
    const streaming: AnalysisTransport = {
      complete: vi.fn(async () => ({ id: 'unused', text: 'unused' })),
      stream: vi.fn(async (messages, _model, _signal, onText) => {
        seen.push(messages);
        onText('Hi [PERSON-1], I will');
        onText('Hi [PERSON-1], I will reply to [EMAIL-1].');
        return { id: 'chatcmpl-chat-1', text: 'Hi [PERSON-1], I will reply to [EMAIL-1].' };
      }),
      verifyResponse: vi.fn(async () => signed),
    };
    vi.mocked(createSdkTransport).mockResolvedValueOnce(streaming);
    await mount();
    expect(container.textContent).toContain('Hi tenant. Ask me anything');
    expect(container.querySelector('.mode-toggle button[aria-pressed="true"]')?.textContent).toContain('Incognito');
    expect(container.querySelector('.status')?.textContent).toContain('Enclave verified');
    expect(container.querySelector<HTMLAnchorElement>('.status a')?.href).toContain('https://cloud.near.ai/verify?model=');
    expect(container.querySelector('.status .dot--ok')).not.toBeNull();

    await typeArea('My name is Priya Sharma, write to priya.sharma@example.com');
    expect(container.querySelector('.mask-preview')?.textContent).toContain('[EMAIL-1]');
    await act(async () => container.querySelector<HTMLFormElement>('form.composer')?.requestSubmit());
    await flush();

    const wire = seen[0]?.map((message) => message.content).join('\n') ?? '';
    expect(wire).not.toContain('Priya');
    expect(wire).not.toContain('priya.sharma@example.com');
    expect(wire).toContain('[PERSON-1]');
    expect(wire).toContain('[EMAIL-1]');
    expect(seen[0]?.[0]?.content).toContain('Never try to guess, reconstruct or ask for a hidden value');
    // The shared key path: no wallet prompt and no key in the browser.
    expect(createSdkTransport).toHaveBeenCalledWith({ kind: 'shared' }, false);
    expect(container.textContent).toContain('Hi Priya Sharma, I will reply to priya.sharma@example.com.');
    expect(container.querySelector('.msg--user .msg-meta')?.textContent).toContain('2 hidden');
    // What was hidden is marked with the placeholder the model saw; the rest was sent as typed.
    const marks = [...container.querySelectorAll('.msg--user mark.hidden-detail')].map((mark) => mark.getAttribute('title'));
    expect(marks).toEqual(['Sent as [PERSON-1]', 'Sent as [EMAIL-1]']);
    await click('View as sent');
    expect(container.querySelector('.msg--user .msg-text--wire')?.textContent).toBe('My name is [PERSON-1], write to [EMAIL-1]');
    await click('Show mine');
    expect(container.querySelector('.msg--user .msg-meta')?.getAttribute('title')).toContain('[PERSON-1], [EMAIL-1]');
    const verifiedMeta = container.querySelector('.msg--assistant:last-of-type .msg-meta, .msg--assistant .msg-meta');
    expect(verifiedMeta?.textContent).toContain('Verified');
    expect(container.querySelector<HTMLAnchorElement>('.msg-meta a')?.href).toContain('https://cloud.near.ai/verify?model=');
  });

  it('lets the user hide something the rules missed and cancel a wrong hide, before sending', async () => {
    const seen: string[] = [];
    vi.mocked(createSdkTransport).mockResolvedValue({
      complete: vi.fn(async (messages) => {
        seen.push(messages.at(-1)?.content ?? '');
        return { id: 'chatcmpl-5', text: 'Okay.' };
      }),
    });
    await mount();
    await typeArea('Ask Rohit about Project Bluebird, mail rohit@example.com');
    expect(container.querySelector('.mask-preview')?.textContent).toContain('[EMAIL-1]');

    // A wrong hide: send the email as typed instead.
    await act(async () => container.querySelector<HTMLButtonElement>('.swap-x[aria-label="Don\'t hide rohit@example.com"]')?.click());
    expect(container.querySelector('.mask-preview')?.textContent).toContain('Sent as typed: rohit@example.com');
    expect(container.querySelector('.mask-preview')?.textContent).not.toContain('[EMAIL-1]');

    // Something missed: hide a project name by hand.
    await click('Hide other…');
    await typeInto('input[aria-label="Word or phrase to hide"]', 'Project Bluebird');
    await click(/^Hide$/);
    expect(container.querySelector('.mask-preview')?.textContent).toContain('[HIDDEN-1]');

    await act(async () => container.querySelector<HTMLFormElement>('form.composer')?.requestSubmit());
    await flush();
    // Rohit is caught by the name dictionary, the project name by hand, and the email is sent as typed by choice.
    expect(seen[0]).toBe('Ask [PERSON-1] about [HIDDEN-1], mail rohit@example.com');
    vi.mocked(createSdkTransport).mockImplementation(async () => fakeTransport);
  });

  it('remembers words hidden by hand for the wallet, and strict mode hides unusual names', async () => {
    vi.mocked(createSdkTransport).mockResolvedValue({ complete: vi.fn(async () => ({ id: 'chatcmpl-6', text: 'Okay.' })) });
    await mount();
    await typeArea('Status of Project Bluebird?');
    await click('Hide other…');
    await typeInto('input[aria-label="Word or phrase to hide"]', 'Project Bluebird');
    await click(/^Hide$/);
    await act(async () => container.querySelector<HTMLFormElement>('form.composer')?.requestSubmit());
    await flush(200);
    await click('+ New chat');
    await typeArea('Any update on project bluebird?');
    expect(container.querySelector('.mask-preview')?.textContent).toContain('[HIDDEN-1]');
    await click('Details');
    expect(container.textContent).toContain('Always hidden (1)');
    await click('Close');

    await typeArea('Meet at Zorblax Labs tomorrow');
    expect(container.querySelector('.mask-preview')?.textContent ?? '').not.toContain('Zorblax');
    await click('Strict off');
    expect(container.querySelector('.mask-preview')?.textContent).toContain('Zorblax Labs');
    vi.mocked(createSdkTransport).mockImplementation(async () => fakeTransport);
  });

  it('chats in Private mode: sends exactly what was typed, and answers about an approved document', async () => {
    const seen: Array<Array<{ role: string; content: string }>> = [];
    const transport: AnalysisTransport = {
      complete: vi.fn(async (messages) => {
        seen.push(messages);
        return { id: 'chatcmpl-chat-2', text: 'The rent is stated in the lease.' };
      }),
    };
    vi.mocked(createSdkTransport).mockResolvedValue(transport);
    await mount();
    await click(/^◈ Private$/);
    expect(container.querySelector('.mode-toggle button[aria-pressed="true"]')?.textContent).toContain('Private');
    await reachVerified();
    await typeArea('Email me at me@example.com: what is the rent?');
    expect(container.querySelector('.mask-preview')).toBeNull();
    await act(async () => container.querySelector<HTMLFormElement>('form.composer')?.requestSubmit());
    await flush();

    const [system, ...turns] = seen[0] ?? [];
    expect(turns.at(-1)?.content).toBe('Email me at me@example.com: what is the rent?');
    // The document goes as the approved masked text, never the original names.
    expect(system?.content).toContain('<document>');
    expect(system?.content).toContain('[LANDLORD]');
    expect(system?.content).not.toContain('Vikram Mehta');
    expect(container.textContent).toContain('The rent is stated in the lease.');
    expect(container.querySelector('.msg--user .msg-meta')).toBeNull();
    // After sending as typed, Incognito is locked until a new chat.
    const incognito = [...container.querySelectorAll<HTMLButtonElement>('.mode-toggle button')].find((button) => button.textContent?.includes('Incognito'));
    expect(incognito?.disabled).toBe(true);
    expect(incognito?.title).toContain('Start a new chat');
    await click('+ New chat');
    expect(container.querySelector<HTMLButtonElement>('.mode-toggle button')?.disabled).toBe(false);
    expect(container.textContent).not.toContain('The rent is stated in the lease.');
    vi.mocked(createSdkTransport).mockImplementation(async () => fakeTransport);
  });

  it('keeps the conversation after a refresh (encrypted for this tab) and restores the Incognito mapping', async () => {
    sessionStorage.clear();
    const transport: AnalysisTransport = { complete: vi.fn(async () => ({ id: 'chatcmpl-3', text: 'Noted, [PERSON-1].' })) };
    vi.mocked(createSdkTransport).mockResolvedValue(transport);
    await mount();
    await typeArea('My name is Priya Sharma');
    await act(async () => container.querySelector<HTMLFormElement>('form.composer')?.requestSubmit());
    await flush(500);
    const stored = sessionStorage.getItem('fineprint.tab-chat.v1') ?? '';
    expect(stored).not.toBe('');
    expect(stored).not.toContain('Priya');

    await act(async () => root.unmount());
    container.remove();
    await mount();
    await flush(100);
    const reply = container.querySelector('.msg--assistant:last-of-type mark.hidden-detail, .msg--assistant mark.hidden-detail');
    expect(reply?.firstChild?.textContent).toBe('Priya Sharma');
    expect(reply?.getAttribute('title')).toBe('Sent as [PERSON-1]');
    expect(container.querySelector('.msg--user mark.hidden-detail')?.firstChild?.textContent).toBe('Priya Sharma');
    vi.mocked(createSdkTransport).mockImplementation(async () => fakeTransport);
  });

  it('sends to another provider without a gate, with a warning, and labels the report unverified', async () => {
    localStorage.setItem('fineprint.settings', JSON.stringify({ provider: 'custom', customPreset: 'openai', customBaseUrl: 'https://api.example.com/v1', customModel: 'tiny-model' }));
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: 'cmpl-1', choices: [{ message: { content: reportJson } }] }), { status: 200 });
    });
    await mount();
    await click('Use the sample lease');
    await click('Approve this text');
    expect(container.textContent).not.toContain('Check the enclave');
    expect(container.textContent).toContain('This provider has no hardware privacy guarantee.');
    expect(container.querySelector<HTMLButtonElement>('.send-box .btn.primary')?.disabled).toBe(true);

    await typeInto('#provider-key', API_KEY_CANARY);
    const checkbox = container.querySelector<HTMLInputElement>('.send-box input[type="checkbox"]');
    await act(async () => checkbox?.click());
    await click('Send redacted text');
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.com/v1/chat/completions');
    const body = String(calls[0]?.init?.body);
    expect(body).toContain('tiny-model');
    for (const secret of ['Vikram Mehta', 'Ananya Rao', 'vikram.mehta@example.com']) expect(body).not.toContain(secret);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${API_KEY_CANARY}`);
    expect(container.textContent).toContain('does not sign responses');
    expect(createSdkTransport).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage })).not.toContain('canary');
  });

  it('keeps every chat and downloads them grouped, with the document, in one wallet-locked file', async () => {
    vi.mocked(createSdkTransport).mockResolvedValue({ complete: vi.fn(async () => ({ id: 'chatcmpl-4', text: 'Sure.' })) });
    await mount();
    // Chat 1: a document loaded from a file, so the original can be handed back.
    const fileInput = container.querySelector<HTMLInputElement>('input[aria-label="Choose a lease file"]');
    const leaseFile = new File(['Landlord: Vikram Mehta\nTenant: Ananya Rao\nRent is INR 32,000 per month.'], 'lease.txt', { type: 'text/plain' });
    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [leaseFile], configurable: true });
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(container.textContent).toContain('Review what will leave');
    await click('+ New chat');
    // Chat 2: a plain question.
    await typeArea('What is a lock-in period?');
    await act(async () => container.querySelector<HTMLFormElement>('form.composer')?.requestSubmit());
    await flush();

    await click('Details');
    expect(container.textContent).toContain('Chats and encrypted history (2)');
    const captured = captureDownload();
    vi.spyOn(window, 'open').mockReturnValue(null);
    await click('Download all chats (encrypted)');
    await flush(100);
    const fileText = (await captured.blob?.text()) ?? '';
    for (const secret of ['Vikram', 'lock-in', 'lease.txt']) expect(fileText).not.toContain(secret);
    const bundle = parseHistory((await importEncryptedFile<unknown>(unlock, fileText)).payload);
    expect(bundle?.chats).toHaveLength(2);
    const withDocument = bundle?.chats.find((chat) => chat.original);
    expect(withDocument?.original?.name).toBe('lease.txt');
    expect(atob(withDocument?.original?.data ?? '')).toContain('Vikram Mehta');
    await expect(importEncryptedFile({ ...unlock, signature: 'another-wallet' }, fileText)).rejects.toThrow('cannot be unlocked');

    // Reopen the first chat from the list.
    await click('Open');
    expect(container.textContent).toContain('Review what will leave');
    vi.mocked(createSdkTransport).mockImplementation(async () => fakeTransport);
  });

  it('restores a downloaded file after clearing the session, and refuses a file from another wallet', async () => {
    await mount();
    await click('Use the sample lease');
    await click('Approve this text');
    const captured = captureDownload();
    vi.spyOn(window, 'open').mockReturnValue(null);
    await click('Details');
    await click('Download all chats (encrypted)');
    await flush();
    expect(container.textContent).toContain('Your browser blocked the new tab');
    const text = (await captured.blob?.text()) ?? '';
    await click('Close');

    await click('Details');
    await click('Clear everything');
    await click('Close');
    expect(container.textContent).toContain('Drop a lease');

    const picker = container.querySelector<HTMLInputElement>('input[aria-label="Open an encrypted Veil file"]');
    const choose = async (contents: string, name: string) => {
      await act(async () => {
        Object.defineProperty(picker, 'files', { value: [new File([contents], name)], configurable: true });
        picker?.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
    };
    const { blob } = await exportEncryptedFile({ ...unlock, signature: 'someone-else' }, { schemaVersion: 1 });
    await choose(await blob.text(), 'other.fineprint');
    await click('Details');
    expect(container.textContent).toContain('cannot be unlocked by the connected wallet key');
    expect(container.textContent).toContain('Drop a lease');
    await click('Close');

    await choose(text, 'history.fineprint');
    expect(container.textContent).toContain('Approved. This text is locked.');
  });
});
