// 前后端共用的数据结构

export type Role = 'teacher' | 'student';

export interface User {
  id: string;
  role: Role;
  username: string;
  displayName: string;
  active: boolean;
  createdAt: string;
}

/** choice：单项选择；blank：填空（含语篇填空）；text：表达题，由教师评分 */
export type QuestionType = 'choice' | 'blank' | 'text';

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  /** 仅选择题 */
  options?: string[];
  /**
   * choice：正确选项的完整文字
   * blank：可接受答案，多个用 | 分隔
   * text：参考答案（不自动判分）
   */
  answer?: string;
  explanation?: string;
  /** 考查点，例如 主旨大意 / 细节理解 / 推理判断 / 定语从句 */
  tag?: string;
  points?: number;
}

export type MaterialKind = 'reading';
export type MaterialStatus = 'draft' | 'published';
/** 答案与解析开放时间 */
export type AnswerRelease = 'after_submit' | 'after_grading';

export interface Material {
  id: string;
  kind: MaterialKind;
  title: string;
  source: string;
  body: string;
  questions: Question[];
  status: MaterialStatus;
  answerRelease: AnswerRelease;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export type MaterialSummary = Omit<Material, 'body' | 'questions'> & {
  questionCount: number;
  wordCount: number;
  assignedCount: number;
};

/** 布置时保存的材料快照，题库修改不影响已布置作业 */
export interface MaterialSnapshot {
  materialId: string;
  kind: MaterialKind;
  title: string;
  source: string;
  body: string;
  questions: Question[];
  answerRelease: AnswerRelease;
}

export type Answers = Record<string, string>;
export type Notes = Record<string, string>;

export type SubmissionStatus = 'not_started' | 'in_progress' | 'submitted' | 'graded';
export type CorrectionStatus = 'none' | 'in_progress' | 'submitted' | 'graded';

export interface QuestionResult {
  /** null 表示待教师评分 */
  correct: boolean | null;
  score: number | null;
  max: number;
}

export interface AttemptResult {
  perQuestion: Record<string, QuestionResult>;
  score: number;
  total: number;
  /** 是否还有表达题等待教师评分 */
  pendingManual: boolean;
}

export interface AssignmentListItem {
  id: string;
  date: string;
  title: string;
  kind: MaterialKind;
  materialId: string;
  studentId: string;
  studentName: string;
  questionCount: number;
  status: SubmissionStatus;
  correctionStatus: CorrectionStatus;
  correctionRequired: boolean;
  submittedAt: string | null;
  /** 学生端只在答案开放后返回 */
  score: number | null;
  total: number;
  correctionScore: number | null;
  hasNewFeedback: boolean;
  needsGrading: boolean;
}

export interface StudentAssignmentDetail {
  id: string;
  date: string;
  snapshot: MaterialSnapshot;
  status: SubmissionStatus;
  draft: { answers: Answers; savedAt: string | null };
  firstAnswers: Answers | null;
  firstSubmittedAt: string | null;
  /** 答案与解析是否已开放 */
  released: boolean;
  firstResult: AttemptResult | null;
  teacherComment: string;
  questionComments: Record<string, string>;
  correctionRequired: boolean;
  correctionStatus: CorrectionStatus;
  correctionDraft: { answers: Answers; notes: Notes; savedAt: string | null };
  correctionAnswers: Answers | null;
  correctionNotes: Notes;
  correctionResult: AttemptResult | null;
  correctionSubmittedAt: string | null;
  hasNewFeedback: boolean;
}

export interface GradingDetail extends Omit<StudentAssignmentDetail, 'released'> {
  studentName: string;
  teacherScores: Record<string, number>;
  correctionTeacherScores: Record<string, number>;
  gradedAt: string | null;
  needsGrading: boolean;
}

export interface AiConfig {
  baseUrl: string;
  model: string;
  /** 读取时只返回是否已设置 */
  hasKey: boolean;
  keyPreview: string;
}

export interface ReadingGenerateScene {
  enabled: boolean;
  count: number;
  difficulty: string;
  focus: string;
  prompt: string;
}
