import type { CheckRow, VerifiedSummary } from '../gate/gate';

const icon = { passed: '✓', failed: '✕', pending: '○', not_run: '–' } as const;

/** One-line summary of the enclave checks; the full list opens on click (or stays open when a check failed). */
export function GateList({ rows, verified }: { rows: CheckRow[]; verified?: VerifiedSummary | undefined }) {
  if (rows.length === 0) return null;
  const passed = rows.filter((row) => row.state === 'passed').length;
  const failed = rows.some((row) => row.state === 'failed');
  return (
    <details className="more gate-more" open={failed}>
      <summary>{failed ? 'A check failed' : `${passed} of ${rows.length} enclave checks passed`}. Show the checks</summary>
      <ul className="gate">
        {rows.map((row) => (
          <li key={row.id} className={row.state}>
            <span className="ic" aria-hidden="true">{icon[row.state]}</span>
            <span>{row.label}{row.detail && <code>{row.detail}</code>}</span>
            <span className="badge">{row.state.replace('_', ' ')}{row.ms !== undefined ? ` · ${(row.ms / 1000).toFixed(1)}s` : ''}</span>
          </li>
        ))}
      </ul>
      {verified && (
        <dl className="kv">
          <dt>Signer</dt><dd>{verified.signingAddress}</dd>
          <dt>TCB</dt><dd>{verified.gatewayTcb} / {verified.modelTcb}{verified.advisoryIds.length ? ` · ${verified.advisoryIds.join(', ')}` : ''}</dd>
          <dt>Compose</dt><dd>{verified.composeHash}</dd>
        </dl>
      )}
      <p className="muted small">Measurements are verified, not checked against an allowlist. This browser cannot bind its TLS connection to the gateway attestation; encryption to the verified model key protects the content on that path.</p>
    </details>
  );
}
