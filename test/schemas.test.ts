import { describe, expect, it } from 'vitest';
import { zodTextFormat } from 'openai/helpers/zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { AnalysesSchema, PlanSchema } from '../contracts/types';

// Both providers must accept our schemas as strict JSON schemas.
describe.each([
  ['plan', PlanSchema],
  ['analyses', AnalysesSchema],
])('%s schema', (_name, schema) => {
  it('converts for OpenAI structured outputs', () => {
    const format = zodTextFormat(schema, 'result');
    expect(format.type).toBe('json_schema');
    expect(format.strict).toBe(true);
    expect(JSON.stringify(format.schema)).toContain('"additionalProperties":false');
  });
  it('converts for Claude structured outputs', () => {
    expect(betaZodOutputFormat(schema)).toBeTruthy();
  });
});
