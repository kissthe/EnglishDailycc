import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, formatDateCn } from '../../../shared/dates';
import type { AssignmentListItem, MaterialSummary, User } from '../../../shared/types';
import { ApiError, del, get, post } from '../../api';
import { AssignmentStatus, ConfirmButton, Empty, ErrorBox, Loading, Modal, ScoreText, todayLocal, useLoad, useToast } from '../../ui';

function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

export function DailyPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const today = todayLocal();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [studentId, setStudentId] = useState('');
  const weekEnd = addDays(weekStart, 6);
  const assigning = params.get('assign') === '1';

  const students = useLoad<{ students: User[] }>(() => get('/t/students'));
  const list = useLoad<{ assignments: AssignmentListItem[] }>(
    () => get(`/t/assignments?from=${weekStart}&to=${weekEnd}${studentId ? `&studentId=${studentId}` : ''}`),
    [weekStart, studentId],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, AssignmentListItem[]>();
    for (let i = 0; i < 7; i++) map.set(addDays(weekStart, i), []);
    for (const a of list.data?.assignments ?? []) map.get(a.date)?.push(a);
    return [...map.entries()];
  }, [list.data, weekStart]);

  const remove = async (a: AssignmentListItem, force = false) => {
    try {
      await del(`/t/assignments/${a.id}${force ? '?force=1' : ''}`);
      toast('已撤回');
      list.reload();
    } catch (e) {
      if (e instanceof ApiError && e.data?.needsForce) setForceTarget(a);
      else toast(e instanceof Error ? e.message : String(e), true);
    }
  };
  const [forceTarget, setForceTarget] = useState<AssignmentListItem | null>(null);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>每日作业</h1>
          <p className="muted">按学生和日期布置已发布的材料。同一次勾选的材料会安排到每个所选日期；不同日期用不同材料时请分别布置。</p>
        </div>
        <button className="btn btn-primary" onClick={() => setParams({ assign: '1' })}>
          布置作业
        </button>
      </div>

      <div className="row-between">
        <div className="row">
          <button className="btn btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            ← 上一周
          </button>
          <span className="num" style={{ minWidth: 150, textAlign: 'center' }}>
            {weekStart.slice(5)} — {weekEnd.slice(5)}
          </span>
          <button className="btn btn-sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            下一周 →
          </button>
          {weekStart !== mondayOf(today) && (
            <button className="btn btn-sm btn-ghost" onClick={() => setWeekStart(mondayOf(today))}>
              回到本周
            </button>
          )}
        </div>
        <select id="daily-student" className="select" style={{ maxWidth: 200 }} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">全部学生</option>
          {students.data?.students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>
      </div>

      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      {list.loading && !list.data ? (
        <Loading />
      ) : (
        <div className="stack">
          {byDate.map(([date, items]) => (
            <section key={date} className="card" style={date === today ? { borderColor: 'var(--accent)' } : undefined}>
              <div className="card-head" style={{ marginBottom: items.length ? 4 : 0 }}>
                <h3>
                  {formatDateCn(date)} {date === today && <span className="pill pill-accent">今天</span>}
                </h3>
                <span className="faint small">{items.length ? `${items.length} 份` : '未布置'}</span>
              </div>
              {items.length > 0 && (
                <div className="list">
                  {items.map((a) => (
                    <div key={a.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                      <div className="grow" style={{ minWidth: 200 }}>
                        <div className="title">
                          {a.studentName} · {a.title}
                        </div>
                        <div className="meta">
                          <span>{a.questionCount} 题</span>
                          {a.correctionScore !== null && (
                            <span>
                              订正 <ScoreText score={a.correctionScore} total={a.total} />
                            </span>
                          )}
                        </div>
                      </div>
                      <ScoreText score={a.score} total={a.total} />
                      <AssignmentStatus a={a} />
                      {a.submittedAt ? (
                        <Link to={`/t/grading/${a.id}`} className="btn btn-sm">
                          {a.needsGrading ? '批改' : '查看'}
                        </Link>
                      ) : (
                        <ConfirmButton confirmText="确认撤回" onConfirm={() => remove(a)} className="btn btn-sm btn-ghost">
                          撤回
                        </ConfirmButton>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {assigning && (
        <AssignModal
          students={students.data?.students.filter((s) => s.active) ?? []}
          onClose={() => setParams({})}
          onDone={(dates) => {
            setParams({});
            if (dates[0]) setWeekStart(mondayOf(dates[0]));
            list.reload();
          }}
        />
      )}

      {forceTarget && (
        <Modal
          title="撤回已提交的作业？"
          onClose={() => setForceTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForceTarget(null)}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  const a = forceTarget;
                  setForceTarget(null);
                  remove(a, true);
                }}
              >
                撤回并删除作答记录
              </button>
            </>
          }
        >
          <p>
            {forceTarget.studentName} 已经提交了《{forceTarget.title}》。撤回会同时删除这次作答和成绩，无法恢复。
          </p>
        </Modal>
      )}
    </div>
  );
}

function AssignModal({ students, onClose, onDone }: { students: User[]; onClose: () => void; onDone: (dates: string[]) => void }) {
  const toast = useToast();
  const today = todayLocal();
  const materials = useLoad<{ materials: MaterialSummary[] }>(() => get('/t/materials'));
  const [studentIds, setStudentIds] = useState<string[]>(() => (students.length === 1 ? [students[0].id] : []));
  const [dates, setDates] = useState<string[]>([today]);
  const [dateInput, setDateInput] = useState(addDays(today, 1));
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const published = (materials.data?.materials ?? []).filter((m) => m.status === 'published');
  const filtered = published.filter((m) => !q.trim() || m.title.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const addDate = (d: string) => d && !dates.includes(d) && setDates([...dates, d].sort());
  const total = studentIds.length * dates.length * materialIds.length;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await post<{ created: number; skipped: number }>('/t/assignments', { studentIds, dates, materialIds });
      toast(`已布置 ${r.created} 份作业${r.skipped ? `，跳过 ${r.skipped} 份重复` : ''}`);
      onDone(dates);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const weekdays = () => {
    const mon = mondayOf(today);
    const start = today > addDays(mon, 4) ? addDays(mon, 7) : mon;
    return [0, 1, 2, 3, 4].map((i) => addDays(start, i)).filter((d) => d >= today);
  };

  return (
    <Modal
      wide
      title="布置作业"
      onClose={onClose}
      footer={
        <>
          <span className="small muted grow">
            将创建 <b className="num">{total}</b> 份作业（{studentIds.length} 名学生 × {dates.length} 天 × {materialIds.length} 份材料）
          </span>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={!total || busy} onClick={submit}>
            确认布置
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="section-title">接收学生</div>
        {students.length ? (
          <div className="row">
            {students.map((s) => (
              <label key={s.id} className="check" style={{ marginRight: 12 }}>
                <input type="checkbox" checked={studentIds.includes(s.id)} onChange={() => setStudentIds(toggle(studentIds, s.id))} />
                <span>{s.displayName}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="notice notice-warn">
            还没有学生账号，请先到 <Link to="/t/students">学生账号</Link> 创建。
          </div>
        )}
      </div>

      <div className="stack">
        <div className="section-title">日期</div>
        <div className="chips">
          {dates.map((d) => (
            <span key={d} className="chip">
              {formatDateCn(d)}
              <button onClick={() => setDates(dates.filter((x) => x !== d))} aria-label="移除">
                ×
              </button>
            </span>
          ))}
          {!dates.length && <span className="small faint">还没有选择日期</span>}
        </div>
        <div className="row">
          <input id="assign-date" className="input" type="date" style={{ width: 170 }} value={dateInput} onChange={(e) => setDateInput(e.target.value)} />
          <button className="btn btn-sm" onClick={() => addDate(dateInput)}>
            添加日期
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => addDate(today)}>
            今天
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => addDate(addDays(today, 1))}>
            明天
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setDates([...new Set([...dates, ...weekdays()])].sort())}>
            本周剩余工作日
          </button>
        </div>
      </div>

      <div className="stack">
        <div className="row-between">
          <div className="section-title" style={{ margin: 0 }}>
            已发布材料
          </div>
          <input id="assign-search" className="input" style={{ maxWidth: 220 }} placeholder="搜索标题" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {materials.loading && !materials.data ? (
          <Loading />
        ) : published.length ? (
          <div className="pick-list">
            {filtered.map((m) => (
              <label key={m.id}>
                <input type="checkbox" checked={materialIds.includes(m.id)} onChange={() => setMaterialIds(toggle(materialIds, m.id))} />
                <span className="grow">
                  {m.title}
                  <span className="meta">
                    <span>{m.questionCount} 题</span>
                    <span className="num">{m.wordCount} 词</span>
                    {m.assignedCount > 0 ? <span>已布置 {m.assignedCount} 次</span> : <span>未布置过</span>}
                  </span>
                </span>
              </label>
            ))}
            {!filtered.length && <div className="empty small">没有匹配的材料</div>}
          </div>
        ) : (
          <Empty title="没有已发布的材料">
            草稿材料不能布置。<Link to="/t/bank">去题库发布</Link>
          </Empty>
        )}
      </div>
    </Modal>
  );
}
