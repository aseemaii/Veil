import { DEFAULT_MODEL, isAllowedModel } from '../gate/gate';
import { checkBaseUrl, PROVIDER_PRESETS } from '../providers/custom';

import type { PrivacyMode } from '../assistant/prompt';

export type ProviderKind = 'near' | 'custom';

export interface Settings {
  provider: ProviderKind;
  /** Incognito hides personal details in typed messages before they leave; Private sends them as typed (still encrypted). */
  mode: PrivacyMode;
  /** Incognito strict hiding: also unusual proper nouns, long numbers and codes. */
  strictHiding: boolean;
  model: string;
  strict: boolean;
  reduceMotion: boolean;
  customPreset: string;
  customBaseUrl: string;
  customModel: string;
}

export const SETTINGS_KEY = 'fineprint.settings';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'near',
  mode: 'incognito',
  strictHiding: false,
  model: DEFAULT_MODEL,
  strict: false,
  reduceMotion: false,
  customPreset: 'openai',
  customBaseUrl: '',
  customModel: '',
};

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Persisted: provider choice, model names, the strict and motion toggles. Never an API key or anything from a document. */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return DEFAULT_SETTINGS;
    const stored = value as Record<string, unknown>;
    const baseUrl = text(stored.customBaseUrl, 300);
    return {
      provider: stored.provider === 'custom' ? 'custom' : 'near',
      mode: stored.mode === 'private' ? 'private' : 'incognito',
      strictHiding: stored.strictHiding === true,
      model: isAllowedModel(stored.model) ? stored.model : DEFAULT_MODEL,
      strict: stored.strict === true,
      reduceMotion: stored.reduceMotion === true,
      customPreset: PROVIDER_PRESETS.some((preset) => preset.id === stored.customPreset) ? String(stored.customPreset) : 'openai',
      customBaseUrl: baseUrl && checkBaseUrl(baseUrl).ok ? baseUrl : '',
      customModel: text(stored.customModel, 200),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function readSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings are a convenience; a blocked storage must not break the app.
  }
}
