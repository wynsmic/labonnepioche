import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { AiError, type Env, type Llm } from './llm';

export function openaiLlm(env: Env): Llm {
  const client = () => {
    if (!env.OPENAI_API_KEY) throw new AiError('OPENAI_API_KEY n’est pas configurée');
    return new OpenAI({ apiKey: env.OPENAI_API_KEY });
  };

  return {
    label: 'GPT',

    async webResearch(system, user) {
      const response = await client().responses.create({
        model: env.OPENAI_MODEL,
        instructions: system,
        input: user,
        tools: [{ type: 'web_search' }],
        reasoning: { effort: 'medium' },
      });
      if (response.status === 'incomplete') {
        throw new AiError(`Recherche web interrompue (${response.incomplete_details?.reason ?? 'raison inconnue'})`);
      }
      const text = response.output_text;
      if (!text?.trim()) throw new AiError('La recherche web n’a rien donné');
      return text;
    },

    async structured<S extends z.ZodType>(
      schema: S,
      params: { system: string; context?: string; user: string; effort: 'low' | 'medium' | 'high'; small?: boolean },
    ): Promise<z.infer<S>> {
      // OpenAI caches long identical prefixes by itself: keep the stable context first.
      const instructions = params.context ? `${params.system}\n\n${params.context}` : params.system;
      const response = await client().responses.parse({
        model: params.small ? (env.OPENAI_SMALL_MODEL ?? 'gpt-5-mini') : env.OPENAI_MODEL,
        instructions,
        input: params.user,
        reasoning: { effort: params.effort },
        text: { format: zodTextFormat(schema as z.ZodType<unknown>, 'result') },
      });
      if (response.status === 'incomplete') {
        throw new AiError(`Réponse interrompue (${response.incomplete_details?.reason ?? 'raison inconnue'})`);
      }
      if (response.output_parsed == null) throw new AiError('GPT a refusé ou rendu une réponse illisible');
      return response.output_parsed as z.infer<S>;
    },
  };
}
