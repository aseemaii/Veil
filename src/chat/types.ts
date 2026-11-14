import { z } from 'zod';

export const chatBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(20_000) }),
  z.object({
    type: z.literal('stats'),
    items: z.array(z.object({ label: z.string().max(200), value: z.string().max(200) })).max(20),
  }),
  z.object({
    type: z.literal('bar-chart'),
    title: z.string().max(200),
    items: z.array(z.object({ label: z.string().max(200), value: z.number().finite() })).max(40),
  }),
  z.object({
    type: z.literal('callout'),
    tone: z.enum(['info', 'success', 'warning']),
    title: z.string().max(200),
    text: z.string().max(20_000),
  }),
]);

export const chatMessageSchema = z.object({
  id: z.string().max(100),
  role: z.enum(['assistant', 'user']),
  createdAt: z.string().max(40),
  blocks: z.array(chatBlockSchema).max(20),
  /** Text exactly as it crossed the wire (placeholders, not real values). Present only on model turns. */
  wire: z.string().max(100_000).optional(),
  mode: z.enum(['private', 'incognito']).optional(),
  /** Placeholders that replaced real values in this message. Values themselves are never stored here. */
  hidden: z.array(z.string().max(40)).max(100).optional(),
  verification: z.enum(['pending', 'provider_tee', 'gateway', 'unsigned', 'none']).optional(),
  streaming: z.boolean().optional(),
  /** Link to NEAR AI's verification center for this reply's signature. */
  verifyUrl: z.string().max(20_000).startsWith('https://cloud.near.ai/').optional(),
});

export type ChatBlock = z.infer<typeof chatBlockSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
