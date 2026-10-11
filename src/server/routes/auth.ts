import { Hono } from 'hono';
import {
  type AppEnv,
  type UserRow,
  authMiddleware,
  bearer,
  createSession,
  hashPassword,
  toUser,
  validatePassword,
  validateUsername,
  verifyPassword,
} from '../auth';
import { type Db, newId, nowIso } from '../db';

// 简单的登录失败限流：同一用户名 10 次失败后锁定 10 分钟
const failures = new Map<string, { count: number; until: number }>();

export function authRoutes(db: Db) {
  const r = new Hono<AppEnv>();

  r.get('/setup/status', (c) => {
    const row = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role = 'teacher'`);
    return c.json({ needsSetup: (row?.n ?? 0) === 0 });
  });

  r.post('/setup', async (c) => {
    const body = await c.req.json<{ username?: string; displayName?: string; password?: string }>();
    const exists = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role = 'teacher'`);
    if ((exists?.n ?? 0) > 0) return c.json({ error: '教师账号已存在' }, 400);
    const username = (body.username ?? '').trim();
    const err = validateUsername(username) ?? validatePassword(body.password ?? '');
    if (err) return c.json({ error: err }, 400);
    const id = newId('u_');
    db.run(
      `INSERT INTO users(id, role, username, display_name, password_hash, active, created_at) VALUES (?, 'teacher', ?, ?, ?, 1, ?)`,
      [id, username, (body.displayName ?? '').trim() || '老师', await hashPassword(body.password!), nowIso()],
    );
    const user = toUser(db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id])!);
    return c.json({ token: createSession(db, id), user });
  });

  r.post('/auth/login', async (c) => {
    const body = await c.req.json<{ username?: string; password?: string }>();
    const username = (body.username ?? '').trim();
    const key = username.toLowerCase();
    const now = Date.now();
    let f = failures.get(key);
    if (f && f.until && f.until <= now) {
      failures.delete(key);
      f = undefined;
    }
    if (f && f.until > now) return c.json({ error: '尝试次数过多，请 10 分钟后再试' }, 429);
    const row = db.get<UserRow>('SELECT * FROM users WHERE username = ?', [username]);
    const ok = row ? await verifyPassword(body.password ?? '', row.password_hash) : false;
    if (!row || !ok) {
      const count = (f?.count ?? 0) + 1;
      failures.set(key, { count, until: count >= 10 ? now + 600_000 : 0 });
      return c.json({ error: '用户名或密码不正确' }, 401);
    }
    if (row.active !== 1) return c.json({ error: '账号已停用，请联系老师' }, 403);
    failures.delete(key);
    return c.json({ token: createSession(db, row.id), user: toUser(row) });
  });

  r.post('/auth/logout', (c) => {
    const token = bearer(c);
    if (token) db.run('DELETE FROM sessions WHERE token = ?', [token]);
    return c.json({ ok: true });
  });

  r.get('/auth/me', authMiddleware(db), (c) => c.json({ user: c.get('user') }));

  r.post('/auth/password', authMiddleware(db), async (c) => {
    const body = await c.req.json<{ oldPassword?: string; newPassword?: string }>();
    const user = c.get('user');
    const row = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [user.id])!;
    if (!(await verifyPassword(body.oldPassword ?? '', row.password_hash))) return c.json({ error: '原密码不正确' }, 400);
    const err = validatePassword(body.newPassword ?? '');
    if (err) return c.json({ error: err }, 400);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(body.newPassword!), user.id]);
    db.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [user.id, c.get('token')]);
    return c.json({ ok: true });
  });

  return r;
}
