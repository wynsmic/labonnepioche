import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from './env';

export const SESSION_COOKIE = 'affaires_session';
const SESSION_DAYS = 30;

const encoder = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Compares two strings in time that does not depend on where they differ. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export async function checkPassword(env: AppEnv['Bindings'], password: string): Promise<boolean> {
  if (!env.APP_PASSWORD) return false;
  return safeEqual(password, env.APP_PASSWORD);
}

export async function createSession(env: AppEnv['Bindings']): Promise<{ value: string; maxAge: number }> {
  const maxAge = SESSION_DAYS * 86_400;
  const expires = Math.floor(Date.now() / 1000) + maxAge;
  return { value: `${expires}.${await hmac(sessionSecret(env), String(expires))}`, maxAge };
}

export async function isValidSession(env: AppEnv['Bindings'], value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [expires, sig] = value.split('.');
  if (!expires || !sig || Number(expires) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(sessionSecret(env), expires));
}

function sessionSecret(env: AppEnv['Bindings']): string {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be set (32+ characters)');
  }
  return env.SESSION_SECRET;
}

/** Every /api route except login and health needs a session. */
export async function requireSession(c: Context<AppEnv>, next: Next) {
  if (!(await isValidSession(c.env, getCookie(c, SESSION_COOKIE)))) {
    return c.json({ error: 'Non connecté' }, 401);
  }
  await next();
}
