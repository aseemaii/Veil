import type { SignedCompletion } from '../analyze/client';
import type { LeaseReport } from '../analyze/schema';
import { PROMPT_VERSION } from '../analyze/prompt';

export interface Receipt {
  schemaVersion: 1;
  mode: 'live';
  near: {
    completionId: string;
    model: string;
    signatureKind: 'provider_tee' | 'gateway';
    signingAlgo: string;
    signingAddress: string;
    signedText: string;
    signature: string;
    verifiedAt: string;
  };
  /** Added by Veil, not signed by NEAR AI. */
  app: {
    nonce: string;
    tcbStatus: string;
    advisoryIds: string[];
    composeHash: string;
    osImageHash: string;
    outgoingTextSha256: string;
    reportSha256: string;
    appVersion: string;
    gitCommit: string;
    promptVersion: string;
  };
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildReceipt(input: {
  completionId: string;
  model: string;
  signed: SignedCompletion;
  outgoing: string;
  report: LeaseReport;
  verifiedAt: string;
}): Promise<Receipt> {
  const { signed } = input;
  return {
    schemaVersion: 1,
    mode: 'live',
    near: {
      completionId: input.completionId,
      model: input.model,
      signatureKind: signed.signatureKind,
      signingAlgo: signed.signingAlgo,
      signingAddress: signed.signingAddress,
      signedText: signed.signedText,
      signature: signed.signature,
      verifiedAt: input.verifiedAt,
    },
    app: {
      nonce: signed.nonce,
      tcbStatus: signed.tcbStatus,
      advisoryIds: signed.advisoryIds,
      composeHash: signed.composeHash,
      osImageHash: signed.osImageHash,
      outgoingTextSha256: await sha256Hex(input.outgoing),
      reportSha256: await sha256Hex(JSON.stringify(input.report)),
      appVersion: __APP_VERSION__,
      gitCommit: __GIT_COMMIT__,
      promptVersion: PROMPT_VERSION,
    },
  };
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SRS E9: the reply receipt travels in the URL fragment, which browsers never send to a server. */
export interface SignatureFields {
  completionId: string;
  model: string;
  signatureKind: string;
  signingAlgo: string;
  signingAddress: string;
  signedText: string;
  signature: string;
}

/** NEAR AI's verification center, pre-filled with one response signature so anyone can re-check it. */
export function signatureVerifyUrl(fields: SignatureFields) {
  const { completionId, model, signatureKind, signingAlgo, signingAddress, signedText, signature } = fields;
  const payload = base64Url(JSON.stringify({ completionId, model, signatureKind, signingAlgo, signingAddress, signedText, signature }));
  return `https://cloud.near.ai/verify?model=${encodeURIComponent(model)}#receipt=${payload}`;
}

/** NEAR AI's verification center for a model's enclave evidence. */
export function enclaveVerifyUrl(model: string) {
  return `https://cloud.near.ai/verify?model=${encodeURIComponent(model)}`;
}

export function verificationCenterUrl(receipt: Receipt) {
  return signatureVerifyUrl(receipt.near);
}
