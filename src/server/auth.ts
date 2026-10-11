import type { Context, MiddlewareHandler } from 'hono';
import type { Role, User } from '../shared/types';
import { type Db, newId, nowIso } from './db';

const ITERATIONS = 120_000;
const SESSION_DAYS = 30;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return toHex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${await pbkdf2(password, salt, ITERATIONS)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !salt || !hash) return false;
  const computed = await pbkdf2(password, fromHex(salt), Number(iter));
  if (computed.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export interface UserRow {
  id: string;
  role: Role;
  username: string;
  display_name: string;
  password_hash: string;
  active: number;
  created_at: string;
}

export function toUser(r: UserRow): User {
  return {
    id: r.id,
    role: r.role,
    username: r.username,
    displayName: r.display_name,
    active: r.active === 1,
    createdAt: r.created_at,
  };
}

export function createSession(db: Db, userId: string): string {
  const token = newId('s_') + newId();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.run('INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [token, userId, nowIso(), expires]);
  db.run('DELETE FROM sessions WHERE expires_at < ?', [nowIso()]);
  return token;
}

export type AppEnv = { Variables: { user: User; token: string } };

export function bearer(c: Context): string | null {
  const h = c.req.header('Authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export function authMiddleware(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c);
    if (!token) return c.json({ error: '请先登录' }, 401);
    const row = db.get<UserRow & { expires_at: string }>(
      `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
      [token],
    );
    if (!row || row.expires_at < nowIso()) return c.json({ error: '登录已过期，请重新登录' }, 401);
    if (row.active !== 1) return c.json({ error: '账号已停用，请联系老师' }, 403);
    c.set('user', toUser(row));
    c.set('token', token);
    await next();
  };
}

export function requireRole(role: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get('user').role !== role) return c.json({ error: '没有权限' }, 403);
    await next();
  };
}

export function validateUsername(u: string): string | null {
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(u)) return '用户名需为 3–32 位字母、数字、下划线、点或短横线';
  return null;
}

export function validatePassword(p: string): string | null {
  if (typeof p !== 'string' || p.length < 6) return '密码至少 6 位';
  if (p.length > 128) return '密码太长';
  return null;
}
