import { beforeEach, describe, expect, it } from 'vitest';
import { loadEncryptedHistory, saveEncryptedHistory, type WalletUnlock } from '../../src/history/crypto';

const wallet: WalletUnlock = {
  accountId: 'tenant.near',
  publicKey: 'ed25519:public-key',
  signature: 'wallet-secret-signature',
  walletId: 'hot-wallet',
  walletName: 'HOT Wallet',
};

describe('wallet-bound local history', () => {
  beforeEach(() => localStorage.clear());

  it('stores only encrypted content and restores it with the same wallet signature', async () => {
    const payload = { messages: ['PRIVATE_CANARY'], document: 'LEASE_CANARY' };
    await saveEncryptedHistory(wallet, payload);
    const persisted = Object.keys(localStorage).map((key) => `${key}:${localStorage.getItem(key)}`).join('\n');
    expect(localStorage).toHaveLength(1);
    expect(persisted).not.toContain('PRIVATE_CANARY');
    expect(persisted).not.toContain('LEASE_CANARY');
    expect(persisted).not.toContain(wallet.accountId);
    expect(persisted).not.toContain(wallet.signature);
    await expect(loadEncryptedHistory<typeof payload>(wallet)).resolves.toMatchObject({ payload });
  });

  it('fails closed for a different signature', async () => {
    await saveEncryptedHistory(wallet, { message: 'private' });
    await expect(loadEncryptedHistory({ ...wallet, signature: 'different-wallet-signature' })).rejects.toThrow('cannot be unlocked');
  });
});

describe('tab session', () => {
  it('keeps the login for this tab and clears it on logout', async () => {
    const { clearTab, loadTabLogin, saveTabLogin } = await import('../../src/history/tab');
    const unlock = { accountId: 'tenant.near', publicKey: 'ed25519:pk', signature: 'sig', walletId: 'hot', walletName: 'HOT' };
    saveTabLogin(unlock);
    expect(loadTabLogin()).toEqual(unlock);
    sessionStorage.setItem('fineprint.tab-login.v1', JSON.stringify({ accountId: 'x' }));
    expect(loadTabLogin()).toBeUndefined();
    saveTabLogin(unlock);
    clearTab();
    expect(loadTabLogin()).toBeUndefined();
  });
});
