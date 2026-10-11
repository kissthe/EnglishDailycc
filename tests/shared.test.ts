import { describe, expect, it } from 'vitest';
import { checkAnswer, gradeAttempt } from '../src/shared/grading';
import { matchSolutions, parseQuestionsBlock, resolveChoiceAnswer, validateForPublish } from '../src/shared/importer';
import { buildReadingPrompt, DEFAULT_READING_SCENE } from '../src/shared/prompt';
import type { Question } from '../src/shared/types';

const SAMPLE = `<questions>
[
  {"id":"q1","type":"choice",
   "prompt":"Where will the students meet?",
   "options":["At the school gate","At the museum","At the library","At the bus station"],
   "tag":"细节理解"}
]
</questions>
<solutions>
[
  {"id":"q1","answer":"At the school gate","explanation":"原文明确说明在校门口集合。"}
]
</solutions>`;

describe('批量导入', () => {
  it('解析手册里的示例格式', () => {
    const q = parseQuestionsBlock(SAMPLE);
    expect(q.errors).toEqual([]);
    expect(q.items).toHaveLength(1);
    const m = matchSolutions(q.items, SAMPLE);
    expect(m.errors).toEqual([]);
    expect(m.questions[0].answer).toBe('At the school gate');
  });

  it('A/B/C/D 字母答案会转成选项文字', () => {
    expect(resolveChoiceAnswer('B', ['x', 'y', 'z'])).toBe('y');
    expect(resolveChoiceAnswer('C. z', ['x', 'y', 'z'])).toBe('z');
    expect(resolveChoiceAnswer('E', ['x', 'y'])).toBeNull();
  });

  it('报告中文引号、重复题号、选项不足和答案不在选项中', () => {
    expect(parseQuestionsBlock('<questions>[{“id”:1}]</questions>').errors[0]).toContain('中文引号');
    const r = parseQuestionsBlock(
      '[{"id":"q1","prompt":"a","options":["x"]},{"id":"q1","prompt":"b","options":["x","y"],"answer":"z"}]',
    );
    expect(r.errors.join()).toContain('至少需要两个不重复的选项');
    expect(r.errors.join()).toContain('重复');
    expect(r.errors.join()).toContain('不在选项中');
  });

  it('限制 1 至 30 题', () => {
    const many = JSON.stringify(Array.from({ length: 31 }, (_, i) => ({ id: `q${i}`, prompt: 'p', options: ['a', 'b'] })));
    expect(parseQuestionsBlock(many).errors[0]).toContain('1 至 30');
  });

  it('答案 id 对不上时提示', () => {
    const q = parseQuestionsBlock(SAMPLE).items;
    const m = matchSolutions(q, '<solutions>[{"id":"q9","answer":"A"}]</solutions>');
    expect(m.errors.join()).toContain('q9');
    expect(m.errors.join()).toContain('没有对应答案');
  });
});

describe('判分', () => {
  const qs: Question[] = [
    { id: 'q1', type: 'choice', prompt: '', options: ['a', 'b'], answer: 'b' },
    { id: 'q2', type: 'blank', prompt: '', answer: 'until|till' },
    { id: 'q3', type: 'text', prompt: '', points: 2 },
  ];
  it('填空题忽略大小写和句末标点，支持多个答案', () => {
    expect(checkAnswer(qs[1], ' Till. ')).toBe(true);
    expect(checkAnswer(qs[1], 'by')).toBe(false);
  });
  it('表达题等待教师评分', () => {
    const r = gradeAttempt(qs, { q1: 'b', q2: 'until', q3: 'Some text' });
    expect(r.pendingManual).toBe(true);
    expect(r.score).toBe(2);
    expect(r.total).toBe(4);
    const r2 = gradeAttempt(qs, { q1: 'b', q2: 'until', q3: 'Some text' }, { q3: 2 });
    expect(r2.score).toBe(4);
    expect(r2.pendingManual).toBe(false);
  });
  it('发布校验', () => {
    expect(validateForPublish('', '', [])).toHaveLength(3);
    expect(validateForPublish('t', 'b', [{ ...qs[0], prompt: 'Which?' }])).toEqual([]);
  });
});

describe('提示词', () => {
  it('替换占位符并包含正文', () => {
    const p = buildReadingPrompt({ ...DEFAULT_READING_SCENE, count: 5 }, 'Title', 'Body text.');
    expect(p).toContain('5道');
    expect(p).toContain('q1 至 q5');
    expect(p).toContain('Body text.');
  });
});
