import { GATEWAY_BASE_URL, acceptedTcb } from '../gate/gate';
import { sharedBaseUrl } from '../shared/client';
import { PROMPT_VERSION, SYSTEM_PROMPT, repairPrompt, userPrompt } from './prompt';
import { type LeaseReport, parseReport } from './schema';

/** none: the provider does not sign responses (not an enclave provider). unsigned: a signature was expected and never arrived. */
export type SignatureStatus = 'provider_tee' | 'gateway' | 'unsigned' | 'none';

export interface SignedCompletion {
  signatureKind: 'provider_tee' | 'gateway';
  signingAlgo: string;
  signingAddress: string;
  signedText: string;
  signature: string;
  tcbStatus: string;
  advisoryIds: string[];
  composeHash: string;
  osImageHash: string;
  nonce: string;
}

export interface ChatMessageBody {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AnalysisTransport {
  complete(messages: ChatMessageBody[], model: string, signal: AbortSignal, options?: CompletionOptions): Promise<{ id: string; text: string }>;
  /** Streams the reply; onText receives the whole text so far. */
  stream?(messages: ChatMessageBody[], model: string, signal: AbortSignal, onText: (text: string) => void, options?: CompletionOptions): Promise<{ id: string; text: string }>;
  verifyResponse?(id: string): Promise<SignedCompletion>;
  /** Verifies and caches the enclave evidence ahead of the first message. */
  warm?(model: string): Promise<void>;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
}

export type AnalysisStage = 'sending' | 'signature';

export interface AnalysisOutcome {
  report: LeaseReport;
  completionId: string;
  model: string;
  signatureStatus: SignatureStatus;
  signed?: SignedCompletion;
  completedAt: string;
  promptVersion: string;
}

export interface AnalyzeOptions {
  outgoing: string;
  model: string;
  signal: AbortSignal;
  transport: AnalysisTransport;
  onStage?: (stage: AnalysisStage) => void;
  wait?: (ms: number) => Promise<void>;
  /** Return as soon as the report parses; the caller checks the signature with verifyCompletion afterwards. */
  deferSignature?: boolean;
}

export class AnalysisError extends Error {
  constructor(message: string, readonly raw?: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}

const SIGNATURE_ATTEMPTS = 3;
const SIGNATURE_DELAY_MS = 1000;
const MAX_TOKENS = 8000;

/** Your own key goes straight to the gateway. A shared session goes to the same-origin proxy, which adds the server's key. */
export type SdkCredential = { kind: 'own'; apiKey: string } | { kind: 'shared' };

/**
 * The SDK client. Built only after the gate has passed. With a shared session the SDK still verifies the enclave
 * and encrypts end to end; the proxy forwards ciphertext and never sees the masked text.
 */
export async function createSdkTransport(credential: SdkCredential, strict: boolean): Promise<AnalysisTransport> {
  const { InferenceClient } = await import('@nearai/inference-sdk');
  const accepted = acceptedTcb(strict);
  const client = new InferenceClient({
    ...(credential.kind === 'own'
      ? { baseUrl: GATEWAY_BASE_URL, apiKey: credential.apiKey }
      : { baseUrl: sharedBaseUrl() }),
    e2ee: true,
    signingAlgo: 'ed25519',
    // Reuse the verified key for the one repair retry; a new client (and nonce) is built for every analysis.
    attestationCacheTimeToLiveMs: 10 * 60_000,
    gatewayVerification: { policy: { acceptedTcbStatuses: accepted } },
    modelVerification: { policy: { acceptedTcbStatuses: accepted, gpuEvidence: 'required' } },
  });
  return {
    async complete(messages, model, signal, options) {
      const completion = await client.chat.completions.create(
        { model, messages, stream: false, temperature: options?.temperature ?? 0.2, max_tokens: options?.maxTokens ?? MAX_TOKENS },
        { headers: { 'x-no-aliasing': 'true' }, signal },
      );
      return { id: completion.id, text: completion.choices[0]?.message.content ?? '' };
    },
    async stream(messages, model, signal, onText, options) {
      const stream = await client.chat.completions.create(
        { model, messages, stream: true, temperature: options?.temperature ?? 0.2, max_tokens: options?.maxTokens ?? MAX_TOKENS },
        { headers: { 'x-no-aliasing': 'true' }, signal },
      );
      let id = '';
      let text = '';
      for await (const chunk of stream) {
        if (!id && chunk.id) id = chunk.id;
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          text += delta;
          onText(text);
        }
      }
      return { id, text };
    },
    async warm(model) {
      await client.verify(model);
    },
    async verifyResponse(id) {
      const result = await client.verifyResponse(id);
      const attestation = result.signatureKind === 'provider_tee' ? result.attestations[0] ?? result.attestation : result.attestation;
      const runtime = attestation.deployment.runtimeMeasurements;
      return {
        signatureKind: result.signatureKind,
        signingAlgo: result.signature.signer.signingAlgo,
        signingAddress: result.signature.signer.signingAddress,
        signedText: result.signature.signedText,
        signature: result.signature.signature,
        tcbStatus: attestation.tcbStatus,
        advisoryIds: [...attestation.advisoryIds],
        composeHash: runtime.composeHash ?? '',
        osImageHash: runtime.osImageHash ?? '',
        nonce: attestation.report.nonce,
      };
    },
  };
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Fetches and checks the response signature, retrying while NEAR AI publishes it. Undefined when none arrives. */
export async function verifyCompletion(
  transport: AnalysisTransport,
  id: string,
  signal?: AbortSignal,
  wait: (ms: number) => Promise<void> = defaultWait,
): Promise<SignedCompletion | undefined> {
  const verify = transport.verifyResponse;
  if (!verify || !id) return undefined;
  for (let attempt = 1; attempt <= SIGNATURE_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    try {
      return await verify.call(transport, id);
    } catch {
      if (attempt < SIGNATURE_ATTEMPTS) await wait(SIGNATURE_DELAY_MS);
    }
  }
  return undefined;
}

function verifySignature(options: AnalyzeOptions, id: string) {
  return verifyCompletion(options.transport, id, options.signal, options.wait);
}

export async function analyze(options: AnalyzeOptions): Promise<AnalysisOutcome> {
  const { outgoing, model, signal, transport, onStage } = options;
  onStage?.('sending');
  const messages: ChatMessageBody[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(outgoing) },
  ];
  let completion = await transport.complete(messages, model, signal);
  let parsed = parseReport(completion.text);
  if (!parsed.ok) {
    const reason = parsed.error;
    completion = await transport.complete(
      [...messages, { role: 'assistant', content: completion.text }, { role: 'user', content: repairPrompt(reason) }],
      model,
      signal,
    );
    parsed = parseReport(completion.text);
    if (!parsed.ok) throw new AnalysisError(`The model reply did not match the report schema (${parsed.error}).`, completion.text);
  }

  const base = {
    report: parsed.report,
    completionId: completion.id,
    model,
    completedAt: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
  };
  if (!transport.verifyResponse) return { ...base, signatureStatus: 'none' };
  if (options.deferSignature) return { ...base, signatureStatus: 'unsigned' };

  onStage?.('signature');
  const signed = await verifySignature(options, completion.id);
  return signed
    ? { ...base, signatureStatus: signed.signatureKind, signed }
    : { ...base, signatureStatus: 'unsigned' };
}
