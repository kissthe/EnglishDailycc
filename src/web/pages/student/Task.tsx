import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatDateCn } from '../../../shared/dates';
import { unansweredIds } from '../../../shared/grading';
import type { Answers, Notes, StudentAssignmentDetail } from '../../../shared/types';
import { get, post, put } from '../../api';
import { Practice } from '../../components/Practice';
import { loadJson, remove, save } from '../../storage';
import { ErrorBox, Loading, formatTime, useLoad, useToast } from '../../ui';

type Mode = 'first' | 'correction';
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: string } | { kind: 'local'; at: string; error: string };

interface LocalDraft {
  answers: Answers;
  notes?: Notes;
  at: string;
}

const localKey = (id: string, mode: Mode) => `ed_draft_${id}_${mode}`;

function same(a: Record<string, string>, b: Record<string, string>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? '') !== (b[k] ?? '')) return false;
  return true;
}

/** 作答草稿：每次改动先存本机，1.2 秒后同步到服务器 */
function useDraft(id: string, mode: Mode, initial: { answers: Answers; notes?: Notes; savedAt: string | null }, active: boolean) {
  const [answers, setAnswers] = useState<Answers>(initial.answers);
  const [notes, setNotes] = useState<Notes>(initial.notes ?? {});
  const [state, setState] = useState<SaveState>(initial.savedAt ? { kind: 'saved', at: initial.savedAt } : { kind: 'idle' });
  const [restore, setRestore] = useState<LocalDraft | null>(null);
  const dirty = useRef(false);
  const latest = useRef({ answers, notes });
  latest.current = { answers, notes };

  // 本机有比服务器更新的草稿时提示恢复
  useEffect(() => {
    if (!active) return;
    const local = loadJson<LocalDraft>(localKey(id, mode));
    if (local && local.at > (initial.savedAt ?? '') && !(same(local.answers, initial.answers) && same(local.notes ?? {}, initial.notes ?? {})))
      setRestore(local);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mode, active]);

  const flush = useCallback(async () => {
    if (!active) return false;
    dirty.current = false;
    setState({ kind: 'saving' });
    try {
      const r = await put<{ savedAt: string }>(`/s/my/assignments/${id}/draft`, { mode, ...latest.current });
      setState({ kind: 'saved', at: r.savedAt });
      return true;
    } catch (e) {
      setState({ kind: 'local', at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }, [id, mode, active]);

  useEffect(() => {
    if (!dirty.current || !active) return;
    save(localKey(id, mode), JSON.stringify({ answers, notes, at: new Date().toISOString() }));
    const t = setTimeout(flush, 1200);
    return () => clearTimeout(t);
  }, [answers, notes, flush, id, mode, active]);

  // 离开页面前尽量保存
  useEffect(() => {
    return () => {
      if (dirty.current) void flush();
    };
  }, [flush]);

  return {
    answers,
    notes,
    state,
    restore,
    flush,
    setAnswer: (qid: string, v: string) => {
      dirty.current = true;
      setAnswers((a) => ({ ...a, [qid]: v }));
    },
    setNote: (qid: string, v: string) => {
      dirty.current = true;
      setNotes((n) => ({ ...n, [qid]: v }));
    },
    acceptRestore: () => {
      if (!restore) return;
      dirty.current = true;
      setAnswers(restore.answers);
      setNotes(restore.notes ?? {});
      setRestore(null);
    },
    keepServer: () => {
      remove(localKey(id, mode));
      setRestore(null);
    },
    clearLocal: () => remove(localKey(id, mode)),
  };
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state.kind === 'saving') return <span className="faint small">正在保存…</span>;
  if (state.kind === 'saved') return <span className="small" style={{ color: 'var(--ok)' }}>已保存 {formatTime(state.at)}</span>;
  if (state.kind === 'local')
    return (
      <span className="small" style={{ color: 'var(--red-pen)' }} title={state.error}>
        未同步到服务器，已暂存在本机
      </span>
    );
  return <span className="faint small">作答会自动保存</span>;
}

export function StudentTask() {
  const { id = '' } = useParams();
  const { data, error, loading, reload, setData } = useLoad<{ detail: StudentAssignmentDetail }>(() => get(`/s/my/assignments/${id}`), [id]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const d = data.detail;
  const key = `${d.id}-${d.status}-${d.correctionStatus}`;
  return <TaskInner key={key} d={d} onUpdate={(detail) => setData({ detail })} />;
}

function TaskInner({ d, onUpdate }: { d: StudentAssignmentDetail; onUpdate: (d: StudentAssignmentDetail) => void }) {
  const toast = useToast();
  const phase: 'answer' | 'correcting' | 'done' = !d.firstSubmittedAt ? 'answer' : d.correctionStatus === 'in_progress' ? 'correcting' : 'done';
  const first = useDraft(d.id, 'first', d.draft, phase === 'answer');
  const corr = useDraft(d.id, 'correction', d.correctionDraft, phase === 'correcting');
  const [confirmSubmit, setConfirmSubmit] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'first' | 'correction'>(d.correctionAnswers ? 'correction' : 'first');

  const draft = phase === 'correcting' ? corr : first;

  const submit = async (force = false) => {
    const missing = unansweredIds(d.snapshot.questions, draft.answers);
    if (missing.length && !force) {
      setConfirmSubmit(missing);
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ detail: StudentAssignmentDetail }>(`/s/my/assignments/${d.id}/submit`, {
        mode: phase === 'correcting' ? 'correction' : 'first',
        answers: draft.answers,
        notes: draft.notes,
      });
      draft.clearLocal();
      toast(phase === 'correcting' ? '订正已提交' : '已提交');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      onUpdate(r.detail);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const action = async (path: string, msg: string) => {
    try {
      const r = await post<{ detail: StudentAssignmentDetail }>(`/s/my/assignments/${d.id}/${path}`);
      toast(msg);
      onUpdate(r.detail);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };

  const qIndex = (qid: string) => d.snapshot.questions.findIndex((q) => q.id === qid) + 1;
  const canCorrect =
    d.released &&
    d.correctionStatus === 'none' &&
    !!d.firstResult &&
    (d.correctionRequired || d.firstResult.score < d.firstResult.total);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <Link to="/s" className="btn-link small">
            ← 返回作业
          </Link>
          <h1 style={{ marginTop: 6 }}>{d.snapshot.title}</h1>
          <p className="muted">{formatDateCn(d.date)} 的作业</p>
        </div>
      </div>

      {draft.restore && (
        <div className="notice notice-warn row-between">
          <span>这台设备上有一份较新的草稿（{formatTime(draft.restore.at)}），比服务器上的版本新。</span>
          <span className="row">
            <button className="btn btn-sm btn-primary" onClick={draft.acceptRestore}>
              恢复本机草稿
            </button>
            <button className="btn btn-sm" onClick={draft.keepServer}>
              保留服务器版本
            </button>
          </span>
        </div>
      )}

      {phase === 'answer' && (
        <div className="notice notice-accent small">先看题目考查什么，再回到原文找依据。细节题找人物、时间、地点和动作；主旨题结合全文；推断题依据已有信息判断。</div>
      )}

      {phase !== 'answer' && <ResultSummary d={d} onSeen={() => action('feedback-seen', '已标记为看过')} />}

      {phase === 'correcting' && (
        <div className="notice notice-warn small">
          订正中：错题已用红色标出。请回到原文重新找依据、修改答案，并写一句订正说明。首次答案和成绩会保留，提交订正后才显示正确答案和解析。
        </div>
      )}

      {phase === 'done' && d.correctionAnswers && (
        <div className="tabs">
          <button className={view === 'first' ? 'active' : ''} onClick={() => setView('first')}>
            首次作答
          </button>
          <button className={view === 'correction' ? 'active' : ''} onClick={() => setView('correction')}>
            订正
          </button>
        </div>
      )}

      {phase === 'answer' && (
        <Practice snapshot={d.snapshot} mode="answer" answers={first.answers} onAnswer={first.setAnswer} />
      )}
      {phase === 'correcting' && (
        <Practice
          snapshot={d.snapshot}
          mode="correction"
          answers={corr.answers}
          onAnswer={corr.setAnswer}
          firstAnswers={d.firstAnswers}
          firstResult={d.firstResult}
          notes={corr.notes}
          onNote={corr.setNote}
          questionComments={d.questionComments}
        />
      )}
      {phase === 'done' && (
        <Practice
          snapshot={d.snapshot}
          mode={d.released ? 'review' : 'readonly'}
          answers={view === 'correction' && d.correctionAnswers ? d.correctionAnswers : (d.firstAnswers ?? {})}
          result={view === 'correction' && d.correctionResult ? d.correctionResult : d.firstResult}
          notes={view === 'correction' ? d.correctionNotes : undefined}
          showAnswers={d.released}
          questionComments={d.questionComments}
        />
      )}

      {(phase === 'answer' || phase === 'correcting') && (
        <div className="sticky-actions">
          {confirmSubmit && (
            <div className="notice notice-warn row-between" style={{ marginBottom: 10 }}>
              <span>还有 {confirmSubmit.length} 道题没有作答：第 {confirmSubmit.map(qIndex).join('、')} 题。</span>
              <span className="row">
                <button className="btn btn-sm" onClick={() => setConfirmSubmit(null)}>
                  回去检查
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    setConfirmSubmit(null);
                    submit(true);
                  }}
                >
                  仍然提交
                </button>
              </span>
            </div>
          )}
          <div className="row-between">
            <SaveIndicator state={draft.state} />
            <div className="row">
              <button className="btn" onClick={async () => (await draft.flush()) && toast('草稿已保存')}>
                保存草稿
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => submit()}>
                {phase === 'correcting' ? '提交订正' : '提交'}
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && canCorrect && (
        <div className="sticky-actions">
          <div className="row-between">
            <span className="small muted">{d.correctionRequired ? '老师要求订正这份作业。' : '有错题，建议订正一次。'}</span>
            <button className="btn btn-primary" onClick={() => action('start-correction', '开始订正')}>
              开始订正
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultSummary({ d, onSeen }: { d: StudentAssignmentDetail; onSeen: () => void }) {
  if (!d.released) {
    return (
      <div className="card row-between">
        <div className="stack" style={{ gap: 2 }}>
          <h2>已提交，等待老师批改</h2>
          <p className="muted small">提交时间 {formatTime(d.firstSubmittedAt)}。老师批改后可以查看答案、解析和反馈。</p>
        </div>
        <span className="pill pill-warn">待批改</span>
      </div>
    );
  }
  const r = d.firstResult!;
  const wrong = Object.values(r.perQuestion).filter((x) => x.correct === false).length;
  return (
    <div className="card stack">
      <div className="row-between">
        <div className="row" style={{ gap: 24 }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="section-title" style={{ margin: 0 }}>
              首次成绩
            </span>
            <div className="score-ring">
              <span className="big">{r.score}</span>
              <span className="of">/ {r.total}</span>
            </div>
          </div>
          {d.correctionResult && (
            <div className="stack" style={{ gap: 2 }}>
              <span className="section-title" style={{ margin: 0 }}>
                订正后
              </span>
              <div className="score-ring">
                <span className="big" style={{ color: 'var(--ok)' }}>
                  {d.correctionResult.score}
                </span>
                <span className="of">/ {d.correctionResult.total}</span>
              </div>
            </div>
          )}
          <div className="small muted">
            {wrong > 0 ? `${wrong} 道题需要再看看` : '全部答对'}
            {r.pendingManual && <div>表达题等待老师评分</div>}
            {d.correctionStatus === 'submitted' && <div>订正已提交，等待老师再次批改</div>}
          </div>
        </div>
        {d.hasNewFeedback && (
          <button className="btn btn-sm" onClick={onSeen}>
            <span className="dot" /> 我已看过反馈
          </button>
        )}
      </div>
      {d.teacherComment && (
        <div className="teacher-note pre">
          <b>老师评语</b> {d.teacherComment}
        </div>
      )}
    </div>
  );
}
