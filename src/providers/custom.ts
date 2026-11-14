import type { AnalysisTransport, ChatMessageBody, CompletionOptions } from '../analyze/client';

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'ollama', label: 'Ollama on this computer', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  { id: 'custom', label: 'Custom OpenAI-compatible URL', baseUrl: '', model: '' },
];

export type UrlCheck = { ok: true; baseUrl: string } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Accepts https URLs, or http only for this computer. Strips credentials, query and trailing slash. */
export function checkBaseUrl(input: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: 'Enter a full URL such as https://api.example.com/v1.' };
  }
  if (url.username || url.password) return { ok: false, reason: 'Remove the username or password from the URL. Use the key field instead.' };
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    return { ok: false, reason: 'Use an https URL. Plain http is allowed only for localhost.' };
  }
  if (url.search || url.hash) return { ok: false, reason: 'Remove the query string or fragment from the URL.' };
  return { ok: true, baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, '')}` };
}

/** The masked text goes to this provider as ordinary HTTPS content: no enclave check and no response signature. */
export function createCustomTransport(baseUrl: string, apiKey: string): AnalysisTransport {
  return {
    async complete(messages: ChatMessageBody[], model: string, signal: AbortSignal, options?: CompletionOptions) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, messages, temperature: options?.temperature ?? 0.2, stream: false }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } | string } | null;
        const detail = typeof body?.error === 'string' ? body.error : body?.error?.message;
        throw new Error(`The provider answered ${response.status}${detail ? `: ${detail}` : ''}.`);
      }
      const body = (await response.json()) as { id?: string; choices?: Array<{ message?: { content?: string | null } }> };
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('The provider reply had no message content.');
      return { id: body.id ?? crypto.randomUUID(), text };
    },
  };
}
