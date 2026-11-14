import type { ReactNode } from 'react';
import type { Proposal } from '../detect';
import type { MaskResult } from '../mask/masker';

export interface ReviewState {
  text: string;
  proposals: Proposal[];
  accepted: Set<string>;
}

export const categoryLabels: Record<Proposal['category'], string> = {
  party: 'party name',
  address: 'property address',
  email: 'email address',
  phone: 'phone number',
  card: 'payment card',
  iban: 'bank account',
  gov_id: 'government ID',
  account: 'account number',
  other: 'personal detail',
};

export function originalContent(state: ReviewState, onToggle: (id: string) => void) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const proposal of state.proposals) {
    nodes.push(state.text.slice(cursor, proposal.start));
    const active = state.accepted.has(proposal.id);
    nodes.push(
      <button
        className={active ? 'hl on' : 'hl off'}
        key={proposal.id}
        type="button"
        aria-pressed={active}
        aria-label={`${active ? 'Masked' : 'Not masked'}: ${categoryLabels[proposal.category]}, ${proposal.text}`}
        onClick={() => onToggle(proposal.id)}
      >
        {proposal.text}
      </button>,
    );
    cursor = proposal.end;
  }
  nodes.push(state.text.slice(cursor));
  return nodes;
}

export function outgoingContent(result: MaskResult) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const span of result.spans) {
    nodes.push(result.outgoing.slice(cursor, span.outStart));
    nodes.push(<span className="tk" key={`${span.outStart}-${span.placeholder}`}>{span.placeholder}</span>);
    cursor = span.outEnd;
  }
  nodes.push(result.outgoing.slice(cursor));
  return nodes;
}

export function countVisibleTerms(text: string) {
  const amounts = text.match(/(?:INR|USD|EUR|GBP|\$|€|£|₹)\s?[\d,]+/gi)?.length ?? 0;
  const dates = text.match(/\b(?:\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g)?.length ?? 0;
  return amounts + dates;
}
