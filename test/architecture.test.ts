import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/** Every TypeScript file under a folder. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Relative imports of a file that reach into `folder` (top-level project folder). */
function importsInto(file: string, folder: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)]
    .map((m) => m[1])
    .filter((spec) => spec.startsWith('.') && new RegExp(`(^|/)${folder}(/|$)`).test(spec));
}

it('keeps the web app off the server code: it only shares the API contract', () => {
  const offenders = files('web').flatMap((f) => importsInto(f, 'server').map((spec) => `${f} -> ${spec}`));
  expect(offenders).toEqual([]);
});

it('keeps the contract free of server and web code', () => {
  const offenders = files('contracts').flatMap((f) => [...importsInto(f, 'server'), ...importsInto(f, 'web')].map((spec) => `${f} -> ${spec}`));
  expect(offenders).toEqual([]);
});

it('keeps the server off the web app', () => {
  const offenders = files('server').flatMap((f) => importsInto(f, 'web').map((spec) => `${f} -> ${spec}`));
  expect(offenders).toEqual([]);
});
