export interface WalletUnlock {
  accountId: string;
  publicKey: string;
  signature: string;
  walletId: string;
  walletName: string;
}

export interface EncryptedEnvelope {
  app: 'fineprint';
  version: 1;
  algorithm: 'AES-GCM';
  savedAt: string;
  salt: string;
  iv: string;
  ciphertext: string;
}

export const MAX_ENCRYPTED_FILE_BYTES = 120 * 1024 * 1024;
const KEY_PREFIX = 'fineprint.encrypted-history.v1';
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function accountStorageKey(accountId: string) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(accountId.toLocaleLowerCase()));
  return `${KEY_PREFIX}.${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24)}`;
}

async function deriveKey(unlock: WalletUnlock, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${unlock.accountId}\u0000${unlock.publicKey}\u0000${unlock.signature}`),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: encoder.encode(`Fineprint local history v1\u0000${unlock.accountId.toLocaleLowerCase()}`),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function associatedData(savedAt: string) {
  return encoder.encode(`fineprint-history-v1\u0000${savedAt}`);
}

export async function encryptPayload<T>(unlock: WalletUnlock, payload: T): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const savedAt = new Date().toISOString();
  const key = await deriveKey(unlock, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: associatedData(savedAt) },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    app: 'fineprint',
    version: 1,
    algorithm: 'AES-GCM',
    savedAt,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export function parseEnvelope(text: string): EncryptedEnvelope {
  const damaged = new Error('This is not a Veil encrypted file, or it is damaged.');
  if (text.length > MAX_ENCRYPTED_FILE_BYTES * 1.4) throw new Error('This file is too large to be a Veil history.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw damaged;
  }
  if (!value || typeof value !== 'object') throw damaged;
  const candidate = value as Record<string, unknown>;
  const { app, version, algorithm, savedAt, salt, iv, ciphertext } = candidate;
  if (app !== 'fineprint' || version !== 1 || algorithm !== 'AES-GCM') throw damaged;
  if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) throw damaged;
  for (const field of [salt, iv, ciphertext]) {
    if (typeof field !== 'string' || !BASE64.test(field)) throw damaged;
  }
  const envelope: EncryptedEnvelope = {
    app: 'fineprint',
    version: 1,
    algorithm: 'AES-GCM',
    savedAt,
    salt: salt as string,
    iv: iv as string,
    ciphertext: ciphertext as string,
  };
  if (fromBase64(envelope.salt).length !== 16 || fromBase64(envelope.iv).length !== 12) throw damaged;
  return envelope;
}

export async function decryptEnvelope<T>(unlock: WalletUnlock, envelope: EncryptedEnvelope): Promise<{ payload: T; savedAt: string }> {
  try {
    const key = await deriveKey(unlock, fromBase64(envelope.salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv), additionalData: associatedData(envelope.savedAt) },
      key,
      fromBase64(envelope.ciphertext),
    );
    return { payload: JSON.parse(decoder.decode(plaintext)) as T, savedAt: envelope.savedAt };
  } catch {
    throw new Error('This history cannot be unlocked by the connected wallet key.');
  }
}

export async function saveEncryptedHistory<T>(unlock: WalletUnlock, payload: T) {
  const envelope = await encryptPayload(unlock, payload);
  localStorage.setItem(await accountStorageKey(unlock.accountId), JSON.stringify(envelope));
  return envelope.savedAt;
}

export async function loadEncryptedHistory<T>(unlock: WalletUnlock): Promise<{ payload: T; savedAt: string } | null> {
  const stored = localStorage.getItem(await accountStorageKey(unlock.accountId));
  if (!stored) return null;
  return decryptEnvelope<T>(unlock, parseEnvelope(stored));
}

export async function deleteEncryptedHistory(accountId: string) {
  localStorage.removeItem(await accountStorageKey(accountId));
}

export async function hasEncryptedHistory(accountId: string) {
  return localStorage.getItem(await accountStorageKey(accountId)) !== null;
}

/** Builds the downloadable encrypted file. Only the wallet signature that produced the key can open it. */
export async function exportEncryptedFile<T>(unlock: WalletUnlock, payload: T): Promise<{ blob: Blob; filename: string; savedAt: string }> {
  const envelope = await encryptPayload(unlock, payload);
  return {
    blob: new Blob([JSON.stringify(envelope)], { type: 'application/json' }),
    filename: `veil-chats-${envelope.savedAt.slice(0, 10)}.veil`,
    savedAt: envelope.savedAt,
  };
}

export async function importEncryptedFile<T>(unlock: WalletUnlock, text: string) {
  return decryptEnvelope<T>(unlock, parseEnvelope(text));
}
