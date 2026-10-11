import { Hono } from 'hono';
import { dateInZone } from '../../shared/dates';
import { gradeAttempt, needsTeacherGrading } from '../../shared/grading';
import type { Answers, MaterialSnapshot, Notes } from '../../shared/types';
import type { AppEnv } from '../auth';
import { type Db, nowIso, parseJson } from '../db';
import { JOINED_SELECT, type JoinedRow, isReleased, loadJoined, toListItem, toStudentDetail } from '../records';

const MAX_LEN = 5000;

function cleanMap(input: unknown, ids: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (ids.has(k) && typeof v === 'string') out[k] = v.slice(0, MAX_LEN);
  }
  return out;
}

export function studentRoutes(db: Db, timeZone?: string) {
  const r = new Hono<AppEnv>();
  const today = () => dateInZone(new Date(), timeZone);

  r.get('/my/assignments', (c) => {
    const user = c.get('user');
    const t = today();
    const rows = db.all<JoinedRow>(`${JOINED_SELECT} WHERE a.student_id = ? AND a.date <= ? ORDER BY a.date DESC, a.created_at`, [user.id, t]);
    const upcoming = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM assignments WHERE student_id = ? AND date > ?', [user.id, t]);
    return c.json({ today: t, assignments: rows.map((x) => toListItem(x, true)), upcomingCount: upcoming?.n ?? 0 });
  });

  /** 读取并校验归属；未到日期的作业不开放 */
  function own(c: { get: (k: 'user') => { id: string } }, id: string): JoinedRow | null {
    const row = loadJoined(db, id);
    if (!row || row.student_id !== c.get('user').id || row.date > today()) return null;
    return row;
  }

  function ensureSubmission(id: string) {
    db.run(`INSERT OR IGNORE INTO submissions(assignment_id, status) VALUES (?, 'in_progress')`, [id]);
  }

  r.get('/my/assignments/:id', (c) => {
    const row = own(c, c.req.param('id'));
    if (!row) return c.json({ error: '找不到这份作业' }, 404);
    return c.json({ detail: toStudentDetail(row) });
  });

  r.put('/my/assignments/:id/draft', async (c) => {
    const id = c.req.param('id');
    const row = own(c, id);
    if (!row) return c.json({ error: '找不到这份作业' }, 404);
    const b = await c.req.json<{ mode?: 'first' | 'correction'; answers?: Answers; notes?: Notes }>();
    const snapshot = parseJson<MaterialSnapshot>(row.snapshot, null as unknown as MaterialSnapshot);
    const ids = new Set(snapshot.questions.map((q) => q.id));
    const answers = cleanMap(b.answers, ids);
    const now = nowIso();
    if (b.mode === 'correction') {
      if (row.correction_status !== 'in_progress') return c.json({ error: '当前不在订正状态' }, 400);
      db.run('UPDATE submissions SET correction_draft = ?, correction_draft_saved_at = ? WHERE assignment_id = ?', [
        JSON.stringify({ answers, notes: cleanMap(b.notes, ids) }),
        now,
        id,
      ]);
    } else {
      if (row.first_submitted_at) return c.json({ error: '已经提交，不能再修改首次作答' }, 400);
      ensureSubmission(id);
      db.run('UPDATE submissions SET draft = ?, draft_saved_at = ? WHERE assignment_id = ?', [JSON.stringify({ answers }), now, id]);
    }
    return c.json({ savedAt: now });
  });

  r.post('/my/assignments/:id/submit', async (c) => {
    const id = c.req.param('id');
    const row = own(c, id);
    if (!row) return c.json({ error: '找不到这份作业' }, 404);
    const b = await c.req.json<{ mode?: 'first' | 'correction'; answers?: Answers; notes?: Notes }>();
    const snapshot = parseJson<MaterialSnapshot>(row.snapshot, null as unknown as MaterialSnapshot);
    const ids = new Set(snapshot.questions.map((q) => q.id));
    const answers = cleanMap(b.answers, ids);
    const now = nowIso();
    if (b.mode === 'correction') {
      if (row.correction_status !== 'in_progress') return c.json({ error: '当前不在订正状态' }, 400);
      const first = parseJson<Answers>(row.first_answers, {});
      const teacherScores = parseJson<Record<string, number>>(row.teacher_scores, {});
      // 没改动的表达题沿用首次评分
      const carried: Record<string, number> = {};
      for (const q of snapshot.questions)
        if (q.type === 'text' && (first[q.id] ?? '').trim() === (answers[q.id] ?? '').trim() && typeof teacherScores[q.id] === 'number')
          carried[q.id] = teacherScores[q.id];
      const pending = gradeAttempt(snapshot.questions, answers, carried).pendingManual;
      db.run(
        `UPDATE submissions SET correction_answers = ?, correction_notes = ?, correction_submitted_at = ?, correction_status = ?,
         correction_teacher_scores = '{}' WHERE assignment_id = ?`,
        [JSON.stringify(answers), JSON.stringify(cleanMap(b.notes, ids)), now, pending ? 'submitted' : 'graded', id],
      );
    } else {
      if (row.first_submitted_at) return c.json({ error: '这份作业已经提交过了' }, 400);
      ensureSubmission(id);
      const status = needsTeacherGrading(snapshot) ? 'submitted' : 'graded';
      db.run(
        `UPDATE submissions SET first_answers = ?, first_submitted_at = ?, status = ?, draft = ?, draft_saved_at = ?,
         graded_at = CASE WHEN ? = 'graded' THEN ? ELSE graded_at END WHERE assignment_id = ?`,
        [JSON.stringify(answers), now, status, JSON.stringify({ answers }), now, status, now, id],
      );
    }
    return c.json({ detail: toStudentDetail(loadJoined(db, id)!) });
  });

  r.post('/my/assignments/:id/start-correction', (c) => {
    const id = c.req.param('id');
    const row = own(c, id);
    if (!row) return c.json({ error: '找不到这份作业' }, 404);
    const snapshot = parseJson<MaterialSnapshot>(row.snapshot, null as unknown as MaterialSnapshot);
    if (!row.status || !isReleased(snapshot, row.status)) return c.json({ error: '答案开放后才能订正' }, 400);
    if (row.correction_status && row.correction_status !== 'none') return c.json({ error: '已经开始过订正' }, 400);
    db.run(
      `UPDATE submissions SET correction_status = 'in_progress', correction_draft = ?, correction_draft_saved_at = NULL WHERE assignment_id = ?`,
      [JSON.stringify({ answers: parseJson(row.first_answers, {}), notes: {} }), id],
    );
    return c.json({ detail: toStudentDetail(loadJoined(db, id)!) });
  });

  r.post('/my/assignments/:id/feedback-seen', (c) => {
    const id = c.req.param('id');
    const row = own(c, id);
    if (!row) return c.json({ error: '找不到这份作业' }, 404);
    db.run('UPDATE submissions SET feedback_seen_at = ? WHERE assignment_id = ?', [nowIso(), id]);
    return c.json({ detail: toStudentDetail(loadJoined(db, id)!) });
  });

  return r;
}
