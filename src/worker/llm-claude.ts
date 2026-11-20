import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { AiError, type Env, type Llm } from './llm';

/** On a policy decline, the API re-runs the request on a server-chosen fallback model. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_CONTINUATIONS = 4;

export function claudeLlm(env: Env): Llm {
  const client = () => {
    if (!env.ANTHROPIC_API_KEY) throw new AiError('ANTHROPIC_API_KEY n’est pas configurée');
    return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  };

  return {
    label: 'Claude',

    async webResearch(system, user) {
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: user }];
      for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
        const response = await client().beta.messages.create({
          model: env.CLAUDE_MODEL,
          max_tokens: 16000,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          system,
          messages,
          output_config: { effort: 'high' },
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
        });
        // A long server-tool turn pauses: send it back as is and the server resumes.
        if (response.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: response.content });
          continue;
        }
        if (response.stop_reason === 'refusal') {
          throw new AiError(`Claude a décliné la demande (${response.stop_details?.category ?? 'raison inconnue'})`);
        }
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        if (!text.trim()) throw new AiError('La recherche web n’a rien donné');
        return text;
      }
      throw new AiError('La recherche web n’a pas abouti');
    },

    async structured<S extends z.ZodType>(
      schema: S,
      params: { system: string; context?: string; user: string; effort: 'low' | 'medium' | 'high' },
    ): Promise<z.infer<S>> {
      const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: params.system }];
      if (params.context) system.push({ type: 'text', text: params.context, cache_control: { type: 'ephemeral' } });
      const response = await client().beta.messages.parse({
        model: env.CLAUDE_MODEL,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: params.user }],
        output_config: { effort: params.effort, format: betaZodOutputFormat(schema) },
      });
      if (response.stop_reason === 'refusal') {
        throw new AiError(`Claude a décliné la demande (${response.stop_details?.category ?? 'raison inconnue'})`);
      }
      if (response.stop_reason === 'max_tokens') throw new AiError('Réponse trop longue, interrompue');
      if (response.parsed_output == null) throw new AiError('Réponse illisible');
      return response.parsed_output as z.infer<S>;
    },
  };
}
