import type { Answers, AttemptResult, MaterialSnapshot, Question, QuestionResult } from './types';

export function questionPoints(q: Question): number {
  return q.points && q.points > 0 ? q.points : 1;
}

/** 宽松比较：忽略大小写、多余空格、弯引号和句末标点 */
export function normalizeAnswer(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[.。!！?？,，;；]+$/, '')
    .trim();
}

export function acceptableAnswers(q: Question): string[] {
  return (q.answer ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 返回 null 表示需要教师评分 */
export function checkAnswer(q: Question, given: string | undefined): boolean | null {
  if (q.type === 'text') return null;
  const value = (given ?? '').trim();
  if (!value) return false;
  if (q.type === 'choice') return value === (q.answer ?? '').trim();
  const norm = normalizeAnswer(value);
  return acceptableAnswers(q).some((a) => normalizeAnswer(a) === norm);
}

export function gradeAttempt(
  questions: Question[],
  answers: Answers,
  teacherScores: Record<string, number> = {},
): AttemptResult {
  const perQuestion: Record<string, QuestionResult> = {};
  let score = 0;
  let total = 0;
  let pendingManual = false;
  for (const q of questions) {
    const max = questionPoints(q);
    total += max;
    if (q.type === 'text') {
      const t = teacherScores[q.id];
      if (typeof t === 'number') {
        const s = Math.max(0, Math.min(max, t));
        perQuestion[q.id] = { correct: s >= max, score: s, max };
        score += s;
      } else if (!(answers[q.id] ?? '').trim()) {
        perQuestion[q.id] = { correct: false, score: 0, max };
      } else {
        perQuestion[q.id] = { correct: null, score: null, max };
        pendingManual = true;
      }
      continue;
    }
    const ok = checkAnswer(q, answers[q.id]) === true;
    perQuestion[q.id] = { correct: ok, score: ok ? max : 0, max };
    if (ok) score += max;
  }
  return { perQuestion, score, total, pendingManual };
}

export function hasManualQuestions(questions: Question[]): boolean {
  return questions.some((q) => q.type === 'text');
}

/** 是否需要教师批改：有表达题，或答案设为批改后开放 */
export function needsTeacherGrading(snapshot: MaterialSnapshot): boolean {
  return snapshot.answerRelease === 'after_grading' || hasManualQuestions(snapshot.questions);
}

/** 去掉答案和解析，用于答案开放前发给学生 */
export function stripAnswers(questions: Question[]): Question[] {
  return questions.map(({ answer: _a, explanation: _e, ...rest }) => rest);
}

export function unansweredIds(questions: Question[], answers: Answers): string[] {
  return questions.filter((q) => !(answers[q.id] ?? '').trim()).map((q) => q.id);
}
