import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatDateCn } from '../../../shared/dates';
import { questionPoints } from '../../../shared/grading';
import type { AssignmentListItem, GradingDetail, Question } from '../../../shared/types';
import { get, post } from '../../api';
import { Practice } from '../../components/Practice';
import { AssignmentStatus, Empty, ErrorBox, Loading, ScoreText, formatTime, useLoad, useToast } from '../../ui';

type Filter = 'pending' | 'all' | 'corrections';

export function GradingPage() {
  const [filter, setFilter] = useState<Filter>('pending');
  const { data, error, loading, reload } = useLoad<{ items: AssignmentListItem[] }>(() => get(`/t/grading?filter=${filter}`), [filter]);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>作业批改</h1>
          <p className="muted">客观题已自动判分。表达题需要评分；答案设为“批改后开放”的作业，确认批改后学生才能看到答案与解析。</p>
        </div>
      </div>
      <div className="tabs">
        {(
          [
            ['pending', '待批改'],
            ['all', '全部提交'],
            ['corrections', '错题与订正'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <section className="card">
          {data?.items.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>学生</th>
                    <th>材料</th>
                    <th>作业日期</th>
                    <th>提交时间</th>
                    <th>首次</th>
                    <th>订正</th>
                    <th>状态</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a.id}>
                      <td className="nowrap">{a.studentName}</td>
                      <td>{a.title}</td>
                      <td className="nowrap">{formatDateCn(a.date)}</td>
                      <td className="nowrap small muted">{formatTime(a.submittedAt)}</td>
                      <td>
                        <ScoreText score={a.score} total={a.total} />
                      </td>
                      <td>
                        <ScoreText score={a.correctionScore} total={a.total} />
                      </td>
                      <td>
                        <AssignmentStatus a={a} />
                      </td>
                      <td>
                        <Link to={`/t/grading/${a.id}`} className={`btn btn-sm ${a.needsGrading ? 'btn-primary' : ''}`}>
                          {a.needsGrading ? '批改' : '查看'}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title={filter === 'pending' ? '没有待批改的作业' : '还没有记录'} />
          )}
        </section>
      )}
    </div>
  );
}

export function GradingDetailPage() {
  const { id = '' } = useParams();
  const { data, error, loading, reload, setData } = useLoad<{ detail: GradingDetail }>(() => get(`/t/grading/${id}`), [id]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  return <GradingInner key={data.detail.id + (data.detail.gradedAt ?? '')} d={data.detail} onSaved={(detail) => setData({ detail })} />;
}

function GradingInner({ d, onSaved }: { d: GradingDetail; onSaved: (d: GradingDetail) => void }) {
  const toast = useToast();
  const [scores, setScores] = useState<Record<string, number>>(d.teacherScores);
  const [cScores, setCScores] = useState<Record<string, number>>(d.correctionTeacherScores);
  const [comments, setComments] = useState<Record<string, string>>(d.questionComments);
  const [comment, setComment] = useState(d.teacherComment);
  const [required, setRequired] = useState(d.correctionRequired);
  const [view, setView] = useState<'first' | 'correction'>(d.correctionStatus === 'submitted' ? 'correction' : 'first');
  const [busy, setBusy] = useState(false);

  if (!d.firstSubmittedAt)
    return (
      <div className="stack-lg">
        <Link to="/t/grading" className="btn-link small">
          ← 作业批改
        </Link>
        <Empty title="学生还没有提交这份作业" />
      </div>
    );

  const first = d.firstAnswers ?? {};
  const corr = d.correctionAnswers ?? {};
  const changedText = (q: Question) => q.type === 'text' && (corr[q.id] ?? '').trim() !== (first[q.id] ?? '').trim();

  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ detail: GradingDetail }>(`/t/grading/${d.id}`, {
        teacherScores: scores,
        correctionTeacherScores: cScores,
        questionComments: comments,
        comment,
        correctionRequired: required,
      });
      toast('批改已保存，学生可以看到反馈');
      onSaved(r.detail);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const renderExtra = (q: Question) => (
    <div className="stack" style={{ gap: 8, padding: '10px 12px', border: '1px dashed var(--line-strong)', borderRadius: 'var(--r-sm)' }}>
      {q.type === 'text' && view === 'first' && (first[q.id] ?? '').trim() && (
        <ScoreInput q={q} label="首次评分" value={scores[q.id]} onChange={(v) => setScores(withScore(scores, q.id, v))} />
      )}
      {q.type === 'text' && view === 'correction' && changedText(q) && (
        <ScoreInput q={q} label="订正评分" value={cScores[q.id]} onChange={(v) => setCScores(withScore(cScores, q.id, v))} />
      )}
      {q.type === 'text' && view === 'correction' && !changedText(q) && <span className="small faint">订正时未修改，沿用首次评分。</span>}
      <input
        className="input"
        value={comments[q.id] ?? ''}
        onChange={(e) => setComments({ ...comments, [q.id]: e.target.value })}
        placeholder="批注（可选）：例如“忽略了 but 后面的转折”"
      />
    </div>
  );

  const result = view === 'correction' && d.correctionResult ? d.correctionResult : d.firstResult;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <Link to="/t/grading" className="btn-link small">
            ← 作业批改
          </Link>
          <h1 style={{ marginTop: 6 }}>
            {d.studentName} · {d.snapshot.title}
          </h1>
          <p className="muted small">
            {formatDateCn(d.date)} 的作业 · 首次提交 {formatTime(d.firstSubmittedAt)}
            {d.correctionSubmittedAt && ` · 订正提交 ${formatTime(d.correctionSubmittedAt)}`}
            {d.gradedAt && ` · 上次批改 ${formatTime(d.gradedAt)}`}
          </p>
        </div>
        <div className="row">
          {d.firstResult && (
            <div className="stack" style={{ gap: 0, alignItems: 'flex-end' }}>
              <span className="section-title" style={{ margin: 0 }}>
                首次
              </span>
              <span className="score-ring">
                <span className="big" style={{ fontSize: '1.6rem' }}>
                  {d.firstResult.score}
                </span>
                <span className="of">/ {d.firstResult.total}</span>
              </span>
            </div>
          )}
          {d.correctionResult && (
            <div className="stack" style={{ gap: 0, alignItems: 'flex-end', marginLeft: 16 }}>
              <span className="section-title" style={{ margin: 0 }}>
                订正
              </span>
              <span className="score-ring">
                <span className="big" style={{ fontSize: '1.6rem', color: 'var(--ok)' }}>
                  {d.correctionResult.score}
                </span>
                <span className="of">/ {d.correctionResult.total}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {d.status === 'submitted' && (
        <div className="notice notice-warn small">
          {d.snapshot.questions.some((q) => q.type === 'text') ? '请为表达题评分，' : ''}保存批改后，学生才能看到成绩、答案与解析。
        </div>
      )}
      {d.correctionStatus === 'submitted' && <div className="notice notice-warn small">学生已提交订正，订正中修改过的表达题需要重新评分。</div>}

      {d.correctionAnswers && (
        <div className="tabs">
          <button className={view === 'first' ? 'active' : ''} onClick={() => setView('first')}>
            首次作答
          </button>
          <button className={view === 'correction' ? 'active' : ''} onClick={() => setView('correction')}>
            订正
          </button>
        </div>
      )}

      <Practice
        snapshot={d.snapshot}
        mode="review"
        answers={view === 'correction' ? corr : first}
        result={result}
        notes={view === 'correction' ? d.correctionNotes : undefined}
        showAnswers
        renderExtra={renderExtra}
      />

      <section className="card stack">
        <h2>总评与订正要求</h2>
        <label className="field">
          <span>评语</span>
          <textarea
            id="grade-comment"
            className="textarea"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="说明学生哪里理解有误，例如“把提到的例子当成了主旨”；也可以写下次练习的重点。"
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <span>要求学生订正（学生端会显示“需订正”）</span>
        </label>
      </section>

      <div className="sticky-actions">
        <div className="row-between">
          <span className="small muted">保存后学生会收到“新反馈”提醒。</span>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {d.status === 'submitted' || d.correctionStatus === 'submitted' ? '完成批改' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScoreInput({ q, value, onChange, label }: { q: Question; value: number | undefined; onChange: (v: number | undefined) => void; label: string }) {
  const max = questionPoints(q);
  if (max > 10)
    return (
      <label className="row" style={{ gap: 6 }}>
        <span className="small muted">{label}</span>
        <input
          className="input num"
          style={{ width: 80 }}
          type="number"
          min={0}
          max={max}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Math.max(0, Math.min(max, Number(e.target.value))))}
        />
        <span className="faint small">/ {max} 分</span>
      </label>
    );
  return (
    <div className="row" style={{ gap: 6 }}>
      <span className="small muted">{label}</span>
      {Array.from({ length: max + 1 }, (_, i) => i).map((v) => (
        <button key={v} className={`bubble ${value === v ? 'filled' : ''}`} style={{ width: 30, height: 30 }} onClick={() => onChange(value === v ? undefined : v)}>
          {v}
        </button>
      ))}
      <span className="faint small">/ {max} 分</span>
    </div>
  );
}

function withScore(map: Record<string, number>, id: string, v: number | undefined) {
  const next = { ...map };
  if (v === undefined) delete next[id];
  else next[id] = v;
  return next;
}
