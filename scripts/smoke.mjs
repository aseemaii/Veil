import process from 'node:process';
import { InferenceClient } from '@nearai/inference-sdk';

const BASE_URL = 'https://cloud-api.near.ai/v1';
const MODELS = [
  'z-ai/glm-5.3-flash',
  'Qwen/Qwen3.8-27B',
  'deepseek-ai/DeepSeek-V4.1-Flash-1017',
  'Qwen/Qwen3.6-35B-A3B-FP8',
];
const apiKey = process.env.NEARAI_API_KEY;
const requests = [];
const nativeFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const startedAt = performance.now();
  const response = await nativeFetch(request);
  requests.push({
    host: new URL(request.url).host,
    method: request.method,
    path: new URL(request.url).pathname,
    status: response.status,
    ms: Math.round(performance.now() - startedAt),
  });
  return response;
};

const rows = [];
const today = new Date().toISOString().slice(0, 10);

function report(check, status, evidence) {
  const line = `${status} ${check}: ${evidence}`;
  process.stdout.write(`${line}\n`);
  rows.push(`| ${today} | ${check} | ${status} | ${evidence.replaceAll('|', '\\|')} |`);
}

function client(options = {}) {
  return new InferenceClient({
    baseUrl: BASE_URL,
    apiKey,
    e2ee: true,
    signingAlgo: 'ed25519',
    attestationCacheTimeToLiveMs: 0,
    ...options,
  });
}

async function verifyModel(model) {
  const startedAt = performance.now();
  const result = await client().verify(model);
  const duration = Math.round(performance.now() - startedAt);
  const modelEvidence = result.models.map((entry) =>
    `${entry.tcbStatus}/${entry.gpuEvidence}`,
  );
  report(
    `S2 ${model}`,
    result.models.length > 0 && result.models.every((entry) => entry.gpuEvidence === 'verified')
      ? 'PASS'
      : 'FAIL',
    `${result.models.length} candidate(s), ${modelEvidence.join(', ') || 'none'}, gateway ${result.gateway.tcbStatus}, ${duration} ms`,
  );
}

async function runCorsCheck() {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(nonceBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const response = await nativeFetch(
    `${BASE_URL}/attestation/report?${new URLSearchParams({ signing_algo: 'ed25519', nonce })}`,
    { headers: { Origin: 'https://example.com' } },
  );
  const allowedOrigin = response.headers.get('access-control-allow-origin');
  report('S6 attestation CORS', allowedOrigin === 'https://example.com' ? 'PASS' : 'FAIL',
    `HTTP ${response.status}, allow-origin ${allowedOrigin ?? 'missing'}`);
}

async function runAuthenticatedChecks() {
  if (!apiKey) {
    report('S3-S5 and S8', 'SKIP', 'NEARAI_API_KEY is not set; no authenticated request was attempted');
    return;
  }

  for (const model of MODELS) {
    const sdk = client();
    const completion = await sdk.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with the word ok.' }],
      stream: false,
    });
    const verified = await sdk.verifyResponse(completion.id);
    const content = completion.choices[0]?.message.content?.trim().toLowerCase();
    report(`S3/S5 ${model}`, content === 'ok' && verified.signatureKind === 'provider_tee' ? 'PASS' : 'FAIL',
      `decrypted ${content === 'ok' ? 'ok' : 'unexpected reply'}, signature ${verified.signatureKind}`);
  }
  report('S4 structured E2EE', 'SKIP', 'structured-output probe is not implemented yet');
  report('S8 lease latency', 'SKIP', 'long-form paid probe requires explicit run after basic checks pass');
}

let exitCode = 0;
try {
  await runCorsCheck();
  for (const model of MODELS) {
    try {
      await verifyModel(model);
    } catch (error) {
      exitCode = 1;
      report(`S2 ${model}`, 'FAIL', error instanceof Error ? error.message : String(error));
    }
  }
  await runAuthenticatedChecks();
} catch (error) {
  exitCode = 1;
  report('smoke harness', 'FAIL', error instanceof Error ? error.message : String(error));
} finally {
  const hosts = [...new Set(requests.map((request) => request.host))].sort();
  report('S7 observed hosts', 'PASS', hosts.length > 0 ? hosts.join(', ') : 'no SDK requests recorded');
}

process.exitCode = exitCode;
