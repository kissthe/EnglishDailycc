import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { openNodeDb } from '../src/server/sqlite-node';
import { seedDemo } from '../src/server/seed';
import { dateInZone } from '../src/shared/dates';

type App = ReturnType<typeof createApp>;
const TZ = 'Asia/Shanghai';

async function call(app: App, method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as any };
}

async function login(app: App, username: string, password = 'demo123') {
  const r = await call(app, 'POST', '/auth/login', undefined, { username, password });
  expect(r.status).toBe(200);
  return r.data.token as string;
}

describe('API', () => {
  let app: App;
  beforeEach(async () => {
    const db = openNodeDb(':memory:');
    app = createApp({ db, timeZone: TZ });
    await seedDemo(db, dateInZone(new Date(), TZ));
  });

  it('首次初始化只能创建一次教师账号', async () => {
    const fresh = createApp({ db: openNodeDb(':memory:'), timeZone: TZ });
    expect((await call(fresh, 'GET', '/setup/status')).data.needsSetup).toBe(true);
    const r = await call(fresh, 'POST', '/setup', undefined, { username: 'wang', password: 'secret12', displayName: '王老师' });
    expect(r.status).toBe(200);
    expect(r.data.user.role).toBe('teacher');
    expect((await call(fresh, 'POST', '/setup', undefined, { username: 'x2', password: 'secret12' })).status).toBe(400);
  });

  it('学生不能访问教师接口，错误密码被拒绝', async () => {
    const s = await login(app, 'lihua');
    expect((await call(app, 'GET', '/t/materials', s)).status).toBe(403);
    expect((await call(app, 'POST', '/auth/login', undefined, { username: 'lihua', password: 'nope' })).status).toBe(401);
    expect((await call(app, 'GET', '/t/materials')).status).toBe(401);
  });

  it('答案开放前不会把答案发给学生；提交后自动判分并开放', async () => {
    const s = await login(app, 'lihua');
    const list = await call(app, 'GET', '/s/my/assignments', s);
    const todayItem = list.data.assignments.find((a: any) => a.date === list.data.today);
    expect(list.data.upcomingCount).toBe(1);
    const d = await call(app, 'GET', `/s/my/assignments/${todayItem.id}`, s);
    expect(d.data.detail.snapshot.questions[0].answer).toBeUndefined();
    expect(d.data.detail.released).toBe(false);

    const save = await call(app, 'PUT', `/s/my/assignments/${todayItem.id}/draft`, s, { mode: 'first', answers: { q1: 'x' } });
    expect(save.status).toBe(200);

    const answers = {
      q1: 'Because the students were learning about inventions.',
      q2: 'By bus.',
      q3: 'Mr. Chen told them a joke.',
      q4: 'A class trip to a science museum.',
    };
    const sub = await call(app, 'POST', `/s/my/assignments/${todayItem.id}/submit`, s, { mode: 'first', answers });
    expect(sub.data.detail.status).toBe('graded');
    expect(sub.data.detail.released).toBe(true);
    expect(sub.data.detail.firstResult.score).toBe(3);
    expect(sub.data.detail.snapshot.questions[0].answer).toBeTruthy();
    // 不能重复提交
    expect((await call(app, 'POST', `/s/my/assignments/${todayItem.id}/submit`, s, { mode: 'first', answers })).status).toBe(400);

    // 订正：进行中隐藏答案，提交后保留首次成绩
    const start = await call(app, 'POST', `/s/my/assignments/${todayItem.id}/start-correction`, s);
    expect(start.data.detail.correctionStatus).toBe('in_progress');
    expect(start.data.detail.snapshot.questions[0].answer).toBeUndefined();
    const corr = await call(app, 'POST', `/s/my/assignments/${todayItem.id}/submit`, s, {
      mode: 'correction',
      answers: { ...answers, q3: 'The robot gave a funny answer.' },
      notes: { q3: '原文 Everyone laughed 前面是机器人的回答' },
    });
    expect(corr.data.detail.correctionStatus).toBe('graded');
    expect(corr.data.detail.correctionResult.score).toBe(4);
    expect(corr.data.detail.firstResult.score).toBe(3);
  });

  it('批改后开放：表达题需教师评分，评分后学生看到反馈', async () => {
    const t = await login(app, 'teacher');
    const pending = await call(app, 'GET', '/t/grading?filter=pending', t);
    expect(pending.data.items.length).toBe(1);
    const id = pending.data.items[0].id;

    const s = await login(app, 'lihua');
    const before = await call(app, 'GET', `/s/my/assignments/${id}`, s);
    expect(before.data.detail.released).toBe(false);
    expect(before.data.detail.firstResult).toBeNull();

    expect((await call(app, 'POST', `/t/grading/${id}`, t, { comment: 'ok' })).status).toBe(400);
    const g = await call(app, 'POST', `/t/grading/${id}`, t, { teacherScores: { q4: 1 }, comment: '注意所有格', correctionRequired: true });
    expect(g.status).toBe(200);
    expect(g.data.detail.firstResult.score).toBe(3);

    const after = await call(app, 'GET', `/s/my/assignments/${id}`, s);
    expect(after.data.detail.released).toBe(true);
    expect(after.data.detail.hasNewFeedback).toBe(true);
    expect(after.data.detail.teacherComment).toBe('注意所有格');
    const seen = await call(app, 'POST', `/s/my/assignments/${id}/feedback-seen`, s);
    expect(seen.data.detail.hasNewFeedback).toBe(false);

    // 订正时改了表达题 → 需要教师再次批改
    await call(app, 'POST', `/s/my/assignments/${id}/start-correction`, s);
    const corr = await call(app, 'POST', `/s/my/assignments/${id}/submit`, s, {
      mode: 'correction',
      answers: { ...after.data.detail.firstAnswers, q2: "Focusing on one's own progress.", q4: "The uncle's advice helped." },
    });
    expect(corr.data.detail.correctionStatus).toBe('submitted');
    const again = await call(app, 'POST', `/t/grading/${id}`, t, { teacherScores: { q4: 1 }, correctionTeacherScores: { q4: 2 } });
    expect(again.data.detail.correctionStatus).toBe('graded');
    expect(again.data.detail.correctionResult.score).toBe(5);
    expect(again.data.detail.firstResult.score).toBe(3);
  });

  it('题库：发布需要确认和完整答案；草稿不能布置；布置保存快照', async () => {
    const t = await login(app, 'teacher');
    const body = { title: 'Test', body: 'Hello world.', questions: [{ id: 'q1', type: 'choice', prompt: 'P?', options: ['a', 'b'] }] };
    const draft = await call(app, 'POST', '/t/materials', t, body);
    expect(draft.status).toBe(200);
    const mid = draft.data.material.id;
    expect((await call(app, 'PUT', `/t/materials/${mid}`, t, { ...body, publish: true, confirmed: true })).status).toBe(400);
    expect((await call(app, 'PUT', `/t/materials/${mid}`, t, { ...body, questions: [{ ...body.questions[0], answer: 'a' }], publish: true })).status).toBe(400);

    const students = (await call(app, 'GET', '/t/students', t)).data.students;
    const today = dateInZone(new Date(), TZ);
    const bad = await call(app, 'POST', '/t/assignments', t, { studentIds: [students[0].id], dates: [today], materialIds: [mid] });
    expect(bad.status).toBe(400);

    const pub = await call(app, 'PUT', `/t/materials/${mid}`, t, {
      ...body,
      questions: [{ ...body.questions[0], answer: 'a' }],
      publish: true,
      confirmed: true,
    });
    expect(pub.data.material.status).toBe('published');
    const ok = await call(app, 'POST', '/t/assignments', t, { studentIds: [students[0].id], dates: [today], materialIds: [mid] });
    expect(ok.data.created).toBe(1);
    const dup = await call(app, 'POST', '/t/assignments', t, { studentIds: [students[0].id], dates: [today], materialIds: [mid] });
    expect(dup.data.skipped).toBe(1);

    // 修改题库不影响已布置作业
    await call(app, 'PUT', `/t/materials/${mid}`, t, { ...body, title: 'Changed', questions: [{ ...body.questions[0], answer: 'a' }], publish: true, confirmed: true });
    const s = await login(app, 'lihua');
    const mine = await call(app, 'GET', '/s/my/assignments', s);
    expect(mine.data.assignments.some((a: any) => a.title === 'Test')).toBe(true);
    expect(mine.data.assignments.some((a: any) => a.title === 'Changed')).toBe(false);
  });

  it('AI 模拟出题能生成可解析的题目', async () => {
    const t = await login(app, 'teacher');
    const materials = (await call(app, 'GET', '/t/materials', t)).data.materials;
    const draft = materials.find((m: any) => m.status === 'draft');
    const full = (await call(app, 'GET', `/t/materials/${draft.id}`, t)).data.material;
    const gen = await call(app, 'POST', '/t/ai/generate', t, { title: full.title, body: full.body });
    expect(gen.status).toBe(200);
    expect(gen.data.errors).toEqual([]);
    expect(gen.data.questions.length).toBe(4);
    expect(gen.data.questions.every((q: any) => q.options.includes(q.answer))).toBe(true);
    const test = await call(app, 'POST', '/t/ai/test', t);
    expect(test.data.ok).toBe(true);
  });
});
