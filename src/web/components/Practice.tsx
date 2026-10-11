import { type ReactNode, useEffect, useState } from 'react';
import { acceptableAnswers } from '../../shared/grading';
import type { Answers, AttemptResult, MaterialSnapshot, Notes, Question } from '../../shared/types';
import { load, save } from '../storage';

export type PracticeMode = 'answer' | 'review' | 'correction' | 'readonly';

const LETTERS = 'ABCDEFGH';
const FONT_KEY = 'ed_font_scale';
const SCALES = [0.9, 1, 1.12, 1.25, 1.4];

export function Passage({ snapshot, scale }: { snapshot: Pick<MaterialSnapshot, 'title' | 'body' | 'source'>; scale: number }) {
  const paras = snapshot.body.split(/\n\s*\n/).filter((p) => p.trim());
  return (
    <article className="passage" style={{ fontSize: `${scale * 1.05}rem` }}>
      <h2>{snapshot.title}</h2>
      {paras.map((p, i) => (
        <p key={i}>
          {p.split('\n').map((line, j, arr) => (
            <span key={j}>
              {line}
              {j < arr.length - 1 && <br />}
            </span>
          ))}
        </p>
      ))}
      {snapshot.source && <div className="source">来源：{snapshot.source}</div>}
    </article>
  );
}

export function useFontScale() {
  const [idx, setIdx] = useState(() => {
    const v = Number(load(FONT_KEY));
    return Number.isInteger(v) && v >= 0 && v < SCALES.length ? v : 1;
  });
  useEffect(() => save(FONT_KEY, String(idx)), [idx]);
  return {
    scale: SCALES[idx],
    smaller: idx > 0 ? () => setIdx(idx - 1) : undefined,
    larger: idx < SCALES.length - 1 ? () => setIdx(idx + 1) : undefined,
  };
}

export function FontControl({ font }: { font: ReturnType<typeof useFontScale> }) {
  return (
    <span className="seg" aria-label="字号">
      <button onClick={font.smaller} disabled={!font.smaller} aria-label="减小字号">
        A−
      </button>
      <button onClick={font.larger} disabled={!font.larger} aria-label="增大字号">
        A+
      </button>
    </span>
  );
}

interface Props {
  snapshot: MaterialSnapshot;
  mode: PracticeMode;
  answers: Answers;
  onAnswer?: (qid: string, value: string) => void;
  /** 本次作答的判分结果（review） */
  result?: AttemptResult | null;
  /** 订正时显示首次作答和对错 */
  firstAnswers?: Answers | null;
  firstResult?: AttemptResult | null;
  notes?: Notes;
  onNote?: (qid: string, value: string) => void;
  showAnswers?: boolean;
  questionComments?: Record<string, string>;
  /** 教师批改时插入的评分区域 */
  renderExtra?: (q: Question) => ReactNode;
  toolbar?: ReactNode;
}

export function Practice(props: Props) {
  const { snapshot, mode, answers, result, firstResult } = props;
  const font = useFontScale();
  const [expanded, setExpanded] = useState(mode !== 'answer');
  const [current, setCurrent] = useState(0);
  const qs = snapshot.questions;
  const answeredCount = qs.filter((q) => (answers[q.id] ?? '').trim()).length;

  const bubbleClass = (q: Question, i: number) => {
    const cls = ['bubble'];
    if (!expanded && i === current) cls.push('current');
    const r = mode === 'correction' ? firstResult?.perQuestion[q.id] : result?.perQuestion[q.id];
    if ((mode === 'review' || mode === 'correction') && r) {
      if (r.correct === true) cls.push('right');
      else if (r.correct === false) cls.push('wrong');
      else cls.push('pending');
    } else if ((answers[q.id] ?? '').trim()) cls.push('filled');
    return cls.join(' ');
  };

  const goTo = (i: number) => {
    if (expanded) {
      document.getElementById(`q-${qs[i].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else setCurrent(i);
  };

  return (
    <div className="stack-lg">
      <div className="stack">
        <div className="row-between">
          <div className="row">
            <span className="pill">阅读</span>
            <span className="faint small">
              {qs.length} 道题
              {mode === 'answer' && ` · 已作答 ${answeredCount}`}
            </span>
          </div>
          <div className="row">
            {props.toolbar}
            <FontControl font={font} />
          </div>
        </div>
        <Passage snapshot={snapshot} scale={font.scale} />
      </div>

      <section className="card stack" aria-label="题目">
        <div className="row-between">
          <nav className="sheet-nav" aria-label="题号">
            {qs.map((q, i) => (
              <button key={q.id} className={bubbleClass(q, i)} onClick={() => goTo(i)} aria-label={`第 ${i + 1} 题`}>
                {i + 1}
              </button>
            ))}
          </nav>
          <button className="btn btn-sm" onClick={() => setExpanded((e) => !e)}>
            {expanded ? '逐题显示' : '展开全部题目'}
          </button>
        </div>
        <hr className="divider" />
        {expanded ? (
          <div className="stack-lg">
            {qs.map((q, i) => (
              <div key={q.id} id={`q-${q.id}`} style={{ scrollMarginTop: 80 }}>
                <QuestionBlock {...props} q={q} index={i} scale={font.scale} />
                {i < qs.length - 1 && <hr className="divider" style={{ marginTop: 20 }} />}
              </div>
            ))}
          </div>
        ) : (
          qs[current] && (
            <div className="stack">
              <QuestionBlock {...props} q={qs[current]} index={current} scale={font.scale} />
              <div className="row-between" style={{ marginTop: 8 }}>
                <button className="btn" disabled={current === 0} onClick={() => setCurrent(current - 1)}>
                  ← 上一题
                </button>
                <span className="faint small num">
                  {current + 1} / {qs.length}
                </span>
                <button className="btn" disabled={current >= qs.length - 1} onClick={() => setCurrent(current + 1)}>
                  下一题 →
                </button>
              </div>
            </div>
          )
        )}
      </section>
    </div>
  );
}

function QuestionBlock(props: Props & { q: Question; index: number; scale: number }) {
  const { q, index, mode, answers, onAnswer, result, firstAnswers, firstResult, showAnswers, scale } = props;
  const value = answers[q.id] ?? '';
  const r = result?.perQuestion[q.id];
  const firstR = firstResult?.perQuestion[q.id];
  const lockedInCorrection = mode === 'correction' && firstR?.correct === true;
  const editable = (mode === 'answer' || mode === 'correction') && !lockedInCorrection && !!onAnswer;
  const comment = props.questionComments?.[q.id];

  return (
    <div className="question" style={{ fontSize: `${scale}rem` }}>
      <div className="q-head">
        <span className="q-no">{index + 1}.</span>
        <span className="q-prompt pre">{q.prompt}</span>
        {q.tag && <span className="pill">{q.tag}</span>}
        {q.type === 'text' && <span className="pill pill-warn">表达题 · {q.points ?? 1} 分</span>}
        {mode === 'review' && r && <ResultMark r={r} />}
      </div>

      {mode === 'correction' && firstR && firstR.correct !== true && (
        <div className="answer-line">
          首次作答：<code>{firstAnswers?.[q.id] || '（未作答）'}</code>{' '}
          <span className="mark mark-wrong">{firstR.correct === false ? '✗' : ''}</span>
          {firstR.correct === null ? <span className="pill pill-warn">待评分</span> : null}
          {firstR.score !== null && q.type === 'text' && <span className="faint small"> 得分 {firstR.score}/{firstR.max}</span>}
        </div>
      )}
      {lockedInCorrection && <div className="answer-line faint">首次已答对，无需订正。</div>}

      {q.type === 'choice' && (
        <div className="options" role="radiogroup">
          {(q.options ?? []).map((opt, i) => {
            const selected = value === opt;
            const cls = ['option'];
            if (showAnswers && q.answer) {
              if (opt === q.answer) cls.push('is-right');
              else if (selected) cls.push('is-wrong');
            } else if (selected) cls.push('selected');
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={selected}
                className={cls.join(' ')}
                disabled={!editable}
                onClick={() => onAnswer?.(q.id, selected && mode === 'answer' ? '' : opt)}
              >
                <span className="letter">{LETTERS[i]}</span>
                <span className="text">{opt}</span>
                {showAnswers && q.answer && opt === q.answer && <span className="mark mark-right">✓</span>}
                {showAnswers && q.answer && selected && opt !== q.answer && <span className="mark mark-wrong">✗</span>}
              </button>
            );
          })}
        </div>
      )}

      {q.type === 'blank' &&
        (editable ? (
          <input
            className="input"
            style={{ maxWidth: 360, fontFamily: 'var(--font-read)' }}
            value={value}
            placeholder="填写答案"
            onChange={(e) => onAnswer?.(q.id, e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        ) : (
          <div className="answer-line">
            你的答案：<code>{value || '（未作答）'}</code>
            {showAnswers && q.answer && (
              <>
                {' '}
                · 正确答案：<code>{acceptableAnswers(q).join(' / ')}</code>
              </>
            )}
          </div>
        ))}

      {q.type === 'text' &&
        (editable ? (
          <textarea
            className="textarea"
            style={{ fontFamily: 'var(--font-read)' }}
            value={value}
            placeholder="用英语作答"
            onChange={(e) => onAnswer?.(q.id, e.target.value)}
          />
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            <div className="answer-line">你的回答：</div>
            <div className="passage" style={{ padding: '10px 14px', fontSize: '1em' }}>
              {value || <span className="faint">（未作答）</span>}
            </div>
            {mode === 'review' && r && (
              <div className="answer-line">
                得分：{r.score === null ? <span className="pill pill-warn">等待老师评分</span> : <ScoreInline score={r.score} max={r.max} />}
              </div>
            )}
            {showAnswers && q.answer && (
              <div className="answer-line">
                参考答案：<code>{q.answer}</code>
              </div>
            )}
          </div>
        ))}

      {mode === 'correction' && firstR && firstR.correct !== true && props.onNote && (
        <label className="field">
          <span>订正说明（原文依据在哪里、首次为什么选错）</span>
          <textarea
            className="textarea"
            style={{ minHeight: 60 }}
            value={props.notes?.[q.id] ?? ''}
            onChange={(e) => props.onNote?.(q.id, e.target.value)}
            placeholder="例如：第二段 but 后面才是作者真正的意思，我只看了前半句。"
          />
        </label>
      )}
      {mode !== 'correction' && props.notes?.[q.id] && (
        <div className="answer-line">
          订正说明：<span className="muted">{props.notes[q.id]}</span>
        </div>
      )}

      {showAnswers && q.explanation && (
        <div className="explain pre">
          <b>解析</b> {q.explanation}
        </div>
      )}
      {comment && (
        <div className="teacher-note pre">
          <b>老师批注</b> {comment}
        </div>
      )}
      {props.renderExtra?.(q)}
    </div>
  );
}

function ResultMark({ r }: { r: { correct: boolean | null } }) {
  if (r.correct === true) return <span className="mark mark-right" aria-label="正确">✓</span>;
  if (r.correct === false) return <span className="mark mark-wrong" aria-label="错误">✗</span>;
  return <span className="pill pill-warn">待评分</span>;
}

function ScoreInline({ score, max }: { score: number; max: number }) {
  return (
    <span className="num">
      <b style={{ color: score < max ? 'var(--red-pen)' : 'var(--ok)' }}>{score}</b>/{max}
    </span>
  );
}
