import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Auth } from '../App';
import { type AnalysisStage, type AnalysisTransport, analyze, createSdkTransport, type SdkCredential, verifyCompletion } from '../analyze/client';
import { buildChatRequest, type ChatTurn, type DocumentContext, type PrivacyMode } from '../assistant/prompt';
import { loadAlwaysHidden, saveAlwaysHidden } from '../assistant/remembered';
import { allowValue, createVault, hideValue, maskMessage, seedVault, unmask, type Vault, vaultFromMessages, vaultWithHidden } from '../assistant/vault';
import { Composer, type EnclaveStatus } from '../chat/Composer';
import { Drawer, type DrawerSection } from '../chat/Drawer';
import { GateList } from '../chat/GateList';
import { BotAvatar, Message } from '../chat/Message';
import { useBotGaze } from '../chat/useBotGaze';
import { Report } from '../chat/Report';
import { categoryLabels, countVisibleTerms, originalContent, outgoingContent } from '../chat/review';
import { SendPanel } from '../chat/SendPanel';
import { readSettings, type Settings, writeSettings } from '../chat/settings';
import { initialState, reducer, type View } from '../chat/state';
import type { ChatBlock, ChatMessage } from '../chat/types';
import { detect } from '../detect';
import { type CheckRow, GATE_ROWS, type GateResult, PRIVATE_TEE_MODELS, runGate, type VerifiedSummary } from '../gate/gate';
import {
  deleteEncryptedHistory,
  exportEncryptedFile,
  importEncryptedFile,
  loadEncryptedHistory,
  MAX_ENCRYPTED_FILE_BYTES,
  saveEncryptedHistory,
  type WalletUnlock,
} from '../history/crypto';
import { serveHistoryTab } from '../history/handoff';
import { clearTabChat, loadTabChat, saveTabChat } from '../history/tab';
import { type AnalysisRecord, bytesToBase64, type ChatEntry, chatTitle, type HistoryBundle, MAX_ORIGINAL_BYTES, type OriginalFile, parseHistory, type SavedSession } from '../history/session';
import { parseDocument } from '../intake/parse';
import { useLedger } from '../ledger/fetch';
import { mask } from '../mask/masker';
import { checkBaseUrl, createCustomTransport } from '../providers/custom';
import { buildReceipt, enclaveVerifyUrl, sha256Hex, signatureVerifyUrl } from '../receipt/receipt';
import { sharedConfigured } from '../shared/client';
import { SAMPLE_LEASE } from '../sample/lease';
import { LimitsDialog, Logo } from '../ui/components';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const LARGE_TEXT_CHARS = 200_000;

/** Evidence is re-checked after this long; within it, every send reuses the verified result. */
const ENCLAVE_TTL_MS = 9 * 60_000;
const CHAT_OPTIONS = { temperature: 0.4, maxTokens: 1500 };

const welcomeMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  createdAt: new Date(0).toISOString(),
  blocks: [{ type: 'text', text: 'Hi, I am Veil, your private assistant.' }],
};

const SUGGESTIONS = [
  'What should I check before signing a lease?',
  'How are Private and Incognito different?',
  'Write a polite message asking my landlord to fix a leak',
] as const;

function displayName(accountId: string) {
  const name = accountId.replace(/\.(near|tg|testnet)$/, '');
  return name.length > 18 || /^[0-9a-f]{40,}$/.test(name) ? 'there' : name;
}

/** The greeting is rendered fresh, so it always matches the current provider. Mode details live in the toggle's tooltips. */
function greeting(accountId: string, isNear: boolean): ChatBlock[] {
  return [
    { type: 'text', text: `Hi ${displayName(accountId)}. Ask me anything, or attach a lease and I will flag the risky clauses.` },
    ...(isNear ? [] : [{ type: 'callout' as const, tone: 'warning' as const, title: 'Custom provider', text: 'This provider can read what you send. Keep Incognito on.' }]),
  ];
}

function withoutOriginal(chat: ChatEntry): ChatEntry {
  const { original: _original, ...rest } = chat;
  return rest;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function describeFailure(error: unknown) {
  if (error instanceof TypeError) return "Couldn't reach the model. Check your connection and try again.";
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Nothing else was sent.';
}

function createMessage(role: ChatMessage['role'], blocks: ChatBlock[]): ChatMessage {
  return { id: crypto.randomUUID(), role, createdAt: new Date().toISOString(), blocks };
}

function saveToDevice(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const STAGES = ['Load', 'Review', 'Verify', 'Analyze'] as const;

export function Chat({ auth, unlock }: { auth: Auth; unlock: WalletUnlock }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [chatInput, setChatInput] = useState('');
  const [paste, setPaste] = useState('');
  const [parsing, setParsing] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number; text: string }>();
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [drawer, setDrawer] = useState<{ open: boolean; focus: DrawerSection; nonce: number }>({ open: false, focus: 'model', nonce: 0 });
  const [gateRows, setGateRows] = useState<CheckRow[]>([]);
  const [verified, setVerified] = useState<VerifiedSummary>();
  const [failure, setFailure] = useState<{ stage: 'gate' | 'analysis'; message: string }>();
  const [stage, setStage] = useState<AnalysisStage>();
  const [apiKey, setApiKey] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [docAnchor, setDocAnchor] = useState<string>();
  const [enclave, setEnclave] = useState<EnclaveStatus>('idle');
  const [checkingSignature, setCheckingSignature] = useState(false);
  const [restored, setRestored] = useState(false);
  // Every chat is kept: the open one plus the archive. Original uploaded files stay in memory for downloads only.
  const [chatId, setChatId] = useState<string>(() => crypto.randomUUID());
  const [archive, setArchive] = useState<ChatEntry[]>([]);
  const originals = useRef(new Map<string, OriginalFile>());
  const [showNames, setShowNames] = useState(false);
  const [vaultStatus, setVaultStatus] = useState('Checking for a saved copy on this device…');
  const [live, setLive] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const originalDocument = useRef<HTMLElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const running = useRef<AbortController | undefined>(undefined);
  const chatRun = useRef<AbortController | undefined>(undefined);
  const vaultRef = useRef<Vault>(createVault());
  // Words the user hid by hand, remembered (encrypted) for this wallet and applied to every chat.
  const [alwaysHidden, setAlwaysHidden] = useState<string[]>([]);
  const alwaysHiddenRef = useRef<string[]>([]);
  alwaysHiddenRef.current = alwaysHidden;
  const enclaveRef = useRef<{ key: string; at: number; promise: Promise<GateResult> } | undefined>(undefined);
  const transports = useRef(new Map<string, Promise<AnalysisTransport>>());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const ledger = useLedger();
  useBotGaze(!settings.reduceMotion);

  const accepted = useMemo(() => state.proposals.filter((proposal) => state.accepted.has(proposal.id)), [state.proposals, state.accepted]);
  const masked = useMemo(() => mask(state.text, accepted), [state.text, accepted]);
  const allMasked = useMemo(() => mask(state.text, state.proposals), [state.text, state.proposals]);
  const visibleTerms = useMemo(() => countVisibleTerms(masked.outgoing), [masked.outgoing]);
  const placeholders = useMemo(() => new Map(state.proposals.map((proposal) => {
    const key = proposal.text.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    return [proposal.id, allMasked.map.toPlaceholder.get(key) ?? '[DETAIL]'];
  })), [allMasked.map.toPlaceholder, state.proposals]);
  const carried = ledger.filter((entry) => entry.carriesDocument).length;
  const busy = state.phase === 'checking' || state.phase === 'analyzing';
  const isNear = settings.provider === 'near';
  const sharedAvailable = sharedConfigured();
  const chatStarted = messages.some((message) => message.wire !== undefined);
  // Once something was sent as typed, switching to Incognito would only hide later messages; require a new chat instead.
  const incognitoLocked = messages.some((message) => message.role === 'user' && message.mode === 'private' && message.wire !== undefined);
  // Bumped whenever the user hides or un-hides something, so the preview recomputes.
  const [vaultTick, setVaultTick] = useState(0);
  const preview = useMemo(
    () => (settings.mode === 'incognito' && chatInput.trim() ? maskMessage(chatInput, seedVault(vaultRef.current, masked.map.toValue), { strict: settings.strictHiding }).hidden : []),
    [chatInput, settings.mode, settings.strictHiding, masked.map, vaultTick],
  );
  const allowedInInput = useMemo(() => {
    const lowered = chatInput.toLocaleLowerCase();
    if (settings.mode !== 'incognito') return [];
    // Show each allowed value as the user typed it (the allow list stores it normalised).
    return [...vaultRef.current.allow]
      .map((value) => (value ? lowered.indexOf(value) : -1))
      .flatMap((index, position) => (index >= 0 ? [chatInput.slice(index, index + ([...vaultRef.current.allow][position]?.length ?? 0))] : []));
  }, [chatInput, settings.mode, vaultTick]);

  function hideTerm(value: string) {
    vaultRef.current = hideValue(seedVault(vaultRef.current, masked.map.toValue), value);
    setVaultTick((tick) => tick + 1);
    const clean = value.trim();
    if (!alwaysHiddenRef.current.some((term) => term.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
      const next = [...alwaysHiddenRef.current, clean];
      setAlwaysHidden(next);
      void saveAlwaysHidden(unlock, next);
    }
  }

  function forgetHidden(value: string) {
    const next = alwaysHiddenRef.current.filter((term) => term !== value);
    setAlwaysHidden(next);
    void saveAlwaysHidden(unlock, next);
  }

  // Load the remembered words once per wallet and apply them to the open chat.
  useEffect(() => {
    let current = true;
    void loadAlwaysHidden(unlock).then((terms) => {
      if (!current || terms.length === 0) return;
      setAlwaysHidden(terms);
      vaultRef.current = vaultWithHidden(terms, vaultRef.current);
      setVaultTick((tick) => tick + 1);
    });
    return () => {
      current = false;
    };
  }, [unlock]);

  function allowTerm(value: string) {
    vaultRef.current = allowValue(vaultRef.current, value);
    setVaultTick((tick) => tick + 1);
  }

  function patchMessage(id: string, patch: Partial<ChatMessage>) {
    setMessages((current) => current.map((message) => (message.id === id ? { ...message, ...patch } : message)));
  }

  function push(...next: ChatMessage[]) {
    setMessages((current) => [...current, ...next]);
  }

  function openDrawer(focus: DrawerSection) {
    setDrawer((current) => ({ open: true, focus, nonce: current.nonce + 1 }));
  }

  useEffect(() => {
    threadEnd.current?.scrollIntoView?.({ block: 'end', behavior: settings.reduceMotion ? 'auto' : 'smooth' });
  }, [messages, state.phase, state.view, settings.reduceMotion]);

  useEffect(() => {
    if (state.phase === 'empty' || state.phase === 'reviewing') {
      setGateRows([]);
      setVerified(undefined);
      setFailure(undefined);
    }
  }, [state.phase]);

  useEffect(() => () => {
    running.current?.abort();
    chatRun.current?.abort();
  }, []);

  /** One verification serves the doc flow and the chat for ENCLAVE_TTL_MS; concurrent callers share the same run. */
  function ensureEnclave(force = false): Promise<GateResult> {
    const key = `${settings.model}|${settings.strict}`;
    const cached = enclaveRef.current;
    if (!force && cached && cached.key === key && Date.now() - cached.at < ENCLAVE_TTL_MS) return cached.promise;
    setEnclave('checking');
    const promise: Promise<GateResult> = runGate({ model: settings.model, strict: settings.strict }).then(
      (result) => {
        if (enclaveRef.current?.promise === promise) {
          setEnclave(result.status === 'verified' ? 'verified' : 'failed');
          if (result.status !== 'verified') enclaveRef.current = undefined;
        }
        return result;
      },
      (error: unknown) => {
        if (enclaveRef.current?.promise === promise) {
          enclaveRef.current = undefined;
          setEnclave('failed');
        }
        throw error;
      },
    );
    enclaveRef.current = { key, at: Date.now(), promise };
    return promise;
  }

  // Verify the enclave as soon as the chat opens (and when the model changes), so sending does not wait for it.
  useEffect(() => {
    if (!isNear) {
      setEnclave('none');
      return;
    }
    ensureEnclave().catch(() => undefined);
  }, [isNear, settings.model, settings.strict]);

  /** One SDK client per credential: it keeps the verified evidence cached, so later sends skip re-verification. */
  function getTransport(credential: SdkCredential): Promise<AnalysisTransport> {
    const key = `${credential.kind}:${credential.kind === 'own' ? credential.apiKey : ''}:${settings.strict}`;
    let transport = transports.current.get(key);
    if (!transport) {
      transport = createSdkTransport(credential, settings.strict);
      transport.catch(() => transports.current.delete(key));
      transports.current.set(key, transport);
    }
    return transport;
  }

  // With a cached wallet session, pre-verify the sending client in the background once the enclave checks out.
  useEffect(() => {
    if (!isNear || enclave !== 'verified' || !sharedAvailable || apiKey.trim()) return;
    getTransport({ kind: 'shared' })
      .then((transport) => transport.warm?.(settings.model))
      .catch(() => undefined);
  }, [isNear, enclave, sharedAvailable, settings.model]);

  function applySession(session: SavedSession) {
    dispatch({ type: 'restore', session });
    // A reply cut off by the refresh is shown as it stood; nothing is in flight any more.
    const restoredMessages = session.messages.map((message) => (message.streaming ? { ...message, streaming: false } : message));
    setMessages(restoredMessages.length ? restoredMessages : [welcomeMessage]);
    vaultRef.current = vaultFromMessages(restoredMessages, vaultWithHidden(alwaysHiddenRef.current));
    setDocAnchor([...restoredMessages].reverse().find((message) => message.role === 'user' && message.blocks[0]?.type === 'text' && message.blocks[0].text.startsWith('Loaded '))?.id);
    setGateRows([]);
    setVerified(undefined);
    setFailure(undefined);
  }

  /** Opens a bundle: its active chat becomes the open one, the rest go to the archive. */
  function applyBundle(bundle: HistoryBundle, keep: ChatEntry[] = []) {
    for (const chat of bundle.chats) if (chat.original) originals.current.set(chat.id, chat.original);
    const active = bundle.chats.find((chat) => chat.id === bundle.activeId);
    const known = new Set(bundle.chats.map((chat) => chat.id));
    setArchive([...bundle.chats.filter((chat) => chat !== active).map(withoutOriginal), ...keep.filter((chat) => !known.has(chat.id))]);
    resetCurrent();
    if (active) {
      applySession(active.session);
      setChatId(active.id);
    } else {
      setChatId(crypto.randomUUID());
    }
  }

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        // After a refresh, pick up this tab's chats first.
        const tabBundle = parseHistory(await loadTabChat<unknown>(unlock));
        if (!current) return;
        if (tabBundle) {
          applyBundle(tabBundle);
          setVaultStatus('Restored this tab after a refresh. Download or save a copy to keep your chats after the tab closes.');
          return;
        }
        const saved = await loadEncryptedHistory<unknown>(unlock);
        if (!current) return;
        if (!saved) {
          setVaultStatus('No saved copy on this device. Save one when you want to keep this chat.');
          return;
        }
        const bundle = parseHistory(saved.payload);
        if (!bundle) {
          setVaultStatus('A saved copy exists but its contents are not valid. It was not loaded.');
          return;
        }
        applyBundle(bundle);
        setVaultStatus(`Restored the copy saved ${new Date(saved.savedAt).toLocaleString()}.`);
      } catch (error) {
        if (current) setVaultStatus(error instanceof Error ? error.message : 'The saved copy could not be opened.');
      } finally {
        if (current) setRestored(true);
      }
    })();
    return () => {
      current = false;
    };
  }, [unlock]);

  // Keep this tab's conversation (encrypted) so a refresh does not lose it. Waits until any restore has finished.
  useEffect(() => {
    if (!restored) return;
    const timer = window.setTimeout(() => void saveTabChat(unlock, buildBundle(false)), 400);
    return () => window.clearTimeout(timer);
  }, [restored, unlock, messages, state, archive, chatId]);

  function updateSettings(next: Settings) {
    const changedGate = next.model !== settings.model || next.strict !== settings.strict || next.provider !== settings.provider;
    setSettings(next);
    writeSettings(next);
    if (changedGate && (state.phase === 'verified' || state.phase === 'failed')) {
      dispatch({ type: 'phase', phase: 'approved' });
      setVerified(undefined);
      setGateRows([]);
      setFailure(undefined);
    }
  }

  function loadText(name: string, text: string) {
    if (!text.trim()) {
      dispatch({ type: 'error', message: 'No text was found. Choose a text file or paste the agreement.' });
      return;
    }
    if (text.length > LARGE_TEXT_CHARS && !window.confirm(`This text is ${text.length.toLocaleString()} characters. Large agreements are slow to review and cost more to analyze. Continue?`)) return;
    const proposals = detect(text);
    const counts = new Map<string, number>();
    for (const proposal of proposals) counts.set(categoryLabels[proposal.category], (counts.get(categoryLabels[proposal.category]) ?? 0) + 1);
    dispatch({ type: 'load', name, text });
    setShowNames(false);
    setAttachOpen(false);
    const loaded = createMessage('user', [{ type: 'text', text: `Loaded ${name} for a private review.` }]);
    setDocAnchor(loaded.id);
    push(
      loaded,
      createMessage('assistant', [
        { type: 'text', text: `I found ${proposals.length} details that may identify someone. Click a highlight to keep it visible or hidden, then approve the outgoing text. After that you can ask me anything about it, or run a full risk report.` },
        { type: 'stats', items: [
          { label: 'Characters', value: text.length.toLocaleString() },
          { label: 'Proposed masks', value: proposals.length.toString() },
          { label: 'Requests sent', value: '0' },
        ] },
        { type: 'bar-chart', title: 'Detected details', items: [...counts].map(([label, value]) => ({ label, value })) },
      ]),
    );
  }

  async function loadFile(file?: File) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      dispatch({ type: 'error', message: 'This file is over the 20 MB limit. Choose a smaller file.' });
      return;
    }
    setParsing(true);
    try {
      const parsed = await parseDocument(file);
      loadText(file.name, parsed.text);
      // Keep the exact file so "Download all chats" can return it, encrypted with everything else.
      if (file.size <= MAX_ORIGINAL_BYTES) {
        originals.current.set(chatId, { name: file.name, type: file.type, data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) });
      }
    } catch (error) {
      dispatch({ type: 'error', message: error instanceof Error ? error.message : 'The document could not be read.' });
    } finally {
      setParsing(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function approve() {
    const fingerprint = (await sha256Hex(masked.outgoing)).slice(0, 8);
    dispatch({ type: 'approve', fingerprint });
    push(createMessage('assistant', [{
      type: 'callout',
      tone: 'success',
      title: 'Outgoing text approved',
      text: isNear
        ? `The masked text is locked to fingerprint ${fingerprint}. No document content has been sent. Checking the enclave now; you can also ask me questions about it below.`
        : `The masked text is locked to fingerprint ${fingerprint}. No document content has been sent. Choose how to send it, or ask me about it below.`,
    }]));
    if (isNear) void checkEnclave();
  }

  function cancelRun() {
    running.current?.abort();
  }

  async function checkEnclave() {
    const controller = new AbortController();
    running.current = controller;
    setFailure(undefined);
    setVerified(undefined);
    setGateRows(GATE_ROWS.map((row) => ({ ...row, state: 'pending' })));
    dispatch({ type: 'phase', phase: 'checking' });
    setLive('Checking the enclave.');
    try {
      const result = await abortable(ensureEnclave(), controller.signal);
      setGateRows(result.rows);
      if (result.status === 'verified') {
        setVerified(result.summary);
        dispatch({ type: 'phase', phase: 'verified' });
        push(createMessage('assistant', [{
          type: 'callout',
          tone: 'success',
          title: 'Enclave verified',
          text: `Hardware evidence for ${result.summary.model} was verified at ${new Date(result.summary.verifiedAt).toLocaleTimeString()}: Intel TDX quote, NVIDIA GPU result, nonce matched. Sending is now possible. This does not prove the model is safe.`,
        }]));
      } else {
        const label = GATE_ROWS.find((row) => row.id === result.failedCheck)?.label ?? result.failedCheck;
        setFailure({ stage: 'gate', message: `Not verified: ${label}. ${result.reason} Nothing was sent.` });
        dispatch({ type: 'phase', phase: 'failed' });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setGateRows([]);
        dispatch({ type: 'phase', phase: 'approved' });
        push(createMessage('assistant', [{ type: 'text', text: 'The enclave check was cancelled. Nothing was sent.' }]));
      } else {
        setFailure({ stage: 'gate', message: error instanceof Error ? error.message : 'The enclave check failed. Nothing was sent.' });
        dispatch({ type: 'phase', phase: 'failed' });
      }
    }
  }

  async function finishSignature(transport: AnalysisTransport, completionId: string, report: AnalysisRecord['report'], model: string, outgoing: string, verifiedAt: string | undefined) {
    setCheckingSignature(true);
    try {
      const signed = await verifyCompletion(transport, completionId);
      const receipt = signed && verifiedAt ? await buildReceipt({ completionId, model, signed, outgoing, report, verifiedAt }) : null;
      dispatch({ type: 'signature', completionId, signatureStatus: signed ? signed.signatureKind : 'unsigned', receipt });
      push(createMessage('assistant', [
        signed?.signatureKind === 'provider_tee'
          ? { type: 'callout', tone: 'success', title: 'Signed by the model', text: 'The signature matches the verified model signer. The receipt is ready to download.' }
          : signed?.signatureKind === 'gateway'
            ? { type: 'callout', tone: 'warning', title: 'Signed by the gateway only', text: 'This does not show the model ran in an enclave.' }
            : { type: 'callout', tone: 'warning', title: 'Not verified', text: 'No signature came back after 3 tries. Treat this report as unverified.' },
      ]));
    } finally {
      setCheckingSignature(false);
    }
  }

  async function sendRedacted(mode: 'own' | 'wallet' | 'custom') {
    const allowed = mode === 'custom' ? state.phase === 'approved' : state.phase === 'verified' && verified !== undefined;
    if (!allowed) return;
    const key = apiKey.trim();
    if (mode === 'own' && !key) return;
    const controller = new AbortController();
    running.current = controller;
    setFailure(undefined);
    setStage('sending');
    dispatch({ type: 'phase', phase: 'analyzing' });
    setLive('Encrypting the masked text and waiting for the model.');
    try {
      let transport: AnalysisTransport;
      let model: string;
      if (mode === 'custom') {
        const url = checkBaseUrl(settings.customBaseUrl);
        if (!url.ok) throw new Error(url.reason);
        transport = createCustomTransport(url.baseUrl, key);
        model = settings.customModel.trim();
      } else if (mode === 'wallet') {
        transport = await getTransport({ kind: 'shared' });
        model = verified?.model ?? settings.model;
      } else {
        transport = await getTransport({ kind: 'own', apiKey: key });
        model = verified?.model ?? settings.model;
      }
      const outcome = await analyze({
        outgoing: masked.outgoing,
        model,
        signal: controller.signal,
        transport,
        deferSignature: true,
        onStage: (next) => {
          setStage(next);
          setLive('Encrypting the masked text and waiting for the model.');
        },
      });
      const record: AnalysisRecord = {
        report: outcome.report,
        completionId: outcome.completionId,
        model: outcome.model,
        signatureStatus: outcome.signatureStatus,
        completedAt: outcome.completedAt,
        receipt: null,
      };
      dispatch({ type: 'done', analysis: record });
      const clauses = outcome.report.riskyClauses.length;
      push(createMessage('assistant', [
        { type: 'text', text: `Analysis done. I found ${clauses} risky clause${clauses === 1 ? '' : 's'}. The report is open above, with quotes, reasons and questions to ask. Ask me below if you want any clause explained.` },
        ...(outcome.signatureStatus === 'none'
          ? [{ type: 'callout' as const, tone: 'warning' as const, title: 'Unverified provider', text: 'This provider does not sign responses and has no hardware privacy guarantee.' }]
          : []),
      ]));
      if (outcome.signatureStatus !== 'none') {
        void finishSignature(transport, outcome.completionId, outcome.report, outcome.model, masked.outgoing, verified?.verifiedAt).catch(() => setCheckingSignature(false));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        dispatch({ type: 'phase', phase: mode === 'custom' ? 'approved' : 'verified' });
        push(createMessage('assistant', [{ type: 'text', text: 'The analysis was cancelled.' }]));
      } else {
        const message = error instanceof TypeError
          ? "Couldn't reach the provider. Check your connection and try again."
          : error instanceof Error ? error.message : 'The analysis failed.';
        setFailure({ stage: 'analysis', message });
        dispatch({ type: 'phase', phase: 'failed' });
      }
    } finally {
      setStage(undefined);
    }
  }

  function hasContent() {
    return state.phase !== 'empty' || messages.some((message) => message.wire !== undefined);
  }

  /** Deletes every chat in this tab, after asking. */
  function clearEverything() {
    if ((hasContent() || archive.length > 0) && !window.confirm('Delete all chats, documents and the key from this tab? Download them first under Details if you want to keep them.')) return;
    setApiKey('');
    setArchive([]);
    originals.current.clear();
    transports.current.clear();
    clearTabChat();
    resetCurrent();
    setChatId(crypto.randomUUID());
  }

  /** Empties the open chat only; the archive is untouched. */
  function resetCurrent() {
    running.current?.abort();
    chatRun.current?.abort();
    setPaste('');
    setAcknowledged(false);
    setAttachOpen(false);
    setDocAnchor(undefined);
    vaultRef.current = vaultWithHidden(alwaysHiddenRef.current);
    setMessages([welcomeMessage]);
    setGateRows([]);
    setVerified(undefined);
    setFailure(undefined);
    if (fileInput.current) fileInput.current.value = '';
    dispatch({ type: 'clear' });
  }

  async function logout() {
    if (state.phase !== 'empty' && !window.confirm('Log out and clear the decrypted session from this tab? Save an encrypted copy first if you want to keep it.')) return;
    running.current?.abort();
    chatRun.current?.abort();
    setApiKey('');
    await auth.logout();
  }

  function buildSession(): SavedSession {
    return {
      schemaVersion: 1,
      review: {
        phase: state.phase,
        name: state.name,
        text: state.text,
        proposals: state.proposals,
        accepted: [...state.accepted],
        view: state.view,
        fingerprint: state.fingerprint,
      },
      messages,
      analysis: state.analysis,
    };
  }

  function currentEntry(): ChatEntry {
    const session = buildSession();
    return { id: chatId, title: chatTitle(session), updatedAt: new Date().toISOString(), session };
  }

  /** All chats in one bundle. Original files are included only in downloads (browser storage is too small). */
  function buildBundle(withOriginals: boolean): HistoryBundle {
    const chats = [...(hasContent() || archive.length === 0 ? [currentEntry()] : []), ...archive];
    return {
      schemaVersion: 2,
      kind: 'bundle',
      activeId: chatId,
      chats: chats.map((chat) => {
        const original = withOriginals ? originals.current.get(chat.id) : undefined;
        return original ? { ...chat, original } : withoutOriginal(chat);
      }),
    };
  }

  function newChat() {
    if (!hasContent()) return;
    running.current?.abort();
    chatRun.current?.abort();
    setArchive((current) => [currentEntry(), ...current]);
    resetCurrent();
    setChatId(crypto.randomUUID());
  }

  function openChat(id: string) {
    const entry = archive.find((chat) => chat.id === id);
    if (!entry) return;
    const rest = archive.filter((chat) => chat.id !== id);
    setArchive(hasContent() ? [currentEntry(), ...rest] : rest);
    resetCurrent();
    applySession(entry.session);
    setChatId(entry.id);
    setDrawer((current) => ({ ...current, open: false }));
  }

  function deleteChat(id: string) {
    if (!window.confirm('Delete this chat from this tab? Downloaded files are not affected.')) return;
    setArchive((current) => current.filter((chat) => chat.id !== id));
    originals.current.delete(id);
  }

  async function saveInBrowser() {
    try {
      const savedAt = await saveEncryptedHistory(unlock, buildBundle(false));
      setVaultStatus(`All chats encrypted and saved in this browser at ${new Date(savedAt).toLocaleTimeString()}. Only your wallet can open them. Original files are kept in downloads only.`);
    } catch (error) {
      setVaultStatus(error instanceof Error ? error.message : 'The encrypted copy could not be saved.');
    }
  }

  async function downloadHistory() {
    // Open the tab inside the click so pop-up blockers allow it; it asks us for the file when it loads.
    const tab = window.open('/history', '_blank');
    const bundle = buildBundle(true);
    const created = exportEncryptedFile(unlock, bundle);
    if (tab) serveHistoryTab(tab, async () => ({ fileText: await (await created).blob.text(), unlock }));
    try {
      const { blob, filename, savedAt } = await created;
      saveToDevice(blob, filename);
      setVaultStatus(tab
        ? `Downloaded ${bundle.chats.length} chat${bundle.chats.length === 1 ? '' : 's'} as ${filename} at ${new Date(savedAt).toLocaleTimeString()} and opened it in a new tab. Only the wallet you signed in with can open it, and only on this site.`
        : `Downloaded ${filename}. Your browser blocked the new tab; allow pop-ups, or use Open encrypted file.`);
    } catch (error) {
      tab?.close();
      setVaultStatus(error instanceof Error ? error.message : 'The encrypted file could not be created.');
    }
  }

  async function openHistoryFile(file?: File) {
    if (!file) return;
    if (file.size > MAX_ENCRYPTED_FILE_BYTES) {
      setVaultStatus('That file is too large to be a Veil history.');
      return;
    }
    try {
      const { payload, savedAt } = await importEncryptedFile<unknown>(unlock, await file.text());
      const bundle = parseHistory(payload);
      if (!bundle) {
        setVaultStatus('The file decrypted but its contents are not valid Veil chats.');
        return;
      }
      // Chats already open in this tab are kept alongside the imported ones.
      applyBundle(bundle, hasContent() ? [currentEntry(), ...archive] : archive);
      setVaultStatus(`Opened ${bundle.chats.length} chat${bundle.chats.length === 1 ? '' : 's'} from ${file.name}, saved ${new Date(savedAt).toLocaleString()}.`);
    } catch (error) {
      setVaultStatus(error instanceof Error ? error.message : 'The file could not be opened.');
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  }

  async function deleteSaved() {
    if (!window.confirm('Delete the encrypted copy saved for this wallet in this browser? Downloaded files are not affected.')) return;
    await deleteEncryptedHistory(unlock.accountId);
    setVaultStatus('The saved copy was deleted from this browser.');
  }

  function downloadReceipt() {
    const receipt = state.analysis?.receipt;
    if (!receipt) return;
    const safeId = receipt.near.completionId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 24) || 'receipt';
    saveToDevice(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }), `fineprint-receipt-${safeId}.json`);
  }

  function documentContext(): DocumentContext | undefined {
    if (state.phase === 'empty') return undefined;
    const approved = state.fingerprint !== undefined && state.phase !== 'reviewing';
    return { name: state.name, outgoing: approved ? masked.outgoing : undefined, report: state.analysis?.report };
  }

  async function chatTransport(signal: AbortSignal): Promise<{ transport: AnalysisTransport; model: string }> {
    if (!isNear) {
      const url = checkBaseUrl(settings.customBaseUrl);
      if (!url.ok || !settings.customModel.trim()) throw new Error('Choose a provider URL and model under Details, Model and provider first. Nothing was sent.');
      return { transport: createCustomTransport(url.baseUrl, apiKey.trim()), model: settings.customModel.trim() };
    }
    const gate = await abortable(ensureEnclave(), signal);
    if (gate.status !== 'verified') throw new Error(`The enclave check failed (${gate.reason}). Nothing was sent.`);
    const key = apiKey.trim();
    let credential: SdkCredential;
    if (key) credential = { kind: 'own', apiKey: key };
    else if (sharedAvailable) credential = { kind: 'shared' };
    else throw new Error('Add your NEAR AI Cloud key under Details, Model and provider to chat. Nothing was sent.');
    return { transport: await abortable(getTransport(credential), signal), model: gate.summary.model };
  }

  async function sendMessage(override?: string) {
    const text = (override ?? chatInput).trim();
    if (!text || chatBusy) return;
    const mode = settings.mode;
    const vault = seedVault(vaultRef.current, masked.map.toValue);
    const outgoing = mode === 'incognito' ? maskMessage(text, vault, { strict: settings.strictHiding }) : { outgoing: text, hidden: [], vault };
    vaultRef.current = outgoing.vault;
    const turns: ChatTurn[] = messagesRef.current
      .filter((message) => message.wire !== undefined && !message.streaming)
      .map((message) => ({ role: message.role, wire: message.wire ?? '' }));
    turns.push({ role: 'user', wire: outgoing.outgoing });
    const userMessage: ChatMessage = { ...createMessage('user', [{ type: 'text', text }]), wire: outgoing.outgoing, mode, hidden: outgoing.hidden.map((detail) => detail.placeholder) };
    const reply: ChatMessage = { ...createMessage('assistant', [{ type: 'text', text: '' }]), streaming: true };
    if (override === undefined) setChatInput('');
    setAttachOpen(false);
    push(userMessage, reply);

    const controller = new AbortController();
    chatRun.current = controller;
    setChatBusy(true);
    setLive('Sending your message.');
    let received = '';
    const show = (wire: string) => unmask(wire, vaultRef.current);
    try {
      const { transport, model } = await chatTransport(controller.signal);
      const request = buildChatRequest({ mode, turns, doc: documentContext() });
      let result: { id: string; text: string };
      if (transport.stream) {
        try {
          result = await transport.stream(request, model, controller.signal, (wire) => {
            received = wire;
            patchMessage(reply.id, { blocks: [{ type: 'text', text: show(wire) }] });
          }, CHAT_OPTIONS);
        } catch (error) {
          // Some deployments may not stream; fall back once if nothing arrived yet.
          if (controller.signal.aborted || received) throw error;
          result = await transport.complete(request, model, controller.signal, CHAT_OPTIONS);
        }
      } else {
        result = await transport.complete(request, model, controller.signal, CHAT_OPTIONS);
      }
      const answer = result.text.trim();
      patchMessage(reply.id, {
        streaming: false,
        wire: answer || undefined,
        blocks: [{ type: 'text', text: answer ? show(answer) : 'The model sent an empty reply. Try asking again.' }],
        verification: transport.verifyResponse && result.id ? 'pending' : 'none',
      });
      setLive('Veil replied.');
      if (transport.verifyResponse && result.id) {
        verifyCompletion(transport, result.id).then(
          (signed) => patchMessage(reply.id, {
            verification: signed ? signed.signatureKind : 'unsigned',
            verifyUrl: signed ? signatureVerifyUrl({ ...signed, completionId: result.id, model }) : undefined,
          }),
          () => patchMessage(reply.id, { verification: 'unsigned' }),
        );
      }
    } catch (error) {
      if (controller.signal.aborted) {
        patchMessage(reply.id, {
          streaming: false,
          wire: received.trim() || undefined,
          blocks: [{ type: 'text', text: received.trim() ? show(received) : 'Stopped before a reply arrived.' }],
        });
      } else {
        patchMessage(reply.id, { streaming: false, blocks: [{ type: 'callout', tone: 'warning', title: "Couldn't send that", text: describeFailure(error) }] });
      }
    } finally {
      setChatBusy(false);
      if (chatRun.current === controller) chatRun.current = undefined;
    }
  }

  function setMode(mode: PrivacyMode) {
    if (mode === 'incognito' && incognitoLocked) return;
    if (mode !== settings.mode) updateSettings({ ...settings, mode });
  }


  function attach() {
    if (state.phase === 'empty') setAttachOpen(true);
    fileInput.current?.click();
  }

  function captureSelection() {
    const root = originalDocument.current;
    const selected = window.getSelection();
    if (!root || !selected || selected.isCollapsed || selected.rangeCount === 0) {
      setSelection(undefined);
      return;
    }
    const range = selected.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const prefix = document.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    const text = range.toString();
    if (text.trim()) setSelection({ start, end: start + text.length, text });
  }

  function noteApprovalCleared(wasActive: boolean) {
    if (wasActive) push(createMessage('assistant', [{ type: 'callout', tone: 'warning', title: 'Approval cleared', text: 'The mask list changed, so approval, the enclave check and any report were discarded. Approve the new outgoing text again.' }]));
  }

  function addSelection() {
    if (!selection) return;
    const wasActive = state.phase !== 'reviewing' && state.phase !== 'empty';
    running.current?.abort();
    dispatch({ type: 'manual', start: selection.start, end: selection.end });
    noteApprovalCleared(wasActive);
    window.getSelection()?.removeAllRanges();
    setSelection(undefined);
  }

  function toggleMask(id: string) {
    const wasActive = state.phase !== 'reviewing' && state.phase !== 'empty';
    running.current?.abort();
    dispatch({ type: 'toggle', id });
    noteApprovalCleared(wasActive);
  }

  const stageIndex = state.phase === 'empty' ? 0
    : state.phase === 'reviewing' || state.phase === 'approved' ? 1
      : state.phase === 'checking' || state.phase === 'verified' ? 2
        : state.phase === 'analyzing' ? 3
          : state.phase === 'done' ? 4
            : failure?.stage === 'analysis' ? 3 : 2;

  const views: View[] = state.analysis ? ['report', 'original', 'outgoing', 'compare'] : ['original', 'outgoing', 'compare'];
  const accountLabel = unlock.accountId.length > 20 ? `${unlock.accountId.slice(0, 18)}…` : unlock.accountId;
  const modelLabel = isNear
    ? `NEAR AI · ${PRIVATE_TEE_MODELS.find((model) => model.id === settings.model)?.label ?? settings.model}`
    : `Custom · ${settings.customModel || 'choose a model'}`;
  const ledgerSentence = carried === 0 ? 'No request has carried your document yet.' : `${carried} request${carried === 1 ? '' : 's'} carried your document.`;
  const showSendPanel = (isNear && state.phase === 'verified') || (!isNear && state.phase === 'approved');
  // The document card sits in the thread where the document was loaded, so questions about it follow below it.
  const anchored = state.phase !== 'empty' && docAnchor !== undefined && messages.some((message) => message.id === docAnchor);
  const showWorkCard = state.phase !== 'empty' || !chatStarted || attachOpen;
  const composerNote = (
    <>
      {isNear ? 'End-to-end encrypted' : 'Not encrypted to an enclave'} · <button className="link" type="button" onClick={() => openDrawer('ledger')} title={ledgerSentence}>Ledger</button> · <button className="link" type="button" onClick={() => setLimitsOpen(true)}>Limits</button>
    </>
  );

  const workCard = (
    <article className="msg msg--assistant msg--work">
      <BotAvatar />
      <div className="work">
        {state.phase === 'empty' ? (
          <section
            className="drop"
            aria-label="File drop area"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void loadFile(event.dataTransfer.files[0]);
            }}
          >
            <h2>Drop a lease <em>here.</em></h2>
            <p className="muted">It stays in this browser until you approve what leaves. PDF with a text layer, DOCX or plain text, up to 20 MB.</p>
            <div className="row">
              <button className="btn primary" type="button" disabled={parsing} onClick={() => fileInput.current?.click()}>{parsing ? 'Reading on this device' : 'Choose a file'}</button>
              <button className="btn" type="button" onClick={() => loadText('Synthetic sample lease', SAMPLE_LEASE)}>Use the sample lease</button>
            </div>
            <details className="more paste">
              <summary>Paste text instead</summary>
              <label htmlFor="pasted-text">Agreement text</label>
              <textarea id="pasted-text" value={paste} onChange={(event) => setPaste(event.target.value)} />
              <button className="btn" type="button" onClick={() => loadText('Pasted agreement', paste)}>Review pasted text</button>
            </details>
            {state.error && <p className="form-error" role="alert">{state.error}</p>}
          </section>
        ) : (
          <>
            <div className="work-head">
              <div>
                <p className="doc-name">{state.name}</p>
                <h2>{state.view === 'report' ? 'Lease report' : 'Review what will leave'}</h2>
              </div>
              <fieldset className="view-tabs">
                <legend className="sr">Document view</legend>
                {views.map((view) => (
                  <button type="button" aria-pressed={state.view === view} key={view} onClick={() => dispatch({ type: 'view', view })}>{view[0]?.toUpperCase()}{view.slice(1)}</button>
                ))}
              </fieldset>
            </div>

            {state.view === 'report' && state.analysis ? (
              <div className="work-body">
                <Report
                  record={state.analysis}
                  outgoing={masked.outgoing}
                  map={masked.map}
                  showNames={showNames}
                  onShowNames={setShowNames}
                  onDownload={downloadReceipt}
                  checkingSignature={checkingSignature}
                  onRunAgain={() => {
                    dispatch({ type: 'phase', phase: 'approved' });
                    dispatch({ type: 'view', view: 'outgoing' });
                    setVerified(undefined);
                    setGateRows([]);
                    if (isNear) void checkEnclave();
                  }}
                />
              </div>
            ) : (
              <div className={state.view === 'compare' ? 'docs docs--compare work-body' : 'docs work-body'}>
                {(state.view === 'original' || state.view === 'compare') && (
                  <article ref={originalDocument} className="doc" aria-label="Original agreement" onMouseUp={captureSelection} onKeyUp={captureSelection}>{originalContent(state, toggleMask)}</article>
                )}
                {(state.view === 'outgoing' || state.view === 'compare') && (
                  <article className="doc doc--out" aria-label="Outgoing agreement">{outgoingContent(masked)}</article>
                )}
              </div>
            )}

            <footer className="work-foot">
              {selection && <button className="btn sm selection" type="button" onClick={addSelection}>Mask selected text: “{selection.text.trim().slice(0, 28)}{selection.text.trim().length > 28 ? '…' : ''}”</button>}
              {state.error && <p className="form-error" role="alert">{state.error}</p>}
              <p><strong>{accepted.length} details will be masked.</strong> {visibleTerms} amounts and dates will be sent as written. <button className="link" type="button" onClick={() => openDrawer('masks')}>Choose which</button></p>
              <p className="muted small">{masked.outgoing.length.toLocaleString()} characters, about {Math.ceil(masked.outgoing.length / 4).toLocaleString()} tokens.</p>
              {!selection && state.phase === 'reviewing' && (
                <p className="muted small">
                  Missed something? {state.view === 'outgoing'
                    ? <button className="link" type="button" onClick={() => dispatch({ type: 'view', view: 'compare' })}>Open the compare view</button>
                    : 'Select the text in the original'}, then choose “Mask selected text”. Every other copy of it is hidden too.
                </p>
              )}

              {state.phase === 'reviewing' && <button className="btn primary" type="button" onClick={() => void approve()}>Approve this text</button>}
              {state.phase !== 'reviewing' && state.fingerprint && <p className="approved">Approved. This text is locked. Fingerprint <code>{state.fingerprint}</code>.</p>}
              {state.phase === 'approved' && isNear && <button className="btn primary" type="button" onClick={() => void checkEnclave()}>Check the enclave</button>}
              {state.phase === 'checking' && (
                <div className="row"><p className="muted">Checking the enclave. Nothing has been sent.</p><button className="btn sm" type="button" onClick={cancelRun}>Cancel</button></div>
              )}
              {isNear && <GateList rows={gateRows} verified={verified} />}
              {state.phase === 'verified' && verified && <p className="ok-text">Enclave verified at {new Date(verified.verifiedAt).toLocaleTimeString()}. Sending is now possible.</p>}
              {showSendPanel && (
                <SendPanel
                  settings={settings}
                  sharedAvailable={sharedAvailable}
                  apiKey={apiKey}
                  onApiKey={setApiKey}
                  acknowledged={acknowledged}
                  onAcknowledge={setAcknowledged}
                  onSend={(mode) => void sendRedacted(mode)}
                  onOpenSettings={() => openDrawer('model')}
                />
              )}
              {state.phase === 'analyzing' && (
                <div className="send-box">
                  <ol className="stage-list">
                    <li className="done">Masking on this device</li>
                    {isNear && <li className="done">Checking the enclave</li>}
                    <li className={stage === 'sending' ? 'on' : 'done'}>{isNear ? 'Encrypting and waiting for the enclave' : 'Waiting for the provider'}</li>
                  </ol>
                  <button className="btn sm" type="button" onClick={cancelRun}>Cancel</button>
                </div>
              )}
              {state.phase === 'failed' && failure && (
                <div className="send-box">
                  <p className="form-error" role="alert">{failure.message}</p>
                  <button className="btn" type="button" onClick={() => dispatch({ type: 'phase', phase: 'approved' })}>Try again</button>
                </div>
              )}
            </footer>
          </>
        )}
      </div>
    </article>
  );

  return (
    <div className={`app chat-app mode-${settings.mode}${settings.reduceMotion ? ' app--reduce-motion' : ''}`}>
      <a className="skip-link" href="#workspace">Skip to the chat</a>
      <header className="nav chat-nav">
        <div className="wrap wide">
          <Logo to="/chat" />
          {/* The document steps only matter while a document is open. */}
          {state.phase === 'empty' ? <span aria-hidden="true" /> : (
            <ol className="stepper" aria-label="Document progress">
              {STAGES.map((label, index) => (
                <li key={label} className={index < stageIndex ? 'done' : index === stageIndex ? 'cur' : ''} aria-current={index === stageIndex ? 'step' : undefined}>{label}</li>
              ))}
            </ol>
          )}
          <div className="nav-actions">
            <button className="chip-button" type="button" onClick={() => openDrawer('model')} title={`${modelLabel}. Change model or provider`}>{modelLabel.replace(/^NEAR AI · /, '')}</button>
            <button className="btn sm" type="button" onClick={() => openDrawer('history')} aria-label="History, ledger and settings">Details</button>
            <span className="account" title={`Signed in with ${unlock.walletName}`}><i aria-hidden="true" />{accountLabel}</span>
            <button className="btn sm" type="button" onClick={() => void logout()}>Log out</button>
          </div>
        </div>
      </header>

      <main className="chat-main" id="workspace">
        <div className="thread" role="log" aria-label="Conversation">
          <div className="thread-in">
            {messages.map((message) => (
              <Fragment key={message.id}>
                <Message message={message.id === 'welcome' ? { ...message, blocks: greeting(unlock.accountId, isNear) } : message} />
                {message.id === docAnchor && anchored && workCard}
              </Fragment>
            ))}
            {!chatStarted && state.phase === 'empty' && (
              <section className="suggestions" aria-label="Suggestions">
                <button type="button" className="suggestion" onClick={() => loadText('Synthetic sample lease', SAMPLE_LEASE)}>Review the sample lease</button>
                {SUGGESTIONS.map((suggestion) => (
                  <button type="button" className="suggestion" key={suggestion} disabled={chatBusy} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>
                ))}
              </section>
            )}
            {!anchored && showWorkCard && workCard}
            <div ref={threadEnd} />
          </div>
        </div>

        <Composer
          value={chatInput}
          onChange={setChatInput}
          onSend={() => void sendMessage()}
          onStop={() => chatRun.current?.abort()}
          busy={chatBusy}
          mode={settings.mode}
          onMode={setMode}
          incognitoLocked={incognitoLocked}
          onNewChat={hasContent() ? newChat : undefined}
          preview={preview}
          allowed={allowedInInput}
          onAllow={allowTerm}
          onHide={hideTerm}
          strict={settings.strictHiding}
          onStrict={(strictHiding) => updateSettings({ ...settings, strictHiding })}
          enclave={enclave}
          verifyUrl={isNear ? enclaveVerifyUrl(settings.model) : undefined}
          onEnclave={() => {
            ensureEnclave(true).catch(() => undefined);
          }}
          onAttach={attach}
          note={composerNote}
        />
        <input ref={fileInput} className="sr" type="file" tabIndex={-1} aria-label="Choose a lease file" accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => void loadFile(event.target.files?.[0])} />
      </main>

      <Drawer
        open={drawer.open}
        focus={drawer.focus}
        nonce={drawer.nonce}
        onClose={() => setDrawer((current) => ({ ...current, open: false }))}
        settings={settings}
        onSettings={updateSettings}
        busy={busy}
        ledger={ledger}
        carried={carried}
        vaultStatus={vaultStatus}
        canSave={hasContent() || archive.length > 0}
        chats={[
          ...(hasContent() ? [{ id: chatId, title: chatTitle(buildSession()), updatedAt: new Date().toISOString(), current: true, hasDocument: state.phase !== 'empty' }] : []),
          ...archive.map((chat) => ({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt, current: false, hasDocument: chat.session.review.phase !== 'empty' })),
        ]}
        onOpenChat={openChat}
        onDeleteChat={deleteChat}
        alwaysHidden={alwaysHidden}
        onForgetHidden={forgetHidden}
        onDownload={() => void downloadHistory()}
        onOpenFile={() => importInput.current?.click()}
        onSaveBrowser={() => void saveInBrowser()}
        onDeleteSaved={() => void deleteSaved()}
        proposals={state.proposals}
        accepted={state.accepted}
        placeholders={placeholders}
        onToggleMask={toggleMask}
        onClear={clearEverything}
        apiKey={apiKey}
        onApiKey={setApiKey}
        sharedAvailable={sharedAvailable}
      />
      <input ref={importInput} className="sr" type="file" tabIndex={-1} aria-label="Open an encrypted Veil file" accept=".veil,.fineprint,application/json" onChange={(event) => void openHistoryFile(event.target.files?.[0])} />
      <LimitsDialog open={limitsOpen} onClose={() => setLimitsOpen(false)} />
      <div className="sr" aria-live="polite">{live}</div>
    </div>
  );
}
