import type { Proposal } from '../detect';
import { detect } from '../detect';
import type { AnalysisRecord, SavedSession } from '../history/session';

export type View = 'original' | 'outgoing' | 'compare' | 'report';
export type Phase = 'empty' | 'reviewing' | 'approved' | 'checking' | 'verified' | 'analyzing' | 'done' | 'failed';

export interface State {
  phase: Phase;
  name: string;
  text: string;
  proposals: Proposal[];
  accepted: Set<string>;
  view: View;
  fingerprint?: string;
  error?: string;
  analysis?: AnalysisRecord;
}

export type Action =
  | { type: 'load'; name: string; text: string }
  | { type: 'toggle'; id: string }
  | { type: 'manual'; start: number; end: number }
  | { type: 'view'; view: View }
  | { type: 'approve'; fingerprint: string }
  | { type: 'phase'; phase: Phase }
  | { type: 'done'; analysis: AnalysisRecord }
  | { type: 'signature'; completionId: string; signatureStatus: AnalysisRecord['signatureStatus']; receipt: AnalysisRecord['receipt'] }
  | { type: 'restore'; session: SavedSession }
  | { type: 'error'; message: string }
  | { type: 'clear' };

export const initialState: State = {
  phase: 'empty',
  name: '',
  text: '',
  proposals: [],
  accepted: new Set(),
  view: 'original',
};

/** Any change to what will be sent drops approval, verification and the report (SRS REV-5). */
function invalidated(state: State): State {
  return { ...state, phase: 'reviewing', fingerprint: undefined, analysis: undefined, view: state.view === 'report' ? 'outgoing' : state.view };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'load': {
      const proposals = detect(action.text);
      return {
        phase: 'reviewing',
        name: action.name,
        text: action.text,
        proposals,
        accepted: new Set(proposals.map((proposal) => proposal.id)),
        view: 'original',
      };
    }
    case 'toggle': {
      const accepted = new Set(state.accepted);
      if (accepted.has(action.id)) accepted.delete(action.id);
      else accepted.add(action.id);
      return { ...invalidated(state), accepted, error: undefined };
    }
    case 'manual': {
      if (state.proposals.some((proposal) => action.start < proposal.end && action.end > proposal.start)) {
        return { ...state, error: 'That selection overlaps an existing proposal. Toggle the existing highlight instead.' };
      }
      const proposal: Proposal = {
        id: `manual-${action.start}-${action.end}`,
        category: 'other',
        start: action.start,
        end: action.end,
        text: state.text.slice(action.start, action.end),
        source: 'manual',
        basis: 'user',
      };
      return {
        ...invalidated(state),
        error: undefined,
        proposals: [...state.proposals, proposal].sort((left, right) => left.start - right.start),
        accepted: new Set([...state.accepted, proposal.id]),
      };
    }
    case 'view':
      return { ...state, view: action.view };
    case 'approve':
      return { ...state, phase: 'approved', fingerprint: action.fingerprint, view: 'outgoing', error: undefined };
    case 'phase':
      return { ...state, phase: action.phase };
    case 'done':
      return { ...state, phase: 'done', analysis: action.analysis, view: 'report' };
    case 'signature':
      // The signature is checked after the report is shown; ignore a late result for a report that was replaced.
      if (state.analysis?.completionId !== action.completionId) return state;
      return { ...state, analysis: { ...state.analysis, signatureStatus: action.signatureStatus, receipt: action.receipt } };
    case 'restore': {
      const { review, analysis } = action.session;
      // Network phases are never restored: verification and in-flight calls belong to a past session.
      const approved = review.fingerprint !== undefined;
      const phase: Phase = review.phase === 'empty' ? 'empty'
        : review.phase === 'reviewing' || !approved ? 'reviewing'
          : analysis && review.phase === 'done' ? 'done' : 'approved';
      const restored = analysis;
      return {
        phase,
        name: review.name,
        text: review.text,
        proposals: review.proposals,
        accepted: new Set(review.accepted),
        view: review.view === 'report' && !restored ? 'outgoing' : review.view,
        fingerprint: review.fingerprint,
        analysis: restored,
      };
    }
    case 'error':
      return { ...state, error: action.message };
    case 'clear':
      return initialState;
  }
}
