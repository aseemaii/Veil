import { describe, expect, it } from 'vitest';
import { type AttestationLike, type GateClient, runGate } from '../../src/gate/gate';

const NONCE = 'a'.repeat(64);

function good(): AttestationLike {
  return {
    gateway: { tcbStatus: 'UpToDate', advisoryIds: [] },
    models: [{
      tcbStatus: 'UpToDate',
      advisoryIds: [],
      gpuEvidence: 'verified',
      signer: { signingAlgo: 'ed25519', signingAddress: '0xsigner' },
      signingPublicKey: 'pub',
      deployment: { runtimeMeasurements: { composeHash: 'compose', osImageHash: 'os' } },
      report: { nonce: NONCE },
    }],
    verifiedAt: Date.UTC(2026, 10, 11, 14, 2),
  };
}

function gate(attestation: () => Promise<AttestationLike>, overrides: { model?: string; strict?: boolean } = {}) {
  const client: GateClient = { verify: attestation };
  return runGate({ model: overrides.model ?? 'z-ai/glm-5.3-flash', strict: overrides.strict ?? false, createClient: async () => client });
}

describe('verify-before-send gate', () => {
  it('passes with good evidence and reports every row as passed', async () => {
    const result = await gate(async () => good());
    expect(result.status).toBe('verified');
    expect(result.rows.every((row) => row.state === 'passed')).toBe(true);
    if (result.status === 'verified') expect(result.summary.signingAddress).toBe('0xsigner');
  });

  it('fails closed when the SDK throws', async () => {
    const result = await gate(async () => { throw new Error('nonce mismatch'); });
    expect(result).toMatchObject({ status: 'failed', failedCheck: 'evidence', reason: 'nonce mismatch' });
    expect(result.rows.filter((row) => row.state === 'not_run').length).toBeGreaterThan(0);
  });

  it('reports a network failure with the next step', async () => {
    const result = await gate(async () => { throw new TypeError('Failed to fetch'); });
    expect(result.status === 'failed' && result.reason).toContain('cloud-api.near.ai');
  });

  it('fails for an Incognito model without calling the network', async () => {
    let called = false;
    const result = await runGate({ model: 'anthropic/claude', strict: false, createClient: async () => { called = true; return { verify: async () => good() }; } });
    expect(result).toMatchObject({ status: 'failed', failedCheck: 'allowlist' });
    expect(called).toBe(false);
  });

  const faults: Array<[string, (value: AttestationLike) => void, string]> = [
    ['empty candidates', (value) => { value.models = []; }, 'candidates'],
    ['GPU evidence missing', (value) => { value.models[0]!.gpuEvidence = 'not_provided'; }, 'gpu'],
    ['revoked model TCB', (value) => { value.models[0]!.tcbStatus = 'Revoked'; }, 'model-tcb'],
    ['revoked gateway TCB', (value) => { value.gateway.tcbStatus = 'Revoked'; }, 'gateway'],
    ['no model key', (value) => { value.models[0]!.signingPublicKey = undefined; }, 'signer'],
    ['short nonce', (value) => { value.models[0]!.report.nonce = 'abcd'; }, 'signer'],
    ['non-ed25519 signer', (value) => { value.models[0]!.signer.signingAlgo = 'ecdsa'; }, 'signer'],
    ['missing compose hash', (value) => { value.models[0]!.deployment.runtimeMeasurements.composeHash = undefined; }, 'measurements'],
  ];
  for (const [name, mutate, check] of faults) {
    it(`fails on ${name} and names the ${check} check`, async () => {
      const result = await gate(async () => { const value = good(); mutate(value); return value; });
      expect(result).toMatchObject({ status: 'failed', failedCheck: check });
    });
  }

  it('accepts OutOfDate by default but not in strict mode', async () => {
    const outOfDate = async () => { const value = good(); value.models[0]!.tcbStatus = 'OutOfDate'; return value; };
    expect((await gate(outOfDate)).status).toBe('verified');
    expect(await gate(outOfDate, { strict: true })).toMatchObject({ status: 'failed', failedCheck: 'model-tcb' });
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    const pending = runGate({
      model: 'z-ai/glm-5.3-flash',
      strict: false,
      signal: controller.signal,
      createClient: async () => ({ verify: () => new Promise<AttestationLike>(() => undefined) }),
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
