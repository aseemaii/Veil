import { matchQuote } from '../analyze/quotes';
import type { AnalysisRecord } from '../history/session';
import { restore, type PlaceholderMap } from '../mask/masker';
import { verificationCenterUrl } from '../receipt/receipt';

const SEVERITY_GLYPH = { high: '◆', medium: '◐', low: '◇' } as const;
const SEVERITY_WORD = { high: 'High', medium: 'Medium', low: 'Low' } as const;

interface ReportProps {
  record: AnalysisRecord;
  outgoing: string;
  map: PlaceholderMap;
  showNames: boolean;
  onShowNames: (value: boolean) => void;
  onDownload?: () => void;
  onRunAgain?: () => void;
  /** True while the signature is still being fetched after the report was shown. */
  checkingSignature?: boolean;
}

export function Report({ record, outgoing, map, showNames, onShowNames, onDownload, onRunAgain, checkingSignature }: ReportProps) {
  const { report } = record;
  const show = (value: string) => (showNames ? restore(value, map) : value);
  const status = record.signatureStatus;
  const checking = checkingSignature && status === 'unsigned';

  return (
    <article className="report" aria-label="Lease report">
      <header className="report-head">
        <div>
          <h2>Lease report</h2>
          <p className={`seal seal--${status === 'provider_tee' ? 'ok' : checking ? 'wait' : 'warn'}`}>
            <span aria-hidden="true">{status === 'provider_tee' ? '◈' : checking ? '◌' : '◇'}</span>
            {checking && 'Checking the model signature. The report is ready to read meanwhile.'}
            {status === 'provider_tee' && `Signed by the model. Signer ${record.receipt?.near.signingAddress.slice(0, 10) ?? ''}… matches a verified enclave key.`}
            {status === 'gateway' && 'Signed by the gateway only. This does not show the model ran in an enclave.'}
            {status === 'unsigned' && !checking && 'No signature came back after 3 tries. Treat this report as unverified.'}
            {status === 'none' && 'This provider does not sign responses and has no hardware privacy guarantee. The masked text was sent as ordinary HTTPS content.'}
          </p>
        </div>
        <fieldset className="view-tabs">
          <legend className="sr">Names</legend>
          <button type="button" aria-pressed={!showNames} onClick={() => onShowNames(false)}>Show masked</button>
          <button type="button" aria-pressed={showNames} onClick={() => onShowNames(true)}>Show names</button>
        </fieldset>
      </header>

      <section>
        <h3 className="t">Summary</h3>
        <p className="report-summary">{show(report.summary)}</p>
      </section>

      {report.keyTerms.length > 0 && (
        <section>
          <h3 className="t">Key terms</h3>
          <dl className="kv kv--terms">
            {report.keyTerms.map((term, index) => (
              <div key={`${term.term}-${index}`}><dt>{term.label}</dt><dd>{show(term.value)}</dd></div>
            ))}
          </dl>
        </section>
      )}

      <section>
        <h3 className="t">Risky clauses</h3>
        {report.riskyClauses.length === 0 && <p className="muted">No risky clauses were reported.</p>}
        {report.riskyClauses.map((clause) => {
          const found = matchQuote(clause.quote, outgoing);
          return (
            <div className={`clause clause--${clause.severity}`} key={clause.id}>
              <div className="clause-quote">
                <p className="sev"><span aria-hidden="true">{SEVERITY_GLYPH[clause.severity]}</span> {SEVERITY_WORD[clause.severity]} · {show(clause.title)}</p>
                <blockquote className={found ? '' : 'unmatched'}>{show(clause.quote)}</blockquote>
                {!found && <p className="unmatched-note">Not found in the text we sent.</p>}
              </div>
              <div className="clause-margin">
                <p><b>Why it matters</b>{show(clause.why)}</p>
                <p><b>Ask the landlord</b>{show(clause.askLandlord)}</p>
              </div>
            </div>
          );
        })}
      </section>

      {report.missingOrUnusual.length > 0 && (
        <section>
          <h3 className="t">Missing or unusual</h3>
          <ul className="plain-list">
            {report.missingOrUnusual.map((item, index) => <li key={`${item.title}-${index}`}><b>{show(item.title)}</b> {show(item.why)}</li>)}
          </ul>
        </section>
      )}

      {report.datesAndObligations.length > 0 && (
        <section>
          <h3 className="t">Dates and obligations</h3>
          <ul className="plain-list">
            {report.datesAndObligations.map((item, index) => <li key={`${item.what}-${index}`}><b>{item.who}</b> {show(item.what)} <span className="muted">({show(item.when)})</span></li>)}
          </ul>
        </section>
      )}

      <footer className="report-foot">
        <p>Not legal advice. The model can be wrong.</p>
        <div className="row">
          {record.receipt && onDownload && <button className="btn primary sm" type="button" onClick={onDownload}>Download receipt</button>}
          {record.receipt && <a className="btn sm" href={verificationCenterUrl(record.receipt)} target="_blank" rel="noreferrer">Open in Verification Center</a>}
          {onRunAgain && <button className="btn sm" type="button" onClick={onRunAgain}>Run the checks again</button>}
        </div>
      </footer>
    </article>
  );
}
