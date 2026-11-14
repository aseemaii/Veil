import { describe, expect, it } from 'vitest';
import { exportEncryptedFile, importEncryptedFile, parseEnvelope, type WalletUnlock } from '../../src/history/crypto';

const wallet: WalletUnlock = {
  accountId: 'tenant.near',
  publicKey: 'ed25519:public-key',
  signature: 'wallet-secret-signature',
  walletId: 'hot-wallet',
  walletName: 'HOT Wallet',
};

describe('encrypted history file', () => {
  it('opens with the same wallet and leaks no plaintext in the file', async () => {
    const payload = { text: 'LEASE_CANARY', name: 'Vikram Mehta' };
    const { blob, filename } = await exportEncryptedFile(wallet, payload);
    const contents = await blob.text();
    expect(filename).toMatch(/^veil-chats-\d{4}-\d{2}-\d{2}\.veil$/);
    for (const secret of ['LEASE_CANARY', 'Vikram', wallet.accountId, wallet.signature]) expect(contents).not.toContain(secret);
    await expect(importEncryptedFile<typeof payload>(wallet, contents)).resolves.toMatchObject({ payload });
  });

  it('is unreadable to a wallet with a different signature or account', async () => {
    const { blob } = await exportEncryptedFile(wallet, { secret: true });
    const contents = await blob.text();
    await expect(importEncryptedFile({ ...wallet, signature: 'other' }, contents)).rejects.toThrow('cannot be unlocked');
    await expect(importEncryptedFile({ ...wallet, accountId: 'someone.near' }, contents)).rejects.toThrow('cannot be unlocked');
  });

  it('detects tampering with the ciphertext or the timestamp', async () => {
    const { blob } = await exportEncryptedFile(wallet, { secret: true });
    const envelope = JSON.parse(await blob.text()) as Record<string, string>;
    const flipped = { ...envelope, ciphertext: `${envelope.ciphertext?.startsWith('A') ? 'B' : 'A'}${envelope.ciphertext?.slice(1)}` };
    await expect(importEncryptedFile(wallet, JSON.stringify(flipped))).rejects.toThrow('cannot be unlocked');
    const retimed = { ...envelope, savedAt: '2020-01-01T00:00:00.000Z' };
    await expect(importEncryptedFile(wallet, JSON.stringify(retimed))).rejects.toThrow('cannot be unlocked');
  });

  it('rejects files that are not Fineprint envelopes', () => {
    for (const text of ['not json', '[]', '{}', JSON.stringify({ app: 'fineprint', version: 2 }), JSON.stringify({ app: 'fineprint', version: 1, algorithm: 'AES-GCM', savedAt: 'x', salt: '!!', iv: '!!', ciphertext: '!!' })]) {
      expect(() => parseEnvelope(text)).toThrow('not a Veil encrypted file');
    }
  });
});
