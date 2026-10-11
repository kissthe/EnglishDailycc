import { Hono } from 'hono';
import { dateInZone, countWords, isValidDate } from '../../shared/dates';
import { gradeAttempt, questionPoints } from '../../shared/grading';
import { parseQuestionsBlock, matchSolutions, validateForPublish } from '../../shared/importer';
import { buildReadingPrompt } from '../../shared/prompt';
import type { AnswerRelease, MaterialSnapshot, MaterialSummary, Question, ReadingGenerateScene } from '../../shared/types';
import {
  type ChatFn,
  AiError,
  loadAiConfig,
  loadReadingScene,
  publicAiConfig,
  saveReadingScene,
  AI_KEY,
} from '../ai';
import { type AppEnv, type UserRow, hashPassword, toUser, validatePassword, validateUsername } from '../auth';
import { type Db, newId, nowIso, parseJson, setSetting } from '../db';
import { JOINED_SELECT, type JoinedRow, type MaterialRow, loadJoined, toGradingDetail, toListItem, toMaterial } from '../records';

export interface TeacherDeps {
  db: Db;
  chat: ChatFn;
  timeZone?: string;
}

function cleanQuestions(input: unknown): Question[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const type = o.type === 'blank' || o.type === 'text' ? o.type : 'choice';
    const q: Question = {
      id: String(o.id ?? `q${i + 1}`).trim() || `q${i + 1}`,
      type,
      prompt: String(o.prompt ?? ''),
    };
    if (type === 'choice') q.options = Array.isArray(o.options) ? o.options.map((x) => String(x ?? '')) : [];
    if (typeof o.answer === 'string' && o.answer.trim()) q.answer = o.answer.trim();
    if (typeof o.explanation === 'string' && o.explanation.trim()) q.explanation = o.explanation;
    if (typeof o.tag === 'string' && o.tag.trim()) q.tag = o.tag.trim();
    if (typeof o.points === 'number' && o.points > 0 && o.points <= 100) q.points = o.points;
    return q;
  });
}

export function teacherRoutes({ db, chat, timeZone }: TeacherDeps) {
  const r = new Hono<AppEnv>();

  // ---------------- 概览 ----------------
  r.get('/overview', (c) => {
    const today = dateInZone(new Date(), timeZone);
    const rows = db.all<JoinedRow>(`${JOINED_SELECT} WHERE a.date = ? ORDER BY u.display_name`, [today]);
    const pending = db.all<JoinedRow>(
      `${JOINED_SELECT} WHERE s.status = 'submitted' OR s.correction_status = 'submitted' ORDER BY s.first_submitted_at`,
    );
    const recent = db.all<JoinedRow>(
      `${JOINED_SELECT} WHERE s.first_submitted_at IS NOT NULL ORDER BY COALESCE(s.correction_submitted_at, s.first_submitted_at) DESC LIMIT 8`,
    );
    const counts = db.get<{ students: number; published: number; drafts: number }>(
      `SELECT (SELECT COUNT(*) FROM users WHERE role='student' AND active=1) AS students,
              (SELECT COUNT(*) FROM materials WHERE status='published') AS published,
              (SELECT COUNT(*) FROM materials WHERE status='draft') AS drafts`,
    )!;
    return c.json({
      today,
      todayItems: rows.map((x) => toListItem(x, false)),
      pending: pending.map((x) => toListItem(x, false)).filter((x) => x.needsGrading),
      recent: recent.map((x) => toListItem(x, false)),
      counts,
    });
  });

  // ---------------- 学生账号 ----------------
  r.get('/students', (c) => {
    const rows = db.all<UserRow>(`SELECT * FROM users WHERE role = 'student' ORDER BY active DESC, created_at`);
    return c.json({ students: rows.map(toUser) });
  });

  r.post('/students', async (c) => {
    const b = await c.req.json<{ username?: string; displayName?: string; password?: string }>();
    const username = (b.username ?? '').trim();
    const err = validateUsername(username) ?? validatePassword(b.password ?? '');
    if (err) return c.json({ error: err }, 400);
    if (db.get('SELECT id FROM users WHERE username = ?', [username])) return c.json({ error: '用户名已被使用' }, 400);
    const id = newId('u_');
    db.run(
      `INSERT INTO users(id, role, username, display_name, password_hash, active, created_at) VALUES (?, 'student', ?, ?, ?, 1, ?)`,
      [id, username, (b.displayName ?? '').trim() || username, await hashPassword(b.password!), nowIso()],
    );
    return c.json({ student: toUser(db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id])!) });
  });

  r.patch('/students/:id', async (c) => {
    const id = c.req.param('id');
    const row = db.get<UserRow>(`SELECT * FROM users WHERE id = ? AND role = 'student'`, [id]);
    if (!row) return c.json({ error: '找不到该学生' }, 404);
    const b = await c.req.json<{ displayName?: string; active?: boolean; password?: string }>();
    if (typeof b.displayName === 'string' && b.displayName.trim())
      db.run('UPDATE users SET display_name = ? WHERE id = ?', [b.displayName.trim(), id]);
    if (typeof b.active === 'boolean') {
      db.run('UPDATE users SET active = ? WHERE id = ?', [b.active ? 1 : 0, id]);
      if (!b.active) db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    }
    if (typeof b.password === 'string' && b.password) {
      const err = validatePassword(b.password);
      if (err) return c.json({ error: err }, 400);
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(b.password), id]);
      db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    }
    return c.json({ student: toUser(db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id])!) });
  });

  // ---------------- 精选题库 ----------------
  r.get('/materials', (c) => {
    const rows = db.all<MaterialRow & { assigned: number }>(
      `SELECT m.*, (SELECT COUNT(*) FROM assignments a WHERE a.material_id = m.id) AS assigned
       FROM materials m ORDER BY m.updated_at DESC`,
    );
    const materials: MaterialSummary[] = rows.map((row) => {
      const { body, questions, ...rest } = toMaterial(row);
      return { ...rest, questionCount: questions.length, wordCount: countWords(body), assignedCount: row.assigned };
    });
    return c.json({ materials });
  });

  r.get('/materials/:id', (c) => {
    const row = db.get<MaterialRow>('SELECT * FROM materials WHERE id = ?', [c.req.param('id')]);
    if (!row) return c.json({ error: '找不到该材料' }, 404);
    return c.json({ material: toMaterial(row) });
  });

  async function saveMaterial(id: string | null, b: Record<string, unknown>) {
    const title = String(b.title ?? '').trim();
    const source = String(b.source ?? '').trim();
    const body = String(b.body ?? '');
    const questions = cleanQuestions(b.questions);
    const answerRelease: AnswerRelease = b.answerRelease === 'after_grading' ? 'after_grading' : 'after_submit';
    const publish = b.publish === true;
    if (publish) {
      if (b.confirmed !== true) return { error: '请先勾选“我已核对内容、题目与答案，确认发布”。' };
      const errors = validateForPublish(title, body, questions);
      if (errors.length) return { error: errors.join('\n'), errors };
    } else if (!title) return { error: '请填写标题后再保存。' };
    const now = nowIso();
    const status = publish ? 'published' : 'draft';
    if (id) {
      const existing = db.get<MaterialRow>('SELECT * FROM materials WHERE id = ?', [id]);
      if (!existing) return { error: '找不到该材料', notFound: true };
      db.run(
        `UPDATE materials SET title=?, source=?, body=?, questions=?, status=?, answer_release=?, updated_at=?,
         published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END WHERE id = ?`,
        [title, source, body, JSON.stringify(questions), status, answerRelease, now, status, now, id],
      );
    } else {
      id = newId('m_');
      db.run(
        `INSERT INTO materials(id, kind, title, source, body, questions, status, answer_release, created_at, updated_at, published_at)
         VALUES (?, 'reading', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, source, body, JSON.stringify(questions), status, answerRelease, now, now, publish ? now : null],
      );
    }
    return { material: toMaterial(db.get<MaterialRow>('SELECT * FROM materials WHERE id = ?', [id])!) };
  }

  r.post('/materials', async (c) => {
    const res = await saveMaterial(null, await c.req.json());
    return 'error' in res ? c.json(res, 400) : c.json(res);
  });

  r.put('/materials/:id', async (c) => {
    const res = await saveMaterial(c.req.param('id'), await c.req.json());
    if ('notFound' in res) return c.json(res, 404);
    return 'error' in res ? c.json(res, 400) : c.json(res);
  });

  r.post('/materials/:id/duplicate', (c) => {
    const row = db.get<MaterialRow>('SELECT * FROM materials WHERE id = ?', [c.req.param('id')]);
    if (!row) return c.json({ error: '找不到该材料' }, 404);
    const id = newId('m_');
    const now = nowIso();
    db.run(
      `INSERT INTO materials(id, kind, title, source, body, questions, status, answer_release, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL)`,
      [id, row.kind, `${row.title}（副本）`, row.source, row.body, row.questions, row.answer_release, now, now],
    );
    return c.json({ material: toMaterial(db.get<MaterialRow>('SELECT * FROM materials WHERE id = ?', [id])!) });
  });

  r.delete('/materials/:id', (c) => {
    // 已布置的作业保存了快照，删除题库材料不影响它们
    db.run('DELETE FROM materials WHERE id = ?', [c.req.param('id')]);
    return c.json({ ok: true });
  });

  // ---------------- AI 配置中心 ----------------
  r.get('/ai/config', (c) =>
    c.json({ config: publicAiConfig(loadAiConfig(db)), readingScene: loadReadingScene(db) }),
  );

  r.put('/ai/config', async (c) => {
    const b = await c.req.json<{ baseUrl?: string; model?: string; apiKey?: string; clearKey?: boolean }>();
    const cur = loadAiConfig(db);
    const next = {
      baseUrl: (b.baseUrl ?? cur.baseUrl).trim(),
      model: (b.model ?? cur.model).trim(),
      apiKey: b.clearKey ? '' : b.apiKey && b.apiKey.trim() ? b.apiKey.trim() : cur.apiKey,
    };
    if (next.baseUrl && next.baseUrl.toLowerCase() !== 'mock' && !/^https?:\/\//i.test(next.baseUrl))
      return c.json({ error: '接口地址需要以 http:// 或 https:// 开头' }, 400);
    setSetting(db, AI_KEY, next);
    return c.json({ config: publicAiConfig(next) });
  });

  r.put('/ai/scenes/reading_generate', async (c) => {
    const b = await c.req.json<Partial<ReadingGenerateScene>>();
    const cur = loadReadingScene(db);
    const count = Math.round(Number(b.count ?? cur.count));
    if (!(count >= 1 && count <= 30)) return c.json({ error: '题目数量需在 1 到 30 之间' }, 400);
    const scene: ReadingGenerateScene = {
      enabled: b.enabled ?? cur.enabled,
      count,
      difficulty: String(b.difficulty ?? cur.difficulty).trim(),
      focus: String(b.focus ?? cur.focus).trim(),
      prompt: String(b.prompt ?? cur.prompt),
    };
    saveReadingScene(db, scene);
    return c.json({ readingScene: scene });
  });

  r.post('/ai/test', async (c) => {
    const started = Date.now();
    try {
      const reply = await chat(loadAiConfig(db), '请只回复 OK 两个字母。', { maxTokens: 20 });
      return c.json({ ok: true, reply: reply.slice(0, 200), ms: Date.now() - started });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  r.post('/ai/prompt', async (c) => {
    const b = await c.req.json<{ title?: string; body?: string }>();
    return c.json({ prompt: buildReadingPrompt(loadReadingScene(db), b.title ?? '', b.body ?? '') });
  });

  r.post('/ai/generate', async (c) => {
    const b = await c.req.json<{ title?: string; body?: string }>();
    const scene = loadReadingScene(db);
    if (!scene.enabled) return c.json({ error: '“阅读 · 辅助出题”场景已暂停，请到 AI 配置中心启用。' }, 400);
    if (!(b.body ?? '').trim()) return c.json({ error: '请先在“1 · 阅读内容”粘贴正文。' }, 400);
    let raw: string;
    try {
      raw = await chat(loadAiConfig(db), buildReadingPrompt(scene, b.title ?? '', b.body ?? ''));
    } catch (e) {
      return c.json({ error: e instanceof AiError ? e.message : `生成失败：${String(e)}` }, 502);
    }
    const parsed = parseQuestionsBlock(raw);
    let questions = parsed.items;
    const errors = [...parsed.errors];
    if (questions.length && /<solutions>/i.test(raw)) {
      const m = matchSolutions(questions, raw);
      questions = m.questions;
      errors.push(...m.errors);
    }
    return c.json({ raw, questions, errors });
  });

  // ---------------- 每日作业 ----------------
  r.get('/assignments', (c) => {
    const from = c.req.query('from') ?? '0000-01-01';
    const to = c.req.query('to') ?? '9999-12-31';
    const studentId = c.req.query('studentId');
    const rows = db.all<JoinedRow>(
      `${JOINED_SELECT} WHERE a.date BETWEEN ? AND ? ${studentId ? 'AND a.student_id = ?' : ''} ORDER BY a.date DESC, u.display_name, a.created_at`,
      studentId ? [from, to, studentId] : [from, to],
    );
    return c.json({ assignments: rows.map((x) => toListItem(x, false)) });
  });

  r.post('/assignments', async (c) => {
    const b = await c.req.json<{ studentIds?: string[]; dates?: string[]; materialIds?: string[] }>();
    const studentIds = [...new Set(b.studentIds ?? [])];
    const dates = [...new Set(b.dates ?? [])].filter(isValidDate);
    const materialIds = [...new Set(b.materialIds ?? [])];
    if (!studentIds.length) return c.json({ error: '请选择接收学生' }, 400);
    if (!dates.length) return c.json({ error: '请选择日期' }, 400);
    if (!materialIds.length) return c.json({ error: '请选择已发布材料' }, 400);
    if (studentIds.length * dates.length * materialIds.length > 500) return c.json({ error: '一次布置的作业太多，请分批布置' }, 400);
    const students = studentIds.map((id) => db.get<UserRow>(`SELECT * FROM users WHERE id = ? AND role = 'student' AND active = 1`, [id]));
    if (students.some((s) => !s)) return c.json({ error: '有学生不存在或已停用' }, 400);
    const mats = materialIds.map((id) => db.get<MaterialRow>('SELECT * FROM materials WHERE id = ?', [id]));
    if (mats.some((m) => !m)) return c.json({ error: '有材料不存在' }, 400);
    if (mats.some((m) => m!.status !== 'published')) return c.json({ error: '草稿材料不能布置，请先发布' }, 400);
    let created = 0;
    let skipped = 0;
    db.transaction(() => {
      for (const s of students)
        for (const date of dates)
          for (const m of mats) {
            const dup = db.get('SELECT id FROM assignments WHERE student_id = ? AND date = ? AND material_id = ?', [s!.id, date, m!.id]);
            if (dup) {
              skipped += 1;
              continue;
            }
            const mat = toMaterial(m!);
            const snapshot: MaterialSnapshot = {
              materialId: mat.id,
              kind: mat.kind,
              title: mat.title,
              source: mat.source,
              body: mat.body,
              questions: mat.questions,
              answerRelease: mat.answerRelease,
            };
            db.run('INSERT INTO assignments(id, student_id, material_id, date, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
              newId('a_'),
              s!.id,
              m!.id,
              date,
              JSON.stringify(snapshot),
              nowIso(),
            ]);
            created += 1;
          }
    });
    return c.json({ created, skipped });
  });

  r.delete('/assignments/:id', (c) => {
    const id = c.req.param('id');
    const sub = db.get<{ first_submitted_at: string | null }>('SELECT first_submitted_at FROM submissions WHERE assignment_id = ?', [id]);
    if (sub?.first_submitted_at && c.req.query('force') !== '1')
      return c.json({ error: '学生已提交这份作业，撤回会同时删除作答记录。确认要撤回吗？', needsForce: true }, 409);
    db.run('DELETE FROM submissions WHERE assignment_id = ?', [id]);
    db.run('DELETE FROM assignments WHERE id = ?', [id]);
    return c.json({ ok: true });
  });

  // ---------------- 作业批改 ----------------
  r.get('/grading', (c) => {
    const filter = c.req.query('filter') ?? 'pending';
    const rows = db.all<JoinedRow>(
      `${JOINED_SELECT} WHERE s.first_submitted_at IS NOT NULL ORDER BY COALESCE(s.correction_submitted_at, s.first_submitted_at) DESC LIMIT 300`,
    );
    let items = rows.map((x) => toListItem(x, false));
    if (filter === 'pending') items = items.filter((x) => x.needsGrading);
    if (filter === 'corrections')
      items = items.filter((x) => x.correctionStatus !== 'none' || x.correctionRequired || (x.score ?? 0) < x.total);
    return c.json({ items });
  });

  r.get('/grading/:id', (c) => {
    const row = loadJoined(db, c.req.param('id'));
    if (!row) return c.json({ error: '找不到该作业' }, 404);
    return c.json({ detail: toGradingDetail(row) });
  });

  r.post('/grading/:id', async (c) => {
    const id = c.req.param('id');
    const row = loadJoined(db, id);
    if (!row || !row.first_submitted_at) return c.json({ error: '学生还没有提交' }, 400);
    const b = await c.req.json<{
      teacherScores?: Record<string, number>;
      correctionTeacherScores?: Record<string, number>;
      questionComments?: Record<string, string>;
      comment?: string;
      correctionRequired?: boolean;
    }>();
    const snapshot = parseJson<MaterialSnapshot>(row.snapshot, null as unknown as MaterialSnapshot);
    const textQs = snapshot.questions.filter((q) => q.type === 'text');
    const clamp = (scores: Record<string, number> | undefined) => {
      const out: Record<string, number> = {};
      for (const q of textQs) {
        const v = scores?.[q.id];
        if (typeof v === 'number' && Number.isFinite(v)) out[q.id] = Math.max(0, Math.min(questionPoints(q), v));
      }
      return out;
    };
    const teacherScores = clamp(b.teacherScores);
    const firstAnswers = parseJson<Record<string, string>>(row.first_answers, {});
    const missing = textQs.filter((q) => (firstAnswers[q.id] ?? '').trim() && typeof teacherScores[q.id] !== 'number');
    if (missing.length) return c.json({ error: `请为表达题评分：${missing.map((q) => q.id).join('、')}` }, 400);
    const now = nowIso();
    let correctionStatus = row.correction_status ?? 'none';
    const correctionTeacherScores = clamp(b.correctionTeacherScores);
    if (correctionStatus === 'submitted') {
      const corr = parseJson<Record<string, string>>(row.correction_answers, {});
      const merged: Record<string, number> = {};
      for (const q of textQs) {
        if (typeof correctionTeacherScores[q.id] === 'number') merged[q.id] = correctionTeacherScores[q.id];
        else if ((corr[q.id] ?? '').trim() === (firstAnswers[q.id] ?? '').trim()) merged[q.id] = teacherScores[q.id];
      }
      if (!gradeAttempt(snapshot.questions, corr, merged).pendingManual) correctionStatus = 'graded';
    }
    const comments: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.questionComments ?? {})) if (typeof v === 'string' && v.trim()) comments[k] = v.trim();
    db.run(
      `UPDATE submissions SET status='graded', teacher_scores=?, correction_teacher_scores=?, question_comments=?, teacher_comment=?,
       correction_required=?, correction_status=?, graded_at=?, feedback_at=? WHERE assignment_id=?`,
      [
        JSON.stringify(teacherScores),
        JSON.stringify(correctionTeacherScores),
        JSON.stringify(comments),
        (b.comment ?? '').trim(),
        b.correctionRequired ? 1 : 0,
        correctionStatus,
        now,
        now,
        id,
      ],
    );
    return c.json({ detail: toGradingDetail(loadJoined(db, id)!) });
  });

  return r;
}
