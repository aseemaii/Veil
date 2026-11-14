import { useEffect, useMemo, useState } from 'react';
import type { Auth } from '../App';
import { Message } from '../chat/Message';
import { Report } from '../chat/Report';
import { MAX_ENCRYPTED_FILE_BYTES, importEncryptedFile, type WalletUnlock } from '../history/crypto';
import { awaitHistoryHandoff } from '../history/handoff';
import { type HistoryBundle, originalToBlob, parseHistory } from '../history/session';
import { mask } from '../mask/masker';
import { Link } from '../router';
import { Logo } from '../ui/components';

type View =
  | { status: 'waiting' }
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bundle: HistoryBundle; savedAt: string; label: string };

async function openSession(unlock: WalletUnlock, fileText: string) {
  const { payload, savedAt } = await importEncryptedFile<unknown>(unlock, fileText);
  const bundle = parseHistory(payload);
  if (!bundle) throw new Error('The file decrypted but its contents are not valid Veil chats.');
  return { bundle, savedAt };
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read-only viewer for a downloaded encrypted file. It opens in its own tab after a download. */
export function History({ auth }: { auth: Auth }) {
  const [view, setView] = useState<View>({ status: 'waiting' });
  const [showNames, setShowNames] = useState(false);
  const [selected, setSelected] = useState<string>();

  useEffect(() => {
    let current = true;
    void awaitHistoryHandoff().then(async (handoff) => {
      if (!current) return;
      if (!handoff) {
        setView({ status: 'idle' });
        return;
      }
      try {
        const { bundle, savedAt } = await openSession(handoff.unlock, handoff.fileText);
        if (current) setView({ status: 'ready', bundle, savedAt, label: 'the file you just downloaded' });
      } catch (error) {
        if (current) setView({ status: 'error', message: error instanceof Error ? error.message : 'The file could not be opened.' });
      }
    });
    return () => {
      current = false;
    };
  }, []);

  async function pick(file?: File) {
    if (!file || !auth.unlock) return;
    if (file.size > MAX_ENCRYPTED_FILE_BYTES) {
      setView({ status: 'error', message: 'That file is too large to be a Veil history.' });
      return;
    }
    try {
      const { bundle, savedAt } = await openSession(auth.unlock, await file.text());
      setView({ status: 'ready', bundle, savedAt, label: file.name });
    } catch (error) {
      setView({ status: 'error', message: error instanceof Error ? error.message : 'The file could not be opened.' });
    }
  }

  const bundle = view.status === 'ready' ? view.bundle : undefined;
  const chat = bundle?.chats.find((entry) => entry.id === (selected ?? bundle.activeId)) ?? bundle?.chats[0];
  const session = chat?.session;
  const masked = useMemo(() => {
    if (!session) return undefined;
    const accepted = session.review.proposals.filter((proposal) => session.review.accepted.includes(proposal.id));
    return mask(session.review.text, accepted);
  }, [session]);

  return (
    <div className="app">
      <header className="nav">
        <div className="wrap">
          <Logo />
          <div className="nav-actions">
            {auth.unlock ? <Link className="btn sm" to="/chat">Back to chat</Link> : <Link className="btn sm" to="/">Home</Link>}
          </div>
        </div>
      </header>
      <main className="history-main">
        {view.status === 'waiting' && <p className="muted">Opening your encrypted file…</p>}

        {(view.status === 'idle' || view.status === 'error') && (
          <section className="auth-card">
            <span className="eyebrow">Saved chat</span>
            <h1>Open an encrypted file</h1>
            <p className="muted">Files downloaded from Veil open only with the wallet that created them, and only on this site. Nothing is uploaded; the file is decrypted in this tab.</p>
            {view.status === 'error' && <p className="form-error" role="alert">{view.message}</p>}
            {auth.unlock ? (
              <label className="btn primary file-button">
                Choose a saved chats file
                <input className="sr" type="file" accept=".veil,.fineprint,application/json" onChange={(event) => void pick(event.target.files?.[0])} />
              </label>
            ) : (
              <button className="btn primary" type="button" disabled={auth.connecting} onClick={() => void auth.connect('/history')}>
                {auth.connecting ? 'Waiting for your wallet…' : 'Log in with NEAR to open a file'}
              </button>
            )}
            {auth.error && <p className="form-error" role="alert">{auth.error}</p>}
          </section>
        )}

        {view.status === 'ready' && bundle && chat && session && masked && (
          <article className="history-view">
            <header className="history-head">
              <span className="eyebrow">Saved chats · {bundle.chats.length}</span>
              <h1>{chat.title || 'Untitled chat'}</h1>
              <p className="muted small">From {view.label}. Saved {new Date(view.savedAt).toLocaleString()}. Read only; decrypted in this tab.</p>
              {bundle.chats.length > 1 && (
                <fieldset className="view-tabs history-chats">
                  <legend className="sr">Chats in this file</legend>
                  {bundle.chats.map((entry) => (
                    <button type="button" key={entry.id} aria-pressed={entry.id === chat.id} onClick={() => setSelected(entry.id)} title={entry.title}>{entry.title.slice(0, 32) || 'Untitled'}</button>
                  ))}
                </fieldset>
              )}
              {chat.original && (
                <button className="btn sm" type="button" onClick={() => chat.original && saveBlob(originalToBlob(chat.original), chat.original.name)}>
                  Download original document ({chat.original.name})
                </button>
              )}
            </header>

            <div className="thread-in history-thread" role="log" aria-label="Saved conversation">
              {session.messages.map((message) => <Message message={message} key={message.id} />)}
            </div>

            {session.analysis && (
              <section className="history-report">
                <Report
                  record={session.analysis}
                  outgoing={masked.outgoing}
                  map={masked.map}
                  showNames={showNames}
                  onShowNames={setShowNames}
                />
              </section>
            )}

            {session.review.text && (
              <details className="more">
                <summary>Document as sent (masked)</summary>
                <pre className="doc doc--out">{masked.outgoing}</pre>
              </details>
            )}
          </article>
        )}
      </main>
    </div>
  );
}
