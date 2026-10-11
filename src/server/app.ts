import { Hono } from 'hono';
import { type ChatFn, chatCompletion } from './ai';
import { type AppEnv, authMiddleware, requireRole } from './auth';
import { type Db, migrate } from './db';
import { authRoutes } from './routes/auth';
import { studentRoutes } from './routes/student';
import { teacherRoutes } from './routes/teacher';

export interface AppOptions {
  db: Db;
  chat?: ChatFn;
  /** 计算“今天”所用的时区，默认 Asia/Shanghai */
  timeZone?: string;
}

export function createApp({ db, chat = chatCompletion, timeZone = 'Asia/Shanghai' }: AppOptions) {
  migrate(db);
  const app = new Hono<AppEnv>().basePath('/api');

  app.onError((err, c) => {
    if (err instanceof SyntaxError) return c.json({ error: '请求格式不正确' }, 400);
    console.error(err);
    return c.json({ error: '服务器出错了，请稍后再试' }, 500);
  });

  app.route('/', authRoutes(db));

  const teacher = new Hono<AppEnv>();
  teacher.use('*', authMiddleware(db), requireRole('teacher'));
  teacher.route('/', teacherRoutes({ db, chat, timeZone }));
  app.route('/t', teacher);

  const student = new Hono<AppEnv>();
  student.use('*', authMiddleware(db), requireRole('student'));
  student.route('/', studentRoutes(db, timeZone));
  app.route('/s', student);

  app.notFound((c) => c.json({ error: '接口不存在' }, 404));
  return app;
}
