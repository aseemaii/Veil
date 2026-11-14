import { decryptEnvelope, encryptPayload, type EncryptedEnvelope, parseEnvelope, type WalletUnlock } from './crypto';

/**
 * Survive a page refresh without asking the wallet again. Both entries live in sessionStorage, so they belong
 * to this tab only and are gone when the tab closes or the user logs out. The conversation is stored encrypted
 * with the wallet-derived key; the login entry holds the unlock signature that derives that key.
 */
const LOGIN_KEY = 'fineprint.tab-login.v1';
const CHAT_KEY = 'fineprint.tab-chat.v1';

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function saveTabLogin(unlock: WalletUnlock) {
  try {
    storage()?.setItem(LOGIN_KEY, JSON.stringify(unlock));
  } catch {
    // Without storage the user simply logs in again after a refresh.
  }
}

export function loadTabLogin(): WalletUnlock | undefined {
  try {
    const raw = storage()?.getItem(LOGIN_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<Record<keyof WalletUnlock, unknown>>;
    const fields = ['accountId', 'publicKey', 'signature', 'walletId', 'walletName'] as const;
    if (!fields.every((field) => typeof value[field] === 'string' && (value[field] as string).length > 0 && (value[field] as string).length < 2_000)) return undefined;
    return value as WalletUnlock;
  } catch {
    return undefined;
  }
}

export function clearTab() {
  try {
    storage()?.removeItem(LOGIN_KEY);
    storage()?.removeItem(CHAT_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function clearTabChat() {
  try {
    storage()?.removeItem(CHAT_KEY);
  } catch {
    // Nothing to clear.
  }
}

export async function saveTabChat<T>(unlock: WalletUnlock, payload: T): Promise<boolean> {
  try {
    const envelope = await encryptPayload(unlock, payload);
    storage()?.setItem(CHAT_KEY, JSON.stringify({ accountId: unlock.accountId, envelope }));
    return true;
  } catch {
    // Too large for sessionStorage, or storage blocked: the chat still works, it just will not survive a refresh.
    return false;
  }
}

export async function loadTabChat<T>(unlock: WalletUnlock): Promise<T | undefined> {
  try {
    const raw = storage()?.getItem(CHAT_KEY);
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as { accountId?: unknown; envelope?: EncryptedEnvelope };
    if (stored.accountId !== unlock.accountId || !stored.envelope) return undefined;
    const { payload } = await decryptEnvelope<T>(unlock, parseEnvelope(JSON.stringify(stored.envelope)));
    return payload;
  } catch {
    return undefined;
  }
}
