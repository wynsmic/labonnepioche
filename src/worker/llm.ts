import type { z } from 'zod';
import type { AppEnv } from './env';
import { claudeLlm } from './llm-claude';
import { openaiLlm } from './llm-openai';

export type Env = AppEnv['Bindings'];
export type Effort = 'low' | 'medium' | 'high';

/** A user-facing failure of the model provider (missing key, refusal, unreadable answer…). */
export class AiError extends Error {}

/** What the hunt needs from a model, whichever provider runs it. */
export interface Llm {
  readonly label: string;
  /** Free-text research with web search. */
  webResearch(system: string, user: string): Promise<string>;
  /**
   * One answer that matches `schema`. `context` is stable across calls of the same hunt
   * (cached where the provider supports it); `user` changes every call.
   */
  structured<S extends z.ZodType>(
    schema: S,
    params: { system: string; context?: string; user: string; effort: Effort },
  ): Promise<z.infer<S>>;
}

export function llm(env: Env): Llm {
  return env.LLM_PROVIDER === 'claude' ? claudeLlm(env) : openaiLlm(env);
}

export function modelLabel(env: Env): string {
  return env.LLM_PROVIDER === 'claude' ? env.CLAUDE_MODEL : env.OPENAI_MODEL;
}
