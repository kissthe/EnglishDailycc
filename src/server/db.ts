// 极简数据库接口：Node 端用 better-sqlite3，浏览器演示版用 sql.js，两者 SQL 完全相同

export type Param = string | number | null;

export interface Db {
  all<T>(sql: string, params?: Param[]): T[];
  get<T>(sql: string, params?: Param[]): T | undefined;
  run(sql: string, params?: Param[]): { changes: number };
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
}

export const SCHEMA_VERSION = 1;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('teacher','student')),
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'reading',
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  questions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  answer_release TEXT NOT NULL DEFAULT 'after_submit',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL,
  date TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignments_student_date ON assignments(student_id, date);
CREATE INDEX IF NOT EXISTS idx_assignments_date ON assignments(date);

CREATE TABLE IF NOT EXISTS submissions (
  assignment_id TEXT PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  draft TEXT NOT NULL DEFAULT '{}',
  draft_saved_at TEXT,
  first_answers TEXT,
  first_submitted_at TEXT,
  teacher_scores TEXT NOT NULL DEFAULT '{}',
  question_comments TEXT NOT NULL DEFAULT '{}',
  teacher_comment TEXT NOT NULL DEFAULT '',
  correction_required INTEGER NOT NULL DEFAULT 0,
  graded_at TEXT,
  correction_status TEXT NOT NULL DEFAULT 'none',
  correction_draft TEXT NOT NULL DEFAULT '{}',
  correction_draft_saved_at TEXT,
  correction_answers TEXT,
  correction_notes TEXT NOT NULL DEFAULT '{}',
  correction_submitted_at TEXT,
  correction_teacher_scores TEXT NOT NULL DEFAULT '{}',
  feedback_at TEXT,
  feedback_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function migrate(db: Db): void {
  db.exec(SCHEMA);
  db.run(`INSERT OR IGNORE INTO settings(key, value) VALUES ('schema_version', ?)`, [String(SCHEMA_VERSION)]);
}

export function newId(prefix = ''): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
  return prefix + s;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return parseJson(row?.value, fallback);
}

export function setSetting(db: Db, key: string, value: unknown): void {
  db.run(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
}
