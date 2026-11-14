import { decryptEnvelope, encryptPayload, parseEnvelope, type WalletUnlock } from '../history/crypto';

/**
 * Words and phrases the user hid by hand, remembered for their wallet so every future chat hides them too.
 * Stored in this browser only, encrypted with the wallet-derived key; the storage key is a hash of the account.
 */
const PREFIX = 'fineprint.always-hide.v1';
const MAX_TERMS = 500;

async function storageKey(accountId: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${PREFIX}\u0000${accountId.toLocaleLowerCase()}`)));
  return `${PREFIX}:${[...digest.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function loadAlwaysHidden(unlock: WalletUnlock): Promise<string[]> {
  try {
    const raw = localStorage.getItem(await storageKey(unlock.accountId));
    if (!raw) return [];
    const { payload } = await decryptEnvelope<unknown>(unlock, parseEnvelope(raw));
    return Array.isArray(payload) ? payload.filter((term): term is string => typeof term === 'string' && term.length > 0 && term.length <= 200).slice(0, MAX_TERMS) : [];
  } catch {
    return [];
  }
}

export async function saveAlwaysHidden(unlock: WalletUnlock, terms: readonly string[]) {
  try {
    const key = await storageKey(unlock.accountId);
    if (terms.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(await encryptPayload(unlock, terms.slice(0, MAX_TERMS))));
  } catch {
    // Storage blocked: the terms still apply for this session.
  }
}
