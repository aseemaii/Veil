import { z } from 'zod';

export const SEVERITIES = ['high', 'medium', 'low'] as const;
const TERMS = ['rent', 'deposit', 'term', 'notice_period', 'escalation', 'lock_in', 'renewal', 'maintenance', 'other'] as const;

const text = z.string().trim();

const riskyClauseSchema = z.object({
  id: text.optional(),
  severity: z.enum(SEVERITIES),
  title: text,
  quote: text,
  why: text,
  askLandlord: text,
});

export const leaseReportSchema = z.object({
  summary: text,
  keyTerms: z.array(z.object({
    term: z.enum(TERMS).catch('other'),
    label: text,
    value: text,
    quote: text.optional(),
  })),
  riskyClauses: z.array(riskyClauseSchema),
  missingOrUnusual: z.array(z.object({ title: text, why: text })),
  datesAndObligations: z.array(z.object({
    who: z.enum(['tenant', 'landlord', 'both']).catch('both'),
    what: text,
    when: text,
  })),
});

export const storedReportSchema = leaseReportSchema.extend({
  schemaVersion: z.literal(1),
  notLegalAdvice: z.literal(true),
  riskyClauses: z.array(riskyClauseSchema.extend({ id: text })),
});

export type Severity = (typeof SEVERITIES)[number];

export interface LeaseReport {
  schemaVersion: 1;
  summary: string;
  keyTerms: Array<{ term: (typeof TERMS)[number]; label: string; value: string; quote?: string | undefined }>;
  riskyClauses: Array<{ id: string; severity: Severity; title: string; quote: string; why: string; askLandlord: string }>;
  missingOrUnusual: Array<{ title: string; why: string }>;
  datesAndObligations: Array<{ who: 'tenant' | 'landlord' | 'both'; what: string; when: string }>;
  notLegalAdvice: true;
}

export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

export type ParseOutcome = { ok: true; report: LeaseReport } | { ok: false; error: string };

export function parseReport(raw: string): ParseOutcome {
  let value: unknown;
  try {
    value = JSON.parse(extractJson(raw));
  } catch {
    return { ok: false, error: 'the reply was not valid JSON' };
  }
  const parsed = leaseReportSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.join('.') || 'report'}: ${issue?.message ?? 'invalid'}` };
  }
  const data = parsed.data;
  return {
    ok: true,
    report: {
      schemaVersion: 1,
      summary: data.summary,
      keyTerms: data.keyTerms,
      riskyClauses: data.riskyClauses.map((clause, index) => ({ ...clause, id: clause.id || `clause-${index + 1}` })),
      missingOrUnusual: data.missingOrUnusual,
      datesAndObligations: data.datesAndObligations,
      notLegalAdvice: true,
    },
  };
}
