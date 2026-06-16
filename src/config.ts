/** Model configuration & constants — ported from Python config.py */

export interface Env {
  API_KEY: string;
  UPSTREAM_URL: string;
  /** Optional proxy URL — route upstream requests through your own VPS to avoid shared CF egress IP rate limits. */
  PROXY_URL: string;
}

export interface ModelInfo {
  id: string;
  disabled: boolean;
  contextWindow: number;
}

/** Maximum length for system prompts (matches upstream validation). */
export const MAX_SYSTEM_LENGTH = 4000;

/**
 * OpenAI-compatible short name -> assistant-ui API identifier.
 * `disabled: true` means the model exists upstream but is currently turned off.
 */
export const MODEL_MAP: Record<string, ModelInfo> = {
  // OpenAI
  "gpt-5.4-nano": { id: "openai/gpt-5.4-nano", disabled: false, contextWindow: 400_000 },
  "gpt-5.4-mini": { id: "openai/gpt-5.4-mini", disabled: false, contextWindow: 400_000 },
  // Google
  "gemini-3.1-flash-lite": { id: "google-ai-studio/gemini-3.1-flash-lite-preview", disabled: false, contextWindow: 1_000_000 },
  // xAI
  "grok-4.1-fast": { id: "grok/grok-4-1-fast", disabled: false, contextWindow: 131_072 },
  "grok-3-mini": { id: "grok/grok-3-mini", disabled: false, contextWindow: 131_072 },
  // Groq
  "llama-4-scout-17b": { id: "groq/meta-llama/llama-4-scout-17b-16e-instruct", disabled: false, contextWindow: 131_072 },
  "qwen3-32b": { id: "groq/qwen/qwen3-32b", disabled: false, contextWindow: 131_072 },
};

export const DEFAULT_MODEL = "gpt-5.4-nano";

/** Only non-disabled models. */
export const ACTIVE_MODELS: Record<string, string> = Object.fromEntries(
  Object.entries(MODEL_MAP)
    .filter(([, v]) => !v.disabled)
    .map(([k, v]) => [k, v.id]),
);

export const UPSTREAM_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "user-agent": "ai-sdk/6.1.0 runtime/browser",
  "origin": "https://www.assistant-ui.com",
  "referer": "https://www.assistant-ui.com/docs",
};
