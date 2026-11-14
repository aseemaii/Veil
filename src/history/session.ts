import { z } from 'zod';
import type { SignatureStatus } from '../analyze/client';
import { type LeaseReport, storedReportSchema } from '../analyze/schema';
import { chatMessageSchema } from '../chat/types';
import type { Proposal } from '../detect/types';
import type { Receipt } from '../receipt/receipt';

export const MAX_DOCUMENT_CHARS = 2_000_000;
const CATEGORIES = ['party', 'address', 'email', 'phone', 'card', 'iban', 'gov_id', 'account', 'other'] as const;

const proposalSchema = z.object({
  id: z.string().max(100),
  category: z.enum(CATEGORIES),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string().max(5_000),
  source: z.enum(['rule', 'party', 'manual']),
  basis: z.enum(['checksum', 'pattern', 'user']),
  placeholderHint: z.enum(['LANDLORD', 'TENANT']).optional(),
});

const receiptSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal('live'),
  near: z.object({
    completionId: z.string(),
    model: z.string(),
    signatureKind: z.enum(['provider_tee', 'gateway']),
    signingAlgo: z.string(),
    signingAddress: z.string(),
    signedText: z.string(),
    signature: z.string(),
    verifiedAt: z.string(),
  }),
  app: z.object({
    nonce: z.string(),
    tcbStatus: z.string(),
    advisoryIds: z.array(z.string()),
    composeHash: z.string(),
    osImageHash: z.string(),
    outgoingTextSha256: z.string(),
    reportSha256: z.string(),
    appVersion: z.string(),
    gitCommit: z.string(),
    promptVersion: z.string(),
  }),
});

const analysisSchema = z.object({
  report: storedReportSchema,
  completionId: z.string(),
  model: z.string(),
  signatureStatus: z.enum(['provider_tee', 'gateway', 'unsigned', 'none']),
  completedAt: z.string(),
  receipt: receiptSchema.nullable(),
});

export const savedSessionSchema = z.object({
  schemaVersion: z.literal(1),
  review: z.object({
    phase: z.enum(['empty', 'reviewing', 'approved', 'checking', 'verified', 'analyzing', 'done', 'failed']),
    name: z.string().max(500),
    text: z.string().max(MAX_DOCUMENT_CHARS),
    proposals: z.array(proposalSchema).max(10_000),
    accepted: z.array(z.string()).max(10_000),
    view: z.enum(['original', 'outgoing', 'compare', 'report']),
    fingerprint: z.string().max(64).optional(),
  }),
  messages: z.array(chatMessageSchema).max(500),
  analysis: analysisSchema.optional(),
});

export interface AnalysisRecord {
  report: LeaseReport;
  completionId: string;
  model: string;
  signatureStatus: SignatureStatus;
  completedAt: string;
  receipt: Receipt | null;
}

export type SavedSession = z.infer<typeof savedSessionSchema>;

/** Returns a validated session or null; ranges are checked so a restored proposal can never slice outside the text. */
export function parseSavedSession(value: unknown): SavedSession | null {
  const parsed = savedSessionSchema.safeParse(value);
  if (!parsed.success) return null;
  const { review } = parsed.data;
  const proposals: Proposal[] = review.proposals;
  const ordered = proposals.every((proposal, index) =>
    proposal.start < proposal.end
    && proposal.end <= review.text.length
    && (index === 0 || (proposals[index - 1]?.end ?? 0) <= proposal.start));
  return ordered ? parsed.data : null;
}

/** The original uploaded file, kept so a download can hand back the exact document. */
export const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
const originalSchema = z.object({
  name: z.string().max(500),
  type: z.string().max(200),
  data: z.string().max(Math.ceil(MAX_ORIGINAL_BYTES / 3) * 4 + 4),
});
export type OriginalFile = z.infer<typeof originalSchema>;

const chatEntrySchema = z.object({
  id: z.string().max(100),
  title: z.string().max(200),
  updatedAt: z.string().max(40),
  session: savedSessionSchema,
  original: originalSchema.optional(),
});
export type ChatEntry = z.infer<typeof chatEntrySchema>;

/** Version 2 files group every chat (and their documents) in one wallet-encrypted bundle. */
const bundleSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal('bundle'),
  activeId: z.string().max(100),
  chats: z.array(chatEntrySchema).min(1).max(100),
});
export type HistoryBundle = z.infer<typeof bundleSchema>;

/** Accepts a v2 bundle or a v1 single session (older downloads), validating every session's ranges. */
export function parseHistory(value: unknown): HistoryBundle | null {
  const bundle = bundleSchema.safeParse(value);
  if (bundle.success) {
    return bundle.data.chats.every((chat) => parseSavedSession(chat.session) !== null) ? bundle.data : null;
  }
  const single = parseSavedSession(value);
  if (!single) return null;
  const id = 'imported';
  return { schemaVersion: 2, kind: 'bundle', activeId: id, chats: [{ id, title: chatTitle(single), updatedAt: new Date(0).toISOString(), session: single }] };
}

export function chatTitle(session: SavedSession): string {
  if (session.review.name) return session.review.name.slice(0, 120);
  const first = session.messages.find((message) => message.role === 'user' && message.wire !== undefined);
  const text = first?.blocks.find((block) => block.type === 'text');
  return text && text.type === 'text' ? text.text.replace(/\s+/g, ' ').slice(0, 80) : 'New chat';
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function originalToBlob(original: OriginalFile) {
  const binary = atob(original.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: original.type || 'application/octet-stream' });
}
