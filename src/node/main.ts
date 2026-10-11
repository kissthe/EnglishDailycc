// 生产 / 本地开发入口：node dist/server.js
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { Hono } from 'hono';
import { createApp } from '../server/app';
import { seedDemo } from '../server/seed';
import { openNodeDb } from '../server/sqlite-node';
import { dateInZone } from '../shared/dates';

const port = Number(process.env.PORT ?? 8787);
const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const timeZone = process.env.APP_TIMEZONE ?? 'Asia/Shanghai';
mkdirSync(dataDir, { recursive: true });

const db = openNodeDb(join(dataDir, 'english-daily.db'));
const api = createApp({ db, timeZone });
// SEED_DEMO=1：空数据库首次启动时写入演示账号和材料，方便试用
if (process.env.SEED_DEMO === '1') await seedDemo(db, dateInZone(new Date(), timeZone));

const root = new Hono();
root.route('/', api);

// 有前端构建产物时一并托管（生产环境）
const webDir = resolve(process.env.WEB_DIR ?? join(dirname(process.argv[1] ?? '.'), 'web'));
if (existsSync(join(webDir, 'index.html'))) {
  const rel = relative(process.cwd(), webDir) || '.';
  root.use('/*', serveStatic({ root: rel }));
  root.get('*', serveStatic({ path: join(rel, 'index.html') }));
  console.log(`托管前端：${webDir}`);
}

serve({ fetch: root.fetch, port }, () => {
  console.log(`English Daily 已启动：http://localhost:${port}  （数据目录 ${dataDir}，时区 ${timeZone}）`);
});
