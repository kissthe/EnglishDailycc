// 浏览器演示版：用 sql.js（纯 JS 版 SQLite）在页面里运行完整后端，拦截 /api 请求
import initSqlJs from 'sql.js/dist/sql-asm-memory-growth.js';
import type { Database } from 'sql.js';
import { createApp } from '../server/app';
import type { Db, Param } from '../server/db';
import { seedDemo } from '../server/seed';
import { dateInZone } from '../shared/dates';
import { mount } from '../web/main';
import { load, remove, save } from '../web/storage';

const DB_KEY = 'ed_demo_db_v1';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function adapter(d: Database, onWrite: () => void): Db {
  const all = <T>(sql: string, params: Param[] = []): T[] => {
    const stmt = d.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  };
  let depth = 0;
  return {
    all,
    get: <T>(sql: string, params: Param[] = []) => all<T>(sql, params)[0],
    run: (sql, params = []) => {
      d.run(sql, params);
      const changes = d.getRowsModified();
      if (!depth) onWrite();
      return { changes };
    },
    exec: (sql) => {
      d.exec(sql);
      onWrite();
    },
    transaction: (fn) => {
      d.exec('BEGIN');
      depth++;
      try {
        const r = fn();
        d.exec('COMMIT');
        return r;
      } catch (e) {
        d.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
        onWrite();
      }
    },
  };
}

async function boot() {
  const SQL = await initSqlJs();
  const saved = load(DB_KEY);
  let sqldb: Database;
  try {
    sqldb = saved ? new SQL.Database(fromBase64(saved)) : new SQL.Database();
  } catch {
    sqldb = new SQL.Database();
  }
  sqldb.exec('PRAGMA foreign_keys = ON');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => save(DB_KEY, toBase64(sqldb.export())), 300);
  };
  const db = adapter(sqldb, persist);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const app = createApp({ db, timeZone });
  await seedDemo(db, dateInZone(new Date(), timeZone));

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/api')) return app.fetch(new Request(new URL(url, 'https://demo.local'), init));
    return nativeFetch(input, init);
  };

  (window as unknown as { __edResetDemo: () => void }).__edResetDemo = () => {
    clearTimeout(timer);
    remove(DB_KEY);
    remove('ed_token');
    location.hash = '';
    location.reload();
  };
  mount();
}

boot().catch((e) => {
  document.getElementById('root')!.innerHTML = `<div style="padding:24px">演示版启动失败：${String(e)}</div>`;
});
