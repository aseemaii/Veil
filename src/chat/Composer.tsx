import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { PrivacyMode } from '../assistant/prompt';
import type { HiddenDetail } from '../assistant/vault';

export type EnclaveStatus = 'idle' | 'checking' | 'verified' | 'failed' | 'none';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  mode: PrivacyMode;
  onMode: (mode: PrivacyMode) => void;
  /** True once this chat sent something in Private mode: Incognito needs a new chat. */
  incognitoLocked?: boolean;
  onNewChat?: () => void;
  preview: HiddenDetail[];
  /** Detected values in the current text that the user chose to send as typed. */
  allowed: string[];
  onAllow: (value: string) => void;
  onHide: (value: string) => void;
  strict: boolean;
  onStrict: (value: boolean) => void;
  enclave: EnclaveStatus;
  onEnclave: () => void;
  /** NEAR AI verification center for the current model, shown next to a verified status. */
  verifyUrl?: string;
  onAttach: () => void;
  note: ReactNode;
}

const ENCLAVE: Record<EnclaveStatus, { label: string; dot: string; title: string }> = {
  idle: { label: 'Not checked', dot: 'idle', title: 'The enclave has not been checked yet.' },
  checking: { label: 'Verifying', dot: 'wait', title: 'Checking the Intel TDX and NVIDIA GPU evidence. Nothing is sent until it passes.' },
  verified: { label: 'Enclave verified', dot: 'ok', title: 'Intel TDX quote, NVIDIA GPU evidence and a fresh nonce all checked in this browser.' },
  failed: { label: 'Check failed', dot: 'bad', title: 'The enclave evidence did not verify. Nothing was sent.' },
  none: { label: 'No enclave', dot: 'bad', title: 'This provider has no hardware privacy guarantee.' },
};

export function Composer(props: ComposerProps) {
  const { value, onChange, onSend, onStop, busy, mode, onMode, preview, enclave } = props;
  const input = useRef<HTMLTextAreaElement>(null);
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');
  const termInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) termInput.current?.focus();
  }, [adding]);

  function readSelection() {
    const element = input.current;
    if (!element) return;
    setSelected(element.value.slice(element.selectionStart, element.selectionEnd).trim().slice(0, 200));
  }

  function hide(value: string) {
    const clean = value.trim();
    if (clean.length < 2) return;
    props.onHide(clean);
    setSelected('');
    setTerm('');
    setAdding(false);
    input.current?.focus();
  }

  // Grow with the text up to the CSS max-height.
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  return (
    <form className="composer" onSubmit={(event) => { event.preventDefault(); if (busy) onStop(); else onSend(); }}>
      <div className="composer-bar">
        <fieldset className="mode-toggle">
          <legend className="sr">Privacy mode</legend>
          <button
            type="button"
            aria-pressed={mode === 'incognito'}
            disabled={props.incognitoLocked && mode !== 'incognito'}
            onClick={() => onMode('incognito')}
            title={props.incognitoLocked && mode !== 'incognito'
              ? 'This chat already sent text as typed. Start a new chat to use Incognito.'
              : 'Incognito: names, emails, phone, card and ID numbers are replaced with placeholders before anything leaves this tab, and swapped back on your screen only'}
          >
            <span aria-hidden="true">◐</span> Incognito
          </button>
          <button type="button" aria-pressed={mode === 'private'} onClick={() => onMode('private')} title="Private: sent exactly as typed, encrypted end to end to the verified enclave">
            <span aria-hidden="true">◈</span> Private
          </button>
        </fieldset>
        {mode === 'incognito' && (
          <button
            type="button"
            className="strict-toggle"
            aria-pressed={props.strict}
            onClick={() => props.onStrict(!props.strict)}
            title="Strict hiding: also hides unusual capitalised words (names, companies, places), long numbers and codes. Hides more than needed, misses less."
          >
            Strict {props.strict ? 'on' : 'off'}
          </button>
        )}
        {props.onNewChat && <button className="new-chat" type="button" onClick={props.onNewChat} title="Clear this conversation and start fresh">+ New chat</button>}
        <p className="status" title={ENCLAVE[enclave].title}>
          <i className={`dot dot--${ENCLAVE[enclave].dot}`} aria-hidden="true" />
          <span>{ENCLAVE[enclave].label}</span>
          {enclave === 'verified' && props.verifyUrl && <a href={props.verifyUrl} target="_blank" rel="noreferrer">Verify ↗</a>}
          {(enclave === 'failed' || enclave === 'idle') && <button className="link" type="button" onClick={props.onEnclave}>Retry</button>}
        </p>
      </div>
      <div className="composer-box">
        <button className="attach" type="button" onClick={props.onAttach} aria-label="Attach a document" title="Attach a lease or contract">+</button>
        <label className="sr" htmlFor="chat-input">Message Veil</label>
        <textarea
          id="chat-input"
          ref={input}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onSelect={readSelection}
          onBlur={() => window.setTimeout(readSelection, 150)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!busy) onSend();
            }
          }}
          placeholder={mode === 'incognito' ? 'Message Veil privately…' : 'Message Veil…'}
        />
        {busy
          ? <button className="send send--stop" type="submit" aria-label="Stop the reply"><span aria-hidden="true">■</span></button>
          : <button className="send" type="submit" aria-label="Send message" disabled={!value.trim()}><span aria-hidden="true">↑</span></button>}
      </div>
      {mode === 'incognito' && (value.trim() || adding) && (
        <div className="mask-preview" aria-live="polite">
          {preview.length > 0 && <span>Hidden before sending</span>}
          {preview.map((detail) => (
            <span className="swap" key={detail.placeholder}>
              <s>{detail.value}</s> → <code>{detail.placeholder}</code>
              <button type="button" className="swap-x" onClick={() => props.onAllow(detail.value)} aria-label={`Don't hide ${detail.value}`} title="Hidden by mistake? Send this as typed">×</button>
            </span>
          ))}
          {props.allowed.map((allowedValue) => (
            <span className="swap swap--allowed" key={`allowed-${allowedValue}`} title="You chose to send this as typed">
              Sent as typed: {allowedValue}
              <button type="button" className="swap-x" onClick={() => hide(allowedValue)} aria-label={`Hide ${allowedValue} again`} title="Hide it again">↺</button>
            </span>
          ))}
          {selected && !preview.some((detail) => detail.value.toLocaleLowerCase() === selected.toLocaleLowerCase()) && (
            <button type="button" className="hide-btn" onMouseDown={(event) => event.preventDefault()} onClick={() => hide(selected)}>
              Hide “{selected.length > 24 ? `${selected.slice(0, 24)}…` : selected}”
            </button>
          )}
          {adding ? (
            <span className="hide-add">
              <input
                type="text"
                value={term}
                aria-label="Word or phrase to hide"
                placeholder="Word or phrase to hide"
                onChange={(event) => setTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    hide(term);
                  }
                  if (event.key === 'Escape') setAdding(false);
                }}
                ref={termInput}
              />
              <button type="button" className="hide-btn" disabled={term.trim().length < 2} onClick={() => hide(term)}>Hide</button>
            </span>
          ) : (
            <button type="button" className="link" onClick={() => setAdding(true)} title="Missed something? Hide any word or phrase for the rest of this chat">Hide other…</button>
          )}
        </div>
      )}
      <p className="composer-note">{props.note}</p>
    </form>
  );
}
