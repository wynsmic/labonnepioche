// One-time local setup: creates .dev.vars (random session secret, local password) and the local database.
// Never overwrites an existing .dev.vars. Without OPENAI_API_KEY in the environment, the app runs on
// canned AI answers (MOCK_AI=1): add a key to .dev.vars later to get real analyses.
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const VARS = '.dev.vars';
const PASSWORD = 'pioche';

if (existsSync(VARS)) {
  console.log(`${VARS} existe déjà : inchangé.`);
} else {
  const key = process.env.OPENAI_API_KEY?.trim();
  const lines = [
    '# Local secrets: never commit this file.',
    key ? `OPENAI_API_KEY=${key}` : '# OPENAI_API_KEY=sk-...   (then remove MOCK_AI)',
    key ? '' : 'MOCK_AI=1',
    `APP_PASSWORD=${PASSWORD}`,
    `SESSION_SECRET=${randomBytes(32).toString('hex')}`,
  ].filter(Boolean);
  writeFileSync(VARS, `${lines.join('\n')}\n`, { mode: 0o600 });
  console.log(`${VARS} créé (${key ? 'clé OpenAI reprise de l’environnement' : 'IA simulée : MOCK_AI=1'}).`);
}

execSync('npx wrangler d1 migrations apply labonnepioche --local', { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CI: '1' } });
console.log('Base locale prête.');
console.log(`\n→ npm run dev, puis http://localhost:5199 (mot de passe : ${PASSWORD})`);
