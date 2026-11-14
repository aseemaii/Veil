import { checkBaseUrl } from '../providers/custom';
import type { Settings } from './settings';

interface SendPanelProps {
  settings: Settings;
  sharedAvailable: boolean;
  apiKey: string;
  onApiKey: (value: string) => void;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onSend: (mode: 'own' | 'wallet' | 'custom') => void;
  onOpenSettings: () => void;
}

/** Choose who pays for the analysis. Everything except the main choice stays folded until clicked. */
export function SendPanel(props: SendPanelProps) {
  const { settings, sharedAvailable, apiKey, onApiKey, acknowledged, onAcknowledge, onSend, onOpenSettings } = props;
  const keyField = (id: string, label: string, placeholder: string) => (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} name={`fineprint-${id}`} type="password" autoComplete="off" spellCheck={false} data-lpignore="true" value={apiKey} onChange={(event) => onApiKey(event.target.value)} placeholder={placeholder} />
    </>
  );

  if (settings.provider === 'custom') {
    const urlOk = checkBaseUrl(settings.customBaseUrl).ok && settings.customModel.trim().length > 0;
    return (
      <div className="send-box">
        <p className="warn-text"><strong>This provider has no hardware privacy guarantee.</strong> Your masked text is sent to <code>{settings.customBaseUrl || 'the provider you choose'}</code> as ordinary HTTPS content. Veil cannot check the enclave or the response signature.</p>
        {!urlOk && <p className="small muted">Choose a provider URL and model name first. <button className="link" type="button" onClick={onOpenSettings}>Open provider settings</button></p>}
        {keyField('provider-key', 'Provider API key', 'Paste your key (not needed for a local model)')}
        <p className="small muted">Kept in memory. Sent only to that provider. Closing the tab clears it.</p>
        <label className="confirm"><input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledge(event.target.checked)} /> I understand this provider is not verified and will receive the masked text.</label>
        <button className="btn primary" type="button" disabled={!urlOk || !acknowledged} onClick={() => onSend('custom')}>Send redacted text</button>
      </div>
    );
  }

  return (
    <div className="send-box">
      {sharedAvailable && (
        <>
          <button className="btn primary" type="button" onClick={() => onSend('wallet')}>Send for analysis</button>
          <p className="small muted">
            Free, using Veil's key. No extra signature needed. The text is encrypted for the verified enclave
            before it leaves this tab, so Veil's server only passes on ciphertext.
          </p>
        </>
      )}
      <details className="more" open={!sharedAvailable}>
        <summary>Use my own NEAR AI Cloud key</summary>
        {keyField('api-key', 'NEAR AI Cloud API key', 'Paste your key')}
        <p className="small muted">Kept in memory. Sent only to cloud-api.near.ai, and only after the checks pass. Closing the tab clears it.</p>
        <button className="btn primary" type="button" disabled={!apiKey.trim()} onClick={() => onSend('own')}>Send with my key</button>
      </details>
    </div>
  );
}
