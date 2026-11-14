import { useState } from 'react';
import { alignHidden } from '../assistant/vault';
import type { ChatBlock, ChatMessage } from './types';

/**
 * The assistant's avatar. Its eyes follow the pointer (see useBotGaze) and blink on their own; in Incognito it
 * pulls a visor down over its eyes, in Private the visor lifts; while thinking its eyes scan side to side.
 */
export function BotAvatar() {
  return (
    <div className="msg-avatar bot" title="Veil · private assistant">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <g className="bot-antenna">
          <line x1="12" y1="2.8" x2="12" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle className="bot-light" cx="12" cy="2.6" r="1.5" />
        </g>
        <rect className="bot-head" x="3.5" y="6" width="17" height="13.5" rx="5" fill="currentColor" />
        <g className="bot-eyes">
          <ellipse className="bot-eye" cx="9" cy="12.6" rx="1.75" ry="1.9" />
          <ellipse className="bot-eye" cx="15" cy="12.6" rx="1.75" ry="1.9" />
        </g>
        <g className="bot-visor">
          <rect x="5" y="10.4" width="14" height="4.4" rx="2.2" />
          <path d="M7.4 12.6h3.2M13.4 12.6h3.2" strokeWidth="1.1" strokeLinecap="round" />
        </g>
        <path className="bot-mouth" d="M9.8 16.4q2.2 1.3 4.4 0" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}

/** Shows which parts of a message were hidden: each replaced value is marked with the placeholder the model saw. */
function HiddenText({ text, wire, asSent }: { text: string; wire: string; asSent: boolean }) {
  if (asSent) return <p className="msg-text msg-text--wire">{wire}</p>;
  const segments = alignHidden(text, wire);
  if (!segments) return <p className="msg-text">{text}</p>;
  return (
    <p className="msg-text">
      {segments.map((segment, index) => segment.placeholder
        ? <mark className="hidden-detail" key={`${index}-${segment.placeholder}`} title={`Sent as ${segment.placeholder}`}>{segment.text}<small>{segment.placeholder.slice(1, -1)}</small></mark>
        : <span key={`${index}-t`}>{segment.text}</span>)}
    </p>
  );
}

function Block({ block }: { block: ChatBlock }) {
  if (block.type === 'text') return <p className="msg-text">{block.text}</p>;
  if (block.type === 'stats') {
    return <dl className="msg-stats">{block.items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
  }
  if (block.type === 'bar-chart') {
    const largest = Math.max(1, ...block.items.map((item) => item.value));
    return (
      <figure className="msg-chart" aria-label={block.title}>
        <figcaption>{block.title}</figcaption>
        {block.items.map((item) => (
          <div className="chart-row" key={item.label}>
            <span>{item.label}</span>
            <progress className="chart-track" max={largest} value={item.value}>{item.value}</progress>
            <strong>{item.value}</strong>
          </div>
        ))}
      </figure>
    );
  }
  return <aside className={`callout callout--${block.tone}`}><strong>{block.title}</strong><p>{block.text}</p></aside>;
}

const VERIFICATION: Record<NonNullable<ChatMessage['verification']>, { label: string; dot: string; title: string }> = {
  pending: { label: 'Verifying', dot: 'wait', title: 'Fetching the response signature from NEAR AI.' },
  provider_tee: { label: 'Verified', dot: 'ok', title: 'Signed by the model inside the verified enclave.' },
  gateway: { label: 'Gateway signed', dot: 'warn', title: 'Signed by the gateway only. This does not show the model ran in an enclave.' },
  unsigned: { label: 'Unverified', dot: 'bad', title: 'No signature came back after 3 tries.' },
  none: { label: 'Unverified provider', dot: 'bad', title: 'This provider does not sign replies.' },
};

function Meta({ message, asSent, onAsSent }: { message: ChatMessage; asSent: boolean; onAsSent: (value: boolean) => void }) {
  if (message.streaming) return null;
  const hidden = message.hidden ?? [];
  if (message.role === 'user' && hidden.length > 0) {
    return (
      <p className="msg-meta" title={`Replaced before sending: ${hidden.join(', ')}`}>
        <i className="dot dot--info" aria-hidden="true" />{hidden.length} hidden
        <button className="link" type="button" aria-pressed={asSent} onClick={() => onAsSent(!asSent)}>{asSent ? 'Show mine' : 'View as sent'}</button>
      </p>
    );
  }
  if (message.role === 'user' && message.mode === 'incognito' && message.wire !== undefined) {
    return <p className="msg-meta" title="Incognito found nothing to hide in this message, so it was sent as typed."><i className="dot dot--idle" aria-hidden="true" />Nothing to hide</p>;
  }
  if (message.role === 'assistant' && message.verification) {
    const { label, dot, title } = VERIFICATION[message.verification];
    return (
      <p className="msg-meta" title={title}>
        <i className={`dot dot--${dot}`} aria-hidden="true" />{label}
        {message.verifyUrl?.startsWith('https://cloud.near.ai/') && <a href={message.verifyUrl} target="_blank" rel="noreferrer">Verify ↗</a>}
      </p>
    );
  }
  return null;
}

export function Message({ message }: { message: ChatMessage }) {
  const [asSent, setAsSent] = useState(false);
  const thinking = message.streaming && message.blocks.every((block) => block.type === 'text' && !block.text);
  // Highlight hidden values in Incognito messages and in replies that mention them.
  const wire = !message.streaming && message.wire && /\[[A-Z]+(?:-\d+)?\]/.test(message.wire) ? message.wire : undefined;
  return (
    <article className={`msg msg--${message.role}`} aria-label={`${message.role} message`} aria-busy={message.streaming || undefined}>
      {message.role === 'assistant' ? <BotAvatar /> : <div className="msg-avatar" aria-hidden="true">You</div>}
      <div className={message.streaming ? 'msg-bubble msg-bubble--streaming' : 'msg-bubble'}>
        {thinking
          ? <p className="msg-thinking"><span className="sr">Veil is thinking</span><i /><i /><i /></p>
          : message.blocks.map((block, index) => (block.type === 'text' && wire && index === 0
            ? <HiddenText key={`${message.id}-${index}`} text={block.text} wire={wire} asSent={asSent} />
            : <Block block={block} key={`${message.id}-${index}`} />))}
        <Meta message={message} asSent={asSent} onAsSent={setAsSent} />
      </div>
    </article>
  );
}
