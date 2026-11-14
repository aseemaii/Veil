import type { AccountWithSignedMessage, NearConnector, NearWalletBase } from '@hot-labs/near-connect';
import type { WalletUnlock } from '../history/crypto';

export const WALLET_UNLOCK_MESSAGE = 'Unlock encrypted Fineprint history on this device. This does not submit a transaction.';
// Wallet code runs in a sandboxed srcdoc iframe that inherits the page CSP and injects inline scripts of its own,
// so the CSP allows 'unsafe-inline' (a nonce would disable it). The nonce is kept for the library's own tags.
const CSP_NONCE = 'fineprint-wallet';
const SIGN_TIMEOUT_MS = 120_000;
let connector: NearConnector | undefined;
let connectedWallet: NearWalletBase | undefined;

async function getConnector() {
  if (connector) return connector;
  const { NearConnector: Connector } = await import('@hot-labs/near-connect');
  connector = new Connector({
    network: 'mainnet',
    providers: { mainnet: ['https://free.rpc.fastnear.com', 'https://rpc.mainnet.near.org'] },
    features: { signInAndSignMessage: true },
    footerBranding: {
      heading: 'Veil',
      link: 'https://near.ai',
      linkText: 'Private lease review',
    },
    cspNonce: CSP_NONCE,
  });
  return connector;
}

/** Loads the wallet library and its wallet list ahead of the click, so the selector opens at once. */
export function preloadWallet() {
  void getConnector().catch(() => {
    connector = undefined;
  });
}

async function unlockNonce() {
  const origin = window.location.origin || 'fineprint.local';
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`fineprint-history-v1\u0000${origin}`)));
}

export async function connectNearWallet(): Promise<WalletUnlock> {
  const near = await getConnector();
  let timeout = 0;
  let resolveAccount: (account: AccountWithSignedMessage) => void = () => undefined;
  let rejectAccount: (error: Error) => void = () => undefined;
  const signedAccount = new Promise<AccountWithSignedMessage>((resolve, reject) => {
    resolveAccount = resolve;
    rejectAccount = reject;
  });
  // The wallet may reject before we await; avoid an unhandled rejection.
  signedAccount.catch(() => undefined);
  const onSignedMessage = ({ accounts, success }: { accounts: AccountWithSignedMessage[]; success: boolean }) => {
    const account = accounts[0];
    if (!success || !account) rejectAccount(new Error('The selected NEAR wallet did not return an account.'));
    else resolveAccount(account);
  };
  near.on('wallet:signInAndSignMessage', onSignedMessage);
  timeout = window.setTimeout(() => rejectAccount(new Error('The selected NEAR wallet did not return a signed unlock message.')), SIGN_TIMEOUT_MS);
  try {
    connectedWallet = await near.connect({
      signMessageParams: {
        message: WALLET_UNLOCK_MESSAGE,
        recipient: window.location.host || 'fineprint.local',
        nonce: await unlockNonce(),
      },
    });
    const account = await signedAccount;
    const { publicKey, signature } = account.signedMessage;
    if (!account.accountId || !publicKey || !signature) {
      throw new Error('The wallet returned an incomplete signature. Try another wallet.');
    }
    return {
      accountId: account.accountId,
      publicKey,
      signature,
      walletId: connectedWallet.manifest.id,
      walletName: connectedWallet.manifest.name,
    };
  } finally {
    window.clearTimeout(timeout);
    near.off('wallet:signInAndSignMessage', onSignedMessage);
  }
}

export async function disconnectNearWallet() {
  const wallet = connectedWallet;
  connectedWallet = undefined;
  if (!wallet || !connector) return;
  await connector.disconnect(wallet);
}

