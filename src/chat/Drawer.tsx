import type { ReactNode } from 'react';
import { PRIVATE_TEE_MODELS } from '../gate/gate';
import type { LedgerEntry } from '../ledger/fetch';
import { checkBaseUrl, PROVIDER_PRESETS } from '../providers/custom';
import { categoryLabels } from './review';
import type { Settings } from './settings';
import type { Proposal } from '../detect';

export type DrawerSection = 'model' | 'history' | 'ledger' | 'masks' | 'hidden' | 'more';

interface DrawerProps {
  open: boolean;
  focus: DrawerSection;
  nonce: number;
  onClose: () => void;
  settings: Settings;
  onSettings: (next: Settings) => void;
  busy: boolean;
  ledger: readonly LedgerEntry[];
  carried: number;
  vaultStatus: string;
  canSave: boolean;
  onDownload: () => void;
  onOpenFile: () => void;
  onSaveBrowser: () => void;
  onDeleteSaved: () => void;
  proposals: Proposal[];
  accepted: Set<string>;
  placeholders: Map<string, string>;
  onToggleMask: (id: string) => void;
  onClear: () => void;
  apiKey: string;
  onApiKey: (value: string) => void;
  chats: Array<{ id: string; title: string; updatedAt: string; current: boolean; hasDocument: boolean }>;
  onOpenChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  alwaysHidden: string[];
  onForgetHidden: (value: string) => void;
  sharedAvailable: boolean;
}

function Section({ id, title, focus, nonce, children }: { id: DrawerSection; title: string; focus: DrawerSection; nonce: number; children: ReactNode }) {
  return (
    <details className="drawer-section" key={`${id}-${nonce}`} open={focus === id}>
      <summary>{title}</summary>
      <div className="drawer-body">{children}</div>
    </details>
  );
}

/** Everything that is not the conversation lives here and stays folded until asked for. */
export function Drawer(props: DrawerProps) {
  const { open, focus, nonce, onClose, settings, onSettings, busy } = props;
  if (!open) return null;
  const urlCheck = settings.customBaseUrl ? checkBaseUrl(settings.customBaseUrl) : undefined;

  return (
    <div className="drawer-wrap">
      <button className="drawer-scrim" type="button" aria-label="Close details" onClick={onClose} />
      <aside className="drawer" aria-label="Details and settings">
        <header className="drawer-head">
          <h2>Details</h2>
          <button className="btn sm" type="button" onClick={onClose}>Close</button>
        </header>

        <Section id="model" title="Model and provider" focus={focus} nonce={nonce}>
          <fieldset className="radio-group" disabled={busy}>
            <legend className="sr">Provider</legend>
            <label className="radio"><input type="radio" name="provider" checked={settings.provider === 'near'} onChange={() => onSettings({ ...settings, provider: 'near' })} /> <span><b>NEAR AI Cloud</b><small>Private enclave models. Verified before anything is sent.</small></span></label>
            <label className="radio"><input type="radio" name="provider" checked={settings.provider === 'custom'} onChange={() => onSettings({ ...settings, provider: 'custom' })} /> <span><b>Another provider</b><small>Any OpenAI-compatible API. No enclave check.</small></span></label>
          </fieldset>

          {settings.provider === 'near' ? (
            <>
              <label className="field">Model
                <select value={settings.model} disabled={busy} onChange={(event) => onSettings({ ...settings, model: event.target.value })}>
                  {PRIVATE_TEE_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  <option disabled>Claude, GPT, Gemini: no hardware privacy guarantee</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={settings.strict} disabled={busy} onChange={(event) => onSettings({ ...settings, strict: event.target.checked })} /> Strict TCB (accept UpToDate only)</label>
              <label className="field">Your NEAR AI Cloud key {props.sharedAvailable ? '(optional)' : ''}
                <input type="password" autoComplete="off" spellCheck={false} data-lpignore="true" value={props.apiKey} placeholder={props.sharedAvailable ? 'Leave empty to use the free shared key' : 'Paste your key'} onChange={(event) => props.onApiKey(event.target.value)} />
              </label>
              <p className="small muted">Kept in memory for this tab only and sent only to cloud-api.near.ai after the enclave check.</p>
            </>
          ) : (
            <>
              <label className="field">Provider
                <select
                  value={settings.customPreset}
                  disabled={busy}
                  onChange={(event) => {
                    const preset = PROVIDER_PRESETS.find((entry) => entry.id === event.target.value);
                    if (preset) onSettings({ ...settings, customPreset: preset.id, customBaseUrl: preset.baseUrl, customModel: preset.model || settings.customModel });
                  }}
                >
                  {PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                </select>
              </label>
              <label className="field">API base URL
                <input type="url" value={settings.customBaseUrl} disabled={busy} placeholder="https://api.example.com/v1" onChange={(event) => onSettings({ ...settings, customBaseUrl: event.target.value })} />
              </label>
              {urlCheck && !urlCheck.ok && <p className="form-error">{urlCheck.reason}</p>}
              <label className="field">Model name
                <input type="text" value={settings.customModel} disabled={busy} placeholder="gpt-4o-mini" onChange={(event) => onSettings({ ...settings, customModel: event.target.value })} />
              </label>
              <label className="field">Provider API key
                <input type="password" autoComplete="off" spellCheck={false} data-lpignore="true" value={props.apiKey} placeholder="Not needed for a local model" onChange={(event) => props.onApiKey(event.target.value)} />
              </label>
              <p className="small muted">The provider must allow browser requests (CORS). For Ollama, start it with OLLAMA_ORIGINS set to this site. Your key is never saved.</p>
            </>
          )}
        </Section>

        <Section id="history" title={`Chats and encrypted history (${props.chats.length})`} focus={focus} nonce={nonce}>
          {props.chats.length > 0 && (
            <ul className="chat-list">
              {props.chats.map((chat) => (
                <li key={chat.id} className={chat.current ? 'current' : undefined}>
                  <span className="chat-title" title={chat.title}>{chat.hasDocument && <span title="Has a document"><span aria-hidden="true">▤ </span><span className="sr">Has a document: </span></span>}{chat.title}</span>
                  <small>{chat.current ? 'Open now' : new Date(chat.updatedAt).toLocaleString()}</small>
                  {!chat.current && (
                    <span className="chat-actions">
                      <button className="link" type="button" onClick={() => props.onOpenChat(chat.id)}>Open</button>
                      <button className="link" type="button" onClick={() => props.onDeleteChat(chat.id)} aria-label={`Delete ${chat.title}`}>Delete</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="vault-status" role="status">{props.vaultStatus}</p>
          <div className="vault-actions">
            <button className="btn primary sm" type="button" disabled={!props.canSave} onClick={props.onDownload}>Download all chats (encrypted)</button>
            <button className="btn sm" type="button" onClick={props.onOpenFile}>Open encrypted file</button>
            <button className="btn sm" type="button" disabled={!props.canSave} onClick={props.onSaveBrowser}>Save in this browser</button>
            <button className="btn sm" type="button" onClick={props.onDeleteSaved}>Delete browser copy</button>
          </div>
          <p className="muted small">One file holds every chat with its document text and original file. AES-256-GCM with a key from your wallet's signature, bound to this site: only this wallet, on this site, can open it. If you lose the wallet, the file cannot be recovered.</p>
        </Section>

        <Section id="ledger" title={`Request ledger (${props.carried} carried your document)`} focus={focus} nonce={nonce}>
          <p className="ledger-line">{props.carried === 0 ? 'No request has carried your document yet.' : `${props.carried} request${props.carried === 1 ? '' : 's'} carried your document: the analysis call.`}</p>
          {props.ledger.length > 0 && (
            <ul className="ledger">
              {props.ledger.slice(-10).reverse().map((entry) => (
                <li key={entry.id}><span>{entry.method} {entry.host}</span><span>{entry.purpose}</span><span>{entry.status || 'failed'}</span></li>
              ))}
            </ul>
          )}
        </Section>

        {props.proposals.length > 0 && (
          <Section id="masks" title={`Details that stay hidden (${props.accepted.size} of ${props.proposals.length})`} focus={focus} nonce={nonce}>
            <div className="chips">
              {props.proposals.map((proposal) => (
                <label className="chip" key={proposal.id} htmlFor={`mask-${proposal.id}`}>
                  <input id={`mask-${proposal.id}`} type="checkbox" checked={props.accepted.has(proposal.id)} onChange={() => props.onToggleMask(proposal.id)} />
                  <code>{props.placeholders.get(proposal.id)}</code>
                  <small>{categoryLabels[proposal.category]}</small>
                </label>
              ))}
            </div>
          </Section>
        )}

        <Section id="hidden" title={`Always hidden (${props.alwaysHidden.length})`} focus={focus} nonce={nonce}>
          <p className="muted small">Words you hid by hand. Incognito hides them in every chat. Stored encrypted for your wallet in this browser only.</p>
          {props.alwaysHidden.length === 0 ? <p className="muted small">Nothing yet. Use “Hide other…” while typing in Incognito.</p> : (
            <div className="chips">
              {props.alwaysHidden.map((term) => (
                <span className="chip" key={term}>
                  <code>{term}</code>
                  <button type="button" className="swap-x" onClick={() => props.onForgetHidden(term)} aria-label={`Stop always hiding ${term}`} title="Stop hiding this in future chats">×</button>
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section id="more" title="More" focus={focus} nonce={nonce}>
          <label className="check"><input type="checkbox" checked={settings.reduceMotion} onChange={(event) => onSettings({ ...settings, reduceMotion: event.target.checked })} /> Reduce motion</label>
          <button className="btn sm" type="button" onClick={props.onClear}>Clear everything</button>
        </Section>
      </aside>
    </div>
  );
}
