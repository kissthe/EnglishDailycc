// 作业与作答记录的读取和组装
import { gradeAttempt, needsTeacherGrading, stripAnswers } from '../shared/grading';
import type {
  Answers,
  AssignmentListItem,
  CorrectionStatus,
  GradingDetail,
  Material,
  MaterialSnapshot,
  Notes,
  StudentAssignmentDetail,
  SubmissionStatus,
} from '../shared/types';
import { type Db, parseJson } from './db';

export interface MaterialRow {
  id: string;
  kind: 'reading';
  title: string;
  source: string;
  body: string;
  questions: string;
  status: 'draft' | 'published';
  answer_release: 'after_submit' | 'after_grading';
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export function toMaterial(r: MaterialRow): Material {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    source: r.source,
    body: r.body,
    questions: parseJson(r.questions, []),
    status: r.status,
    answerRelease: r.answer_release,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publishedAt: r.published_at,
  };
}

export interface JoinedRow {
  id: string;
  student_id: string;
  student_name: string;
  material_id: string;
  date: string;
  snapshot: string;
  created_at: string;
  status: SubmissionStatus | null;
  draft: string | null;
  draft_saved_at: string | null;
  first_answers: string | null;
  first_submitted_at: string | null;
  teacher_scores: string | null;
  question_comments: string | null;
  teacher_comment: string | null;
  correction_required: number | null;
  graded_at: string | null;
  correction_status: CorrectionStatus | null;
  correction_draft: string | null;
  correction_draft_saved_at: string | null;
  correction_answers: string | null;
  correction_notes: string | null;
  correction_submitted_at: string | null;
  correction_teacher_scores: string | null;
  feedback_at: string | null;
  feedback_seen_at: string | null;
}

export const JOINED_SELECT = `
SELECT a.id, a.student_id, u.display_name AS student_name, a.material_id, a.date, a.snapshot, a.created_at,
  s.status, s.draft, s.draft_saved_at, s.first_answers, s.first_submitted_at, s.teacher_scores,
  s.question_comments, s.teacher_comment, s.correction_required, s.graded_at, s.correction_status,
  s.correction_draft, s.correction_draft_saved_at, s.correction_answers, s.correction_notes,
  s.correction_submitted_at, s.correction_teacher_scores, s.feedback_at, s.feedback_seen_at
FROM assignments a
JOIN users u ON u.id = a.student_id
LEFT JOIN submissions s ON s.assignment_id = a.id`;

export function loadJoined(db: Db, assignmentId: string): JoinedRow | undefined {
  return db.get<JoinedRow>(`${JOINED_SELECT} WHERE a.id = ?`, [assignmentId]);
}

export function isReleased(snapshot: MaterialSnapshot, status: SubmissionStatus): boolean {
  if (snapshot.answerRelease === 'after_submit') return status === 'submitted' || status === 'graded';
  return status === 'graded';
}

function hasNewFeedback(r: JoinedRow): boolean {
  return !!r.feedback_at && (!r.feedback_seen_at || r.feedback_seen_at < r.feedback_at);
}

/** 订正中没改动的表达题沿用首次评分，改动过的需要教师重新评分 */
function correctionScores(
  snapshot: MaterialSnapshot,
  first: Answers | null,
  correction: Answers,
  teacherScores: Record<string, number>,
  correctionTeacherScores: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of snapshot.questions) {
    if (q.type !== 'text') continue;
    if (typeof correctionTeacherScores[q.id] === 'number') out[q.id] = correctionTeacherScores[q.id];
    else if ((first?.[q.id] ?? '').trim() === (correction[q.id] ?? '').trim() && typeof teacherScores[q.id] === 'number')
      out[q.id] = teacherScores[q.id];
  }
  return out;
}

function fullDetail(r: JoinedRow) {
  const snapshot = parseJson<MaterialSnapshot>(r.snapshot, null as unknown as MaterialSnapshot);
  const status: SubmissionStatus = r.status ?? 'not_started';
  const teacherScores = parseJson<Record<string, number>>(r.teacher_scores, {});
  const correctionTeacherScores = parseJson<Record<string, number>>(r.correction_teacher_scores, {});
  const firstAnswers = r.first_answers ? parseJson<Answers>(r.first_answers, {}) : null;
  const correctionAnswers = r.correction_answers ? parseJson<Answers>(r.correction_answers, {}) : null;
  const draft = parseJson<{ answers?: Answers }>(r.draft, {});
  const cdraft = parseJson<{ answers?: Answers; notes?: Notes }>(r.correction_draft, {});
  return {
    snapshot,
    status,
    teacherScores,
    correctionTeacherScores,
    firstAnswers,
    correctionAnswers,
    firstResult: firstAnswers ? gradeAttempt(snapshot.questions, firstAnswers, teacherScores) : null,
    correctionResult: correctionAnswers
      ? gradeAttempt(snapshot.questions, correctionAnswers, correctionScores(snapshot, firstAnswers, correctionAnswers, teacherScores, correctionTeacherScores))
      : null,
    draft: { answers: draft.answers ?? {}, savedAt: r.draft_saved_at },
    correctionDraft: { answers: cdraft.answers ?? {}, notes: cdraft.notes ?? {}, savedAt: r.correction_draft_saved_at },
  };
}

export function toStudentDetail(r: JoinedRow): StudentAssignmentDetail {
  const d = fullDetail(r);
  const released = isReleased(d.snapshot, d.status);
  const correctionStatus: CorrectionStatus = r.correction_status ?? 'none';
  // 订正进行中只告诉学生对错，不直接给出答案；订正提交后再完整开放
  const showAnswers = released && correctionStatus !== 'in_progress';
  const snapshot: MaterialSnapshot = showAnswers ? d.snapshot : { ...d.snapshot, questions: stripAnswers(d.snapshot.questions) };
  return {
    id: r.id,
    date: r.date,
    snapshot,
    status: d.status,
    draft: d.draft,
    firstAnswers: d.firstAnswers,
    firstSubmittedAt: r.first_submitted_at,
    released,
    firstResult: released ? d.firstResult : null,
    teacherComment: released ? (r.teacher_comment ?? '') : '',
    questionComments: released ? parseJson(r.question_comments, {}) : {},
    correctionRequired: r.correction_required === 1,
    correctionStatus,
    correctionDraft: d.correctionDraft,
    correctionAnswers: d.correctionAnswers,
    correctionNotes: parseJson(r.correction_notes, {}),
    correctionResult: d.correctionResult,
    correctionSubmittedAt: r.correction_submitted_at,
    hasNewFeedback: hasNewFeedback(r),
  };
}

export function toGradingDetail(r: JoinedRow): GradingDetail {
  const d = fullDetail(r);
  return {
    id: r.id,
    date: r.date,
    studentName: r.student_name,
    snapshot: d.snapshot,
    status: d.status,
    draft: d.draft,
    firstAnswers: d.firstAnswers,
    firstSubmittedAt: r.first_submitted_at,
    firstResult: d.firstResult,
    teacherComment: r.teacher_comment ?? '',
    questionComments: parseJson(r.question_comments, {}),
    correctionRequired: r.correction_required === 1,
    correctionStatus: r.correction_status ?? 'none',
    correctionDraft: d.correctionDraft,
    correctionAnswers: d.correctionAnswers,
    correctionNotes: parseJson(r.correction_notes, {}),
    correctionResult: d.correctionResult,
    correctionSubmittedAt: r.correction_submitted_at,
    hasNewFeedback: hasNewFeedback(r),
    teacherScores: d.teacherScores,
    correctionTeacherScores: d.correctionTeacherScores,
    gradedAt: r.graded_at,
    needsGrading: needsTeacherGrading(d.snapshot),
  };
}

export function toListItem(r: JoinedRow, forStudent: boolean): AssignmentListItem {
  const d = fullDetail(r);
  const released = isReleased(d.snapshot, d.status);
  const showScore = !forStudent || released;
  const needsGrading =
    d.status === 'submitted' ||
    (r.correction_status === 'submitted' && !!d.correctionResult?.pendingManual);
  return {
    id: r.id,
    date: r.date,
    title: d.snapshot.title,
    kind: d.snapshot.kind,
    materialId: r.material_id,
    studentId: r.student_id,
    studentName: r.student_name,
    questionCount: d.snapshot.questions.length,
    status: d.status,
    correctionStatus: r.correction_status ?? 'none',
    correctionRequired: r.correction_required === 1,
    submittedAt: r.first_submitted_at,
    score: showScore && d.firstResult ? d.firstResult.score : null,
    total: d.firstResult?.total ?? d.snapshot.questions.reduce((n, q) => n + (q.points && q.points > 0 ? q.points : 1), 0),
    correctionScore: showScore && d.correctionResult ? d.correctionResult.score : null,
    hasNewFeedback: hasNewFeedback(r),
    needsGrading,
  };
}
