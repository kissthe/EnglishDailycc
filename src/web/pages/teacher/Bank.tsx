import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gradeAttempt } from '../../../shared/grading';
import type { Material, MaterialSnapshot, MaterialSummary } from '../../../shared/types';
import { del, get, post } from '../../api';
import { Practice } from '../../components/Practice';
import { ConfirmButton, Empty, ErrorBox, Loading, Modal, formatTime, useLoad, useToast } from '../../ui';

export function BankPage() {
  const toast = useToast();
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad<{ materials: MaterialSummary[] }>(() => get('/t/materials'));
  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<Material | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const list = (data?.materials ?? []).filter(
    (m) => (filter === 'all' || m.status === filter) && (!q.trim() || m.title.toLowerCase().includes(q.trim().toLowerCase())),
  );

  const openPreview = async (id: string) => {
    try {
      const r = await get<{ material: Material }>(`/t/materials/${id}`);
      setPreview(r.material);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>精选题库</h1>
          <p className="muted">新建、导入、审核材料。只有已发布的材料可以布置；布置时保存快照，之后修改题库不会影响已布置的作业。</p>
        </div>
        <Link to="/t/bank/new" className="btn btn-primary">
          新建材料
        </Link>
      </div>

      <div className="row-between">
        <div className="seg">
          {(
            [
              ['all', '全部'],
              ['published', '已发布'],
              ['draft', '草稿'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <input id="bank-search" className="input" style={{ maxWidth: 260 }} placeholder="搜索标题" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <section className="card">
        {list.length ? (
          <div className="list">
            {list.map((m) => (
              <div key={m.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 220 }}>
                  <div className="row">
                    <Link to={`/t/bank/${m.id}`} className="title" style={{ color: 'inherit', textDecoration: 'none' }}>
                      {m.title}
                    </Link>
                    {m.status === 'published' ? <span className="pill pill-ok">已发布</span> : <span className="pill">草稿</span>}
                  </div>
                  <div className="meta">
                    <span>阅读</span>
                    <span className="num">{m.wordCount} 词</span>
                    <span>{m.questionCount} 题</span>
                    <span>答案{m.answerRelease === 'after_submit' ? '提交后' : '批改后'}开放</span>
                    {m.assignedCount > 0 && <span>已布置 {m.assignedCount} 次</span>}
                    <span>更新于 {formatTime(m.updatedAt)}</span>
                  </div>
                </div>
                <div className="row">
                  <button className="btn btn-sm" onClick={() => openPreview(m.id)} disabled={!m.questionCount}>
                    试做
                  </button>
                  <Link to={`/t/bank/${m.id}`} className="btn btn-sm">
                    编辑
                  </Link>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={async () => {
                      const r = await post<{ material: Material }>(`/t/materials/${m.id}/duplicate`);
                      toast('已复制为草稿');
                      nav(`/t/bank/${r.material.id}`);
                    }}
                  >
                    复制
                  </button>
                  <ConfirmButton
                    confirmText="确认删除"
                    onConfirm={async () => {
                      await del(`/t/materials/${m.id}`);
                      toast('已删除');
                      reload();
                    }}
                  >
                    删除
                  </ConfirmButton>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title={data?.materials.length ? '没有符合条件的材料' : '题库还是空的'}>
            {!data?.materials.length && <Link to="/t/bank/new">新建第一份阅读材料</Link>}
          </Empty>
        )}
      </section>

      {preview && <TryOut material={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/** 教师试做：只在本页计算结果，不保存成绩 */
export function TryOut({ material, onClose }: { material: Pick<Material, 'title' | 'source' | 'body' | 'questions' | 'answerRelease' | 'id'>; onClose: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const snapshot = { materialId: material.id, kind: 'reading' as const, ...material };
  return (
    <Modal
      wide
      title="试做（学生视角，不保存）"
      onClose={onClose}
      footer={
        submitted ? (
          <>
            <button className="btn" onClick={() => { setAnswers({}); setSubmitted(false); }}>
              重新试做
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              关闭
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => setSubmitted(true)}>
            提交并查看答案
          </button>
        )
      }
    >
      <TryOutBody snapshot={snapshot} answers={answers} setAnswers={setAnswers} submitted={submitted} />
    </Modal>
  );
}

function TryOutBody({
  snapshot,
  answers,
  setAnswers,
  submitted,
}: {
  snapshot: MaterialSnapshot;
  answers: Record<string, string>;
  setAnswers: (fn: (a: Record<string, string>) => Record<string, string>) => void;
  submitted: boolean;
}) {
  const result = submitted ? gradeAttempt(snapshot.questions, answers) : null;
  return (
    <div className="stack">
      {result && (
        <div className="notice notice-accent">
          客观题得分 <b className="num">{result.score}</b> / {result.total}
          {result.pendingManual && '（表达题需老师评分，未计入）'}
        </div>
      )}
      <Practice
        key={submitted ? 'r' : 'a'}
        snapshot={snapshot}
        mode={submitted ? 'review' : 'answer'}
        answers={answers}
        onAnswer={(qid, v) => setAnswers((a) => ({ ...a, [qid]: v }))}
        result={result}
        showAnswers={submitted}
      />
    </div>
  );
}
