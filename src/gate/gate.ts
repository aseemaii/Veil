export const GATEWAY_BASE_URL = 'https://cloud-api.near.ai/v1';

export interface TeeModel {
  id: string;
  label: string;
}

/** SRS E11: the only models with a hardware privacy guarantee. */
export const PRIVATE_TEE_MODELS: readonly TeeModel[] = [
  { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash' },
  { id: 'Qwen/Qwen3.8-27B', label: 'Qwen 3.8 27B' },
  { id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', label: 'DeepSeek V4.1 Flash' },
  { id: 'Qwen/Qwen3.6-35B-A3B-FP8', label: 'Qwen 3.6 35B' },
];

export const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';

export function isAllowedModel(id: unknown): id is string {
  return typeof id === 'string' && PRIVATE_TEE_MODELS.some((model) => model.id === id);
}

export type CheckState = 'pending' | 'passed' | 'failed' | 'not_run';

export interface CheckRow {
  id: string;
  label: string;
  state: CheckState;
  detail?: string;
  ms?: number;
  at?: string;
}

/** The parts of the SDK's verification result that the gate re-checks independently. */
export interface AttestationLike {
  gateway: { tcbStatus: string; advisoryIds: readonly string[] };
  models: ReadonlyArray<{
    tcbStatus: string;
    advisoryIds: readonly string[];
    gpuEvidence: string;
    signer: { signingAlgo: string; signingAddress: string };
    signingPublicKey?: string | undefined;
    deployment: { runtimeMeasurements: { composeHash?: string | undefined; osImageHash?: string | undefined } };
    report: { nonce: string };
  }>;
  verifiedAt: number;
}

export interface GateClient {
  verify(model: string): Promise<AttestationLike>;
}

export interface VerifiedSummary {
  model: string;
  verifiedAt: string;
  gatewayTcb: string;
  modelTcb: string;
  advisoryIds: string[];
  signingAddress: string;
  composeHash: string;
  osImageHash: string;
  nonce: string;
  candidates: number;
}

export type GateResult =
  | { status: 'verified'; rows: CheckRow[]; summary: VerifiedSummary }
  | { status: 'failed'; failedCheck: string; reason: string; rows: CheckRow[] };

export interface GateOptions {
  model: string;
  strict: boolean;
  signal?: AbortSignal;
  onRow?: (row: CheckRow) => void;
  createClient?: (strict: boolean) => Promise<GateClient>;
}

const HEX_64 = /^[0-9a-f]{64}$/i;

export function acceptedTcb(strict: boolean): Array<'UpToDate' | 'OutOfDate'> {
  return strict ? ['UpToDate'] : ['UpToDate', 'OutOfDate'];
}

/** Creates the SDK client used for evidence only: it has no API key, so no credential leaves before the gate passes. */
export async function createEvidenceClient(strict: boolean): Promise<GateClient> {
  const { InferenceClient } = await import('@nearai/inference-sdk');
  const accepted = acceptedTcb(strict);
  return new InferenceClient({
    baseUrl: GATEWAY_BASE_URL,
    e2ee: true,
    signingAlgo: 'ed25519',
    attestationCacheTimeToLiveMs: 0,
    gatewayVerification: { policy: { acceptedTcbStatuses: accepted } },
    modelVerification: { policy: { acceptedTcbStatuses: accepted, gpuEvidence: 'required' } },
  });
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Cancelled', 'AbortError'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function fail(rows: CheckRow[], onRow: ((row: CheckRow) => void) | undefined, failedCheck: string, reason: string): GateResult {
  const row = rows.find((entry) => entry.id === failedCheck);
  if (row) {
    row.state = 'failed';
    row.detail = reason;
    row.at = new Date().toISOString();
    onRow?.({ ...row });
  }
  for (const pending of rows) {
    if (pending.state === 'pending') {
      pending.state = 'not_run';
      onRow?.({ ...pending });
    }
  }
  return { status: 'failed', failedCheck, reason, rows };
}

function describeError(error: unknown) {
  if (error instanceof TypeError) return "Couldn't reach cloud-api.near.ai. Check your connection and try again.";
  return error instanceof Error && error.message ? error.message : 'The enclave evidence could not be verified.';
}

export const GATE_ROWS: ReadonlyArray<Pick<CheckRow, 'id' | 'label'>> = [
  { id: 'allowlist', label: 'Model has a hardware privacy guarantee' },
  { id: 'evidence', label: 'Gateway and model evidence verified with a fresh nonce' },
  { id: 'gateway', label: 'Gateway TCB status accepted' },
  { id: 'candidates', label: 'Model evidence returned and every candidate checked' },
  { id: 'model-tcb', label: 'Model TCB status accepted' },
  { id: 'gpu', label: 'NVIDIA GPU evidence verified' },
  { id: 'signer', label: 'Signing key bound to the quote' },
  { id: 'measurements', label: 'Deployment measurements verified' },
];

/**
 * Runs the verify-before-send gate. The SDK performs the DCAP, nonce, RTMR3, MRCONFIGID and NRAS checks and throws
 * on any failure; the gate then re-checks the policy facts it relies on, so a lenient result cannot pass.
 */
export async function runGate(options: GateOptions): Promise<GateResult> {
  const { model, strict, signal, onRow, createClient = createEvidenceClient } = options;
  const rows: CheckRow[] = GATE_ROWS.map((row) => ({ ...row, state: 'pending' as CheckState }));
  const emit = (id: string, patch: Partial<CheckRow>) => {
    const row = rows.find((entry) => entry.id === id);
    if (!row) return;
    Object.assign(row, patch, { at: new Date().toISOString() });
    onRow?.({ ...row });
  };

  if (!isAllowedModel(model)) {
    return fail(rows, onRow, 'allowlist', 'No hardware privacy guarantee for this model. Choose a Private TEE model.');
  }
  emit('allowlist', { state: 'passed' });

  const started = performance.now();
  let attestation: AttestationLike;
  try {
    const client = await abortable(createClient(strict), signal);
    attestation = await abortable(client.verify(model), signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return fail(rows, onRow, 'evidence', describeError(error));
  }
  emit('evidence', { state: 'passed', ms: Math.round(performance.now() - started) });

  const accepted: string[] = acceptedTcb(strict);
  if (!accepted.includes(attestation.gateway.tcbStatus)) {
    return fail(rows, onRow, 'gateway', `Gateway TCB status is ${attestation.gateway.tcbStatus}${strict ? ' (strict mode needs UpToDate)' : ''}.`);
  }
  emit('gateway', { state: 'passed', detail: attestation.gateway.tcbStatus });

  if (attestation.models.length === 0) {
    return fail(rows, onRow, 'candidates', 'The gateway returned no model attestation. Nothing was sent.');
  }
  emit('candidates', { state: 'passed', detail: `${attestation.models.length} candidate${attestation.models.length === 1 ? '' : 's'}` });

  for (const entry of attestation.models) {
    if (!accepted.includes(entry.tcbStatus)) {
      return fail(rows, onRow, 'model-tcb', `Model TCB status is ${entry.tcbStatus}${strict ? ' (strict mode needs UpToDate)' : ''}.`);
    }
  }
  const worst = attestation.models.some((entry) => entry.tcbStatus !== 'UpToDate') ? 'OutOfDate' : 'UpToDate';
  emit('model-tcb', { state: 'passed', detail: worst });

  if (!attestation.models.every((entry) => entry.gpuEvidence === 'verified')) {
    return fail(rows, onRow, 'gpu', 'The GPU evidence was missing or did not verify.');
  }
  emit('gpu', { state: 'passed' });

  const first = attestation.models[0];
  if (!first) return fail(rows, onRow, 'candidates', 'The gateway returned no model attestation. Nothing was sent.');
  for (const entry of attestation.models) {
    if (entry.signer.signingAlgo !== 'ed25519' || !entry.signer.signingAddress || !entry.signingPublicKey || !HEX_64.test(entry.report.nonce)) {
      return fail(rows, onRow, 'signer', 'A model candidate had no Ed25519 signer, no model key, or a nonce that is not 32 bytes.');
    }
  }
  emit('signer', { state: 'passed', detail: first.signer.signingAddress });

  for (const entry of attestation.models) {
    if (!entry.deployment.runtimeMeasurements.composeHash) {
      return fail(rows, onRow, 'measurements', 'A model candidate had no authenticated compose hash.');
    }
  }
  emit('measurements', { state: 'passed' });

  return {
    status: 'verified',
    rows,
    summary: {
      model,
      verifiedAt: new Date(attestation.verifiedAt).toISOString(),
      gatewayTcb: attestation.gateway.tcbStatus,
      modelTcb: worst,
      advisoryIds: [...new Set([...attestation.gateway.advisoryIds, ...attestation.models.flatMap((entry) => [...entry.advisoryIds])])],
      signingAddress: first.signer.signingAddress,
      composeHash: first.deployment.runtimeMeasurements.composeHash ?? '',
      osImageHash: first.deployment.runtimeMeasurements.osImageHash ?? '',
      nonce: first.report.nonce,
      candidates: attestation.models.length,
    },
  };
}
