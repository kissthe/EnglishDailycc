import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { countWords } from '../../../shared/dates';
import { acceptableAnswers } from '../../../shared/grading';
import { matchSolutions, nextQuestionId, parseQuestionsBlock, validateForPublish } from '../../../shared/importer';
import type { AnswerRelease, Material, Question, QuestionType } from '../../../shared/types';
import { ApiError, get, post, put } from '../../api';
import { ErrorBox, Loading, Modal, copyText, formatTime, useToast } from '../../ui';
import { TryOut } from './Bank';

type Step = 1 | 2 | 3 | 4;
const LETTERS = 'ABCDEFGH';
const TYPE_LABEL: Record<QuestionType, string> = { choice: '单项选择', blank: '填空', text: '表达题' };

interface Form {
  title: string;
  source: string;
  body: string;
  questions: Question[];
  answerRelease: AnswerRelease;
}

const EMPTY: Form = { title: '', source: '', body: '', questions: [], answerRelease: 'after_submit' };

export function EditorPage() {
  const { id } = useParams();
  const [material, setMaterial] = useState<Material | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    setMaterial(null);
    get<{ material: Material }>(`/t/materials/${id}`)
      .then((r) => setMaterial(r.material))
      .catch((e) => setError(e.message));
  }, [id]);
  if (error) return <ErrorBox error={error} />;
  if (id && !material) return <Loading />;
  return <Editor key={id ?? 'new'} material={material} />;
}

function Editor({ material }: { material: Material | null }) {
  const toast = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<Form>(
    material
      ? { title: material.title, source: material.source, body: material.body, questions: material.questions, answerRelease: material.answerRelease }
      : EMPTY,
  );
  const [status, setStatus] = useState(material?.status ?? 'draft');
  const [savedAt, setSavedAt] = useState(material?.updatedAt ?? null);
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [tryOut, setTryOut] = useState(false);

  const update = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
    setConfirmed(false);
  };
  const setQuestions = (questions: Question[]) => update({ questions });

  const publishErrors = useMemo(() => validateForPublish(form.title, form.body, form.questions), [form]);
  const answersDone = form.questions.length > 0 && form.questions.every((q) => q.type === 'text' || (q.answer ?? '').trim());

  const save = async (publish: boolean) => {
    if (!publish && material && !dirty) {
      toast('没有需要保存的修改');
      return;
    }
    setBusy(true);
    setServerErrors([]);
    try {
      const payload = { ...form, publish, confirmed };
      const r = material
        ? await put<{ material: Material }>(`/t/materials/${material.id}`, payload)
        : await post<{ material: Material }>('/t/materials', payload);
      setStatus(r.material.status);
      setSavedAt(r.material.updatedAt);
      setDirty(false);
      toast(publish ? '已保存并发布，可以去“每日作业”布置了' : '草稿已保存');
      if (!material) nav(`/t/bank/${r.material.id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.data?.errors)) setServerErrors(e.data.errors);
      toast(e instanceof Error ? e.message.split('\n')[0] : String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const steps: { n: Step; label: string; done: boolean }[] = [
    { n: 1, label: '阅读内容', done: !!form.title.trim() && !!form.body.trim() },
    { n: 2, label: '题目', done: form.questions.length > 0 },
    { n: 3, label: '答案与解析', done: answersDone },
    { n: 4, label: '发布', done: status === 'published' && !dirty },
  ];

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <Link to="/t/bank" className="btn-link small">
            ← 精选题库
          </Link>
          <h1 style={{ marginTop: 6 }}>{material ? form.title || '未命名材料' : '新建材料'}</h1>
          <p className="muted small row">
            {status === 'published' ? <span className="pill pill-ok">已发布</span> : <span className="pill">草稿</span>}
            {dirty ? <span style={{ color: 'var(--warn)' }}>有未保存的修改</span> : savedAt && <span>保存于 {formatTime(savedAt)}</span>}
          </p>
        </div>
      </div>

      <div className="steps">
        {steps.map((s) => (
          <button key={s.n} className={step === s.n ? 'active' : ''} onClick={() => setStep(s.n)}>
            <b>{s.n}</b>· {s.label} {s.done && <span className="ok">✓</span>}
          </button>
        ))}
      </div>

      {step === 1 && <StepContent form={form} update={update} />}
      {step === 2 && <StepQuestions form={form} setQuestions={setQuestions} />}
      {step === 3 && <StepAnswers form={form} setQuestions={setQuestions} />}
      {step === 4 && (
        <StepPublish
          form={form}
          update={update}
          errors={serverErrors.length ? serverErrors : publishErrors}
          confirmed={confirmed}
          setConfirmed={setConfirmed}
          busy={busy}
          onPublish={() => save(true)}
          status={status}
          dirty={dirty}
        />
      )}

      <div className="sticky-actions">
        <div className="row-between">
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => save(false)}>
              保存草稿
            </button>
            <button className="btn btn-ghost" disabled={!form.questions.length} onClick={() => setTryOut(true)}>
              试做
            </button>
          </div>
          <div className="row">
            {step > 1 && (
              <button className="btn" onClick={() => setStep((step - 1) as Step)}>
                上一步
              </button>
            )}
            {step < 4 && (
              <button className="btn btn-primary" onClick={() => setStep((step + 1) as Step)}>
                下一步
              </button>
            )}
          </div>
        </div>
        {status === 'published' && dirty && (
          <p className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>
            修改后点“保存草稿”会撤下发布；需要继续布置请在第 4 步重新发布。已布置的作业不受影响。
          </p>
        )}
      </div>

      {tryOut && <TryOut material={{ id: material?.id ?? 'preview', ...form }} onClose={() => setTryOut(false)} />}
    </div>
  );
}

// ---------------- 1 · 阅读内容 ----------------
function StepContent({ form, update }: { form: Form; update: (p: Partial<Form>) => void }) {
  return (
    <section className="card stack">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field grow">
          <span>标题</span>
          <input id="m-title" className="input" value={form.title} onChange={(e) => update({ title: e.target.value })} placeholder="例如：A Trip to the Science Museum" />
        </label>
        <label className="field" style={{ width: 160 }}>
          <span>类型</span>
          <select id="m-kind" className="select" value="reading" onChange={() => {}}>
            <option value="reading">阅读</option>
            <option value="listening" disabled>
              听力（第二期）
            </option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>来源（可选）</span>
        <input id="m-source" className="input" value={form.source} onChange={(e) => update({ source: e.target.value })} placeholder="例如：2025 北京中考 / 原创 / 教材 Unit 5" />
      </label>
      <label className="field">
        <span>阅读正文</span>
        <textarea
          id="m-body"
          className="textarea reading"
          value={form.body}
          onChange={(e) => update({ body: e.target.value })}
          placeholder="粘贴完整英语正文。段落之间空一行。语篇填空可以直接写 (1)______ 这样的空格。"
        />
        <span className="hint">
          <span className="num">{countWords(form.body)}</span> 个英文单词。建议选学生能基本读懂、主题明确的短文，去掉混入正文的答案和无关文字。
        </span>
      </label>
    </section>
  );
}

// ---------------- 2 · 题目 ----------------
function StepQuestions({ form, setQuestions }: { form: Form; setQuestions: (q: Question[]) => void }) {
  const toast = useToast();
  const [preview, setPreview] = useState<{ title: string; questions: Question[]; errors: string[]; raw?: string } | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batch, setBatch] = useState('');
  const [generating, setGenerating] = useState(false);

  const qs = form.questions;
  const updateQ = (i: number, patch: Partial<Question>) => setQuestions(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: number) => {
    const next = [...qs];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    setQuestions(next);
  };
  const add = (type: QuestionType) => {
    const q: Question = { id: nextQuestionId(qs), type, prompt: '' };
    if (type === 'choice') q.options = ['', '', '', ''];
    if (type === 'text') q.points = 2;
    setQuestions([...qs, q]);
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await post<{ questions: Question[]; errors: string[]; raw: string }>('/t/ai/generate', { title: form.title, body: form.body });
      setPreview({ title: 'AI 生成的题目草稿', ...r });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setGenerating(false);
    }
  };

  const copyPrompt = async () => {
    try {
      const r = await post<{ prompt: string }>('/t/ai/prompt', { title: form.title, body: form.body });
      if (await copyText(r.prompt)) toast('提示词已复制，可以粘贴到外部 AI 工具');
      else setPreview({ title: '复制失败，请手动复制下面的提示词', questions: [], errors: [], raw: r.prompt });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };

  const parseBatch = () => {
    const r = parseQuestionsBlock(batch);
    setPreview({ title: '批量题目预览', questions: r.items, errors: r.errors });
  };

  return (
    <div className="stack">
      <section className="card stack">
        <div className="toolbar">
          <button className="btn btn-primary" onClick={generate} disabled={generating || !form.body.trim()}>
            {generating ? '正在生成…' : '生成题目草稿'}
          </button>
          <button className="btn" onClick={copyPrompt} disabled={!form.body.trim()}>
            复制当前提示词
          </button>
          <button className={`btn ${batchOpen ? 'btn-ghost' : ''}`} onClick={() => setBatchOpen((o) => !o)}>
            {batchOpen ? '收起批量题目' : '批量题目'}
          </button>
        </div>
        {!form.body.trim() && <p className="small faint">先在“1 · 阅读内容”粘贴正文，才能生成题目或复制提示词。</p>}
        <p className="small muted">生成结果先进入预览，确认后才会替换当前题目；不会自动发布。出题数量、难度和考查点在“AI 配置中心”修改。</p>
        {batchOpen && (
          <div className="stack">
            <label className="field">
              <span>
                粘贴 <code>&lt;questions&gt;</code> 区块（也可以直接粘贴 JSON 数组；含 answer 和 explanation 时会一起导入）
              </span>
              <textarea
                id="batch-questions"
                className="textarea mono"
                style={{ minHeight: 200 }}
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                placeholder={'<questions>\n[\n  {"id":"q1","type":"choice","prompt":"…","options":["…","…","…","…"],"tag":"细节理解"}\n]\n</questions>'}
              />
            </label>
            <div>
              <button className="btn" onClick={parseBatch} disabled={!batch.trim()}>
                解析并预览
              </button>
            </div>
          </div>
        )}
      </section>

      {qs.length === 0 && (
        <div className="card empty">
          <b>还没有题目</b>
          用上面的 AI 生成或批量导入，也可以手动添加。
        </div>
      )}

      {qs.map((q, i) => (
        <div key={i} className="q-edit">
          <div className="q-edit-head">
            <span className="q-no">{i + 1}.</span>
            <input className="input num" style={{ width: 70 }} value={q.id} onChange={(e) => updateQ(i, { id: e.target.value.trim() })} aria-label="题号" title="题号（用于匹配答案）" />
            <select
              className="select"
              style={{ width: 120 }}
              value={q.type}
              onChange={(e) => {
                const type = e.target.value as QuestionType;
                updateQ(i, { type, options: type === 'choice' ? (q.options?.length ? q.options : ['', '', '', '']) : undefined, answer: undefined });
              }}
              aria-label="题型"
            >
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input className="input" style={{ width: 140 }} value={q.tag ?? ''} onChange={(e) => updateQ(i, { tag: e.target.value })} placeholder="考查点" aria-label="考查点" />
            <label className="row small muted" style={{ gap: 4 }}>
              分值
              <input
                className="input num"
                style={{ width: 60 }}
                type="number"
                min={1}
                max={100}
                value={q.points ?? 1}
                onChange={(e) => updateQ(i, { points: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
            <span className="grow" />
            <button className="btn btn-sm btn-ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上移">
              ↑
            </button>
            <button className="btn btn-sm btn-ghost" disabled={i === qs.length - 1} onClick={() => move(i, 1)} aria-label="下移">
              ↓
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => setQuestions(qs.filter((_, j) => j !== i))}>
              删除
            </button>
          </div>
          <textarea
            className="textarea"
            style={{ minHeight: 56, fontFamily: 'var(--font-read)' }}
            value={q.prompt}
            onChange={(e) => updateQ(i, { prompt: e.target.value })}
            placeholder={q.type === 'blank' ? '题干，例如：(1) start' : '题干'}
          />
          {q.type === 'choice' && (
            <div className="stack" style={{ gap: 6 }}>
              {(q.options ?? []).map((opt, k) => (
                <div key={k} className="opt-row">
                  <span className="letter">{LETTERS[k]}</span>
                  <input
                    className="input"
                    value={opt}
                    onChange={(e) => {
                      const options = [...(q.options ?? [])];
                      const wasAnswer = q.answer === options[k];
                      options[k] = e.target.value;
                      updateQ(i, { options, ...(wasAnswer ? { answer: e.target.value } : {}) });
                    }}
                    placeholder={`选项 ${LETTERS[k]}`}
                  />
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      const options = (q.options ?? []).filter((_, j) => j !== k);
                      updateQ(i, { options, answer: q.answer === opt ? undefined : q.answer });
                    }}
                    aria-label="删除选项"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {(q.options?.length ?? 0) < 6 && (
                <div>
                  <button className="btn btn-sm btn-ghost" onClick={() => updateQ(i, { options: [...(q.options ?? []), ''] })}>
                    + 添加选项
                  </button>
                </div>
              )}
            </div>
          )}
          {q.type === 'blank' && <p className="small faint">学生在输入框作答，答案在“3 · 答案与解析”填写。</p>}
          {q.type === 'text' && <p className="small faint">表达题由老师评分，可在第 3 步填写参考答案。</p>}
        </div>
      ))}

      <div className="row">
        <span className="small muted">手动添加：</span>
        <button className="btn btn-sm" onClick={() => add('choice')}>
          + 单项选择
        </button>
        <button className="btn btn-sm" onClick={() => add('blank')}>
          + 填空
        </button>
        <button className="btn btn-sm" onClick={() => add('text')}>
          + 表达题
        </button>
      </div>

      {preview && (
        <Modal
          wide
          title={preview.title}
          onClose={() => setPreview(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPreview(null)}>
                取消
              </button>
              {preview.questions.length > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setQuestions(preview.questions);
                    setPreview(null);
                    setBatch('');
                    setBatchOpen(false);
                    toast(`已替换为 ${preview.questions.length} 道题，请到第 3 步核对答案`);
                  }}
                >
                  确认替换当前题目
                </button>
              )}
            </>
          }
        >
          {preview.errors.length > 0 && (
            <div className="notice notice-red">
              {preview.questions.length ? '有以下问题，可以先导入再手动修正：' : '解析失败：'}
              <ul>
                {preview.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {preview.questions.length > 0 && (
            <>
              {qs.length > 0 && <div className="notice notice-warn small">确认后会替换当前全部 {qs.length} 道题。</div>}
              <QuestionPreviewList questions={preview.questions} />
            </>
          )}
          {preview.raw && preview.questions.length === 0 && (
            <textarea className="textarea mono" style={{ minHeight: 260 }} readOnly value={preview.raw} onFocus={(e) => e.currentTarget.select()} />
          )}
        </Modal>
      )}
    </div>
  );
}

function QuestionPreviewList({ questions }: { questions: Question[] }) {
  return (
    <div className="stack">
      {questions.map((q, i) => (
        <div key={i} className="q-edit" style={{ gap: 6 }}>
          <div className="row">
            <span className="q-no">{q.id}</span>
            <span className="pill">{TYPE_LABEL[q.type]}</span>
            {q.tag && <span className="pill">{q.tag}</span>}
          </div>
          <div style={{ fontFamily: 'var(--font-read)' }}>{q.prompt}</div>
          {q.options && (
            <ol type="A" style={{ margin: 0, paddingLeft: 22, fontFamily: 'var(--font-read)' }}>
              {q.options.map((o, k) => (
                <li key={k} style={{ color: o === q.answer ? 'var(--ok)' : undefined, fontWeight: o === q.answer ? 600 : undefined }}>
                  {o} {o === q.answer && '✓'}
                </li>
              ))}
            </ol>
          )}
          {q.type !== 'choice' && q.answer && <div className="small">答案：{q.answer}</div>}
          {q.explanation && <div className="small muted">解析：{q.explanation}</div>}
        </div>
      ))}
    </div>
  );
}

// ---------------- 3 · 答案与解析 ----------------
function StepAnswers({ form, setQuestions }: { form: Form; setQuestions: (q: Question[]) => void }) {
  const toast = useToast();
  const [solutions, setSolutions] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const qs = form.questions;
  const updateQ = (i: number, patch: Partial<Question>) => setQuestions(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  if (!qs.length)
    return (
      <div className="card empty">
        <b>还没有题目</b>请先在“2 · 题目”添加题目。
      </div>
    );

  return (
    <div className="stack">
      <section className="card stack">
        <label className="field">
          <span>
            粘贴 <code>&lt;solutions&gt;</code> 区块，按题号自动填入答案和解析
          </span>
          <textarea
            id="batch-solutions"
            className="textarea mono"
            style={{ minHeight: 120 }}
            value={solutions}
            onChange={(e) => setSolutions(e.target.value)}
            placeholder={'<solutions>\n[\n  {"id":"q1","answer":"At the school gate","explanation":"原文明确说明在校门口集合。"}\n]\n</solutions>'}
          />
        </label>
        <div className="row">
          <button
            className="btn"
            disabled={!solutions.trim()}
            onClick={() => {
              const r = matchSolutions(qs, solutions);
              setErrors(r.errors);
              if (r.filled) {
                setQuestions(r.questions);
                toast(`已填入 ${r.filled} 道题的答案与解析`);
              }
            }}
          >
            匹配并填入
          </button>
          <span className="small faint">答案通过题号对应，不要在两次导入之间修改题号。</span>
        </div>
        {errors.length > 0 && (
          <div className="notice notice-red">
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="small muted">每道题都应能从原文找到依据，干扰项应有明确的错误原因。解析用中文写，说明原文依据。</p>

      {qs.map((q, i) => (
        <div key={i} className="q-edit">
          <div className="row">
            <span className="q-no">{i + 1}.</span>
            <span className="q-prompt" style={{ fontFamily: 'var(--font-read)' }}>
              {q.prompt || <span className="faint">（题干为空）</span>}
            </span>
            <span className="pill">{TYPE_LABEL[q.type]}</span>
          </div>
          {q.type === 'choice' && (
            <div className="options">
              {(q.options ?? []).map((opt, k) => (
                <button
                  key={k}
                  type="button"
                  className={`option ${q.answer === opt && opt ? 'is-right' : ''}`}
                  onClick={() => updateQ(i, { answer: opt })}
                  disabled={!opt.trim()}
                >
                  <span className="letter">{LETTERS[k]}</span>
                  <span className="text">{opt || <span className="faint">（空选项）</span>}</span>
                  {q.answer === opt && opt && <span className="mark mark-right">✓</span>}
                </button>
              ))}
              {!q.answer && <span className="small" style={{ color: 'var(--red-pen)' }}>点击选项设为正确答案</span>}
            </div>
          )}
          {q.type === 'blank' && (
            <label className="field">
              <span>可接受答案（多个用 | 分隔，判分时忽略大小写和句末标点）</span>
              <input className="input" value={q.answer ?? ''} onChange={(e) => updateQ(i, { answer: e.target.value })} placeholder="例如：started|have started" />
              {acceptableAnswers(q).length > 1 && <span className="hint">共 {acceptableAnswers(q).length} 个可接受答案</span>}
            </label>
          )}
          {q.type === 'text' && (
            <label className="field">
              <span>参考答案（学生在答案开放后可见）</span>
              <textarea className="textarea" style={{ minHeight: 60 }} value={q.answer ?? ''} onChange={(e) => updateQ(i, { answer: e.target.value })} />
            </label>
          )}
          <label className="field">
            <span>解析</span>
            <textarea
              className="textarea"
              style={{ minHeight: 60 }}
              value={q.explanation ?? ''}
              onChange={(e) => updateQ(i, { explanation: e.target.value })}
              placeholder="原文依据在哪里；干扰项为什么错"
            />
          </label>
        </div>
      ))}
    </div>
  );
}

// ---------------- 4 · 发布 ----------------
function StepPublish(props: {
  form: Form;
  update: (p: Partial<Form>) => void;
  errors: string[];
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  busy: boolean;
  onPublish: () => void;
  status: string;
  dirty: boolean;
}) {
  const { form, update, errors, confirmed, setConfirmed } = props;
  const hasText = form.questions.some((q) => q.type === 'text');
  return (
    <section className="card stack-lg">
      <div className="stack">
        <h2>答案与解析的开放时间</h2>
        <label className="check">
          <input type="radio" name="release" checked={form.answerRelease === 'after_submit'} onChange={() => update({ answerRelease: 'after_submit' })} />
          <span>
            <b>提交后</b>
            <span className="muted small"> · 学生提交后立即看到成绩、答案和解析，适合日常练习</span>
            {hasText && <div className="small" style={{ color: 'var(--warn)' }}>本材料有表达题，仍需老师评分后才会开放。</div>}
          </span>
        </label>
        <label className="check">
          <input type="radio" name="release" checked={form.answerRelease === 'after_grading'} onChange={() => update({ answerRelease: 'after_grading' })} />
          <span>
            <b>老师批改后</b>
            <span className="muted small"> · 老师在“作业批改”确认后才开放，适合需要先看学生作答再讲解的材料</span>
          </span>
        </label>
      </div>

      <div className="stack">
        <h2>发布前检查</h2>
        {errors.length ? (
          <div className="notice notice-red">
            还有 {errors.length} 处需要处理：
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="notice notice-ok">
            标题、正文、{form.questions.length} 道题和答案都已填写。
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={errors.length > 0} />
          <span>我已核对内容、题目与答案，确认发布</span>
        </label>
      </div>

      <div className="row">
        <button className="btn btn-primary btn-lg" disabled={!confirmed || errors.length > 0 || props.busy} onClick={props.onPublish}>
          保存并发布
        </button>
        {props.status === 'published' && !props.dirty && (
          <Link to="/t/daily?assign=1" className="btn">
            去布置作业
          </Link>
        )}
      </div>
      <p className="small faint">保存草稿的材料暂不能布置。建议发布前点“试做”，从学生视角检查正文和题目。</p>
    </section>
  );
}
