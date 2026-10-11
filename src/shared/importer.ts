// 批量导入：解析外部 AI 输出的 <questions> / <solutions> 区块，并做发布前校验
import type { Question, QuestionType } from './types';

export const MAX_IMPORT = 30;
const TYPES: QuestionType[] = ['choice', 'blank', 'text'];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export interface ParseResult<T> {
  items: T[];
  errors: string[];
}

/** 取出 <tag>…</tag> 区块；没有区块时把整段当作 JSON。会去掉 ```json 代码围栏 */
export function extractBlock(text: string, tag: string): string | null {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  let body = m ? m[1] : null;
  if (body === null) {
    const otherTag = /<(questions|solutions)>/i.test(text);
    if (otherTag) return null;
    body = text;
  }
  body = body.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return body;
}

function parseJsonArray(raw: string, label: string): { value: unknown[] | null; error?: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /[“”]/.test(raw) ? '发现中文引号“”，JSON 必须使用英文双引号。' : '请检查英文双引号、逗号和括号是否成对。';
    return { value: null, error: `${label} 不是合法的 JSON：${msg}。${hint}` };
  }
  if (!Array.isArray(value)) return { value: null, error: `${label} 需要是 JSON 数组，也就是用 [ ] 包起来。` };
  return { value };
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}

/** 把 A/B/C/D 或选项文字统一转成选项完整文字；无法匹配时返回 null */
export function resolveChoiceAnswer(answer: string, options: string[]): string | null {
  const a = answer.trim();
  if (!a) return null;
  if (options.includes(a)) return a;
  const letter = a.replace(/[.)、．:：\s]/g, '').toUpperCase();
  if (letter.length === 1) {
    const idx = LETTERS.indexOf(letter);
    if (idx >= 0 && idx < options.length) return options[idx];
  }
  // 兼容 "A. At the school gate" 这种写法
  const m = a.match(/^([A-F])[.)、．:：\s]+(.+)$/i);
  if (m && options.includes(m[2].trim())) return m[2].trim();
  const loose = options.find((o) => o.toLowerCase() === a.toLowerCase());
  return loose ?? null;
}

export function parseQuestionsBlock(text: string): ParseResult<Question> {
  const raw = extractBlock(text, 'questions');
  if (raw === null || !raw) return { items: [], errors: ['没有找到 <questions> 区块或题目 JSON。'] };
  const { value, error } = parseJsonArray(raw, '<questions> 区块');
  if (!value) return { items: [], errors: [error!] };
  const errors: string[] = [];
  if (value.length < 1 || value.length > MAX_IMPORT) {
    errors.push(`单次支持导入 1 至 ${MAX_IMPORT} 道题，当前为 ${value.length} 道。`);
    return { items: [], errors };
  }
  const items: Question[] = [];
  const seen = new Set<string>();
  value.forEach((rawItem, i) => {
    const label = `第 ${i + 1} 题`;
    if (!rawItem || typeof rawItem !== 'object') {
      errors.push(`${label} 不是对象。`);
      return;
    }
    const o = rawItem as Record<string, unknown>;
    const id = str(o.id) || `q${i + 1}`;
    if (seen.has(id)) errors.push(`${label} 题号 ${id} 重复。`);
    seen.add(id);
    const type = (str(o.type) || 'choice') as QuestionType;
    if (!TYPES.includes(type)) errors.push(`${label}（${id}）type 只能是 choice、blank 或 text。`);
    const prompt = str(o.prompt);
    if (!prompt) errors.push(`${label}（${id}）缺少题干 prompt。`);
    const q: Question = { id, type, prompt };
    const tag = str(o.tag);
    if (tag) q.tag = tag;
    if (typeof o.points === 'number' && o.points > 0) q.points = o.points;
    if (type === 'choice') {
      const options = Array.isArray(o.options) ? o.options.map(str).filter(Boolean) : [];
      q.options = options;
      if (new Set(options).size < 2) errors.push(`${label}（${id}）至少需要两个不重复的选项。`);
      else if (new Set(options).size !== options.length) errors.push(`${label}（${id}）选项有重复。`);
    }
    const answer = Array.isArray(o.answer) ? o.answer.map(str).filter(Boolean).join('|') : str(o.answer);
    if (answer) {
      if (type === 'choice') {
        const resolved = resolveChoiceAnswer(answer, q.options ?? []);
        if (resolved === null) errors.push(`${label}（${id}）正确答案“${answer}”不在选项中。`);
        else q.answer = resolved;
      } else q.answer = answer;
    }
    const explanation = str(o.explanation);
    if (explanation) q.explanation = explanation;
    items.push(q);
  });
  return { items, errors };
}

export interface SolutionMatch {
  questions: Question[];
  filled: number;
  errors: string[];
}

/** 按 id 把 <solutions> 的答案和解析填入题目 */
export function matchSolutions(questions: Question[], text: string): SolutionMatch {
  const raw = extractBlock(text, 'solutions');
  if (raw === null || !raw) return { questions, filled: 0, errors: ['没有找到 <solutions> 区块或答案 JSON。'] };
  const { value, error } = parseJsonArray(raw, '<solutions> 区块');
  if (!value) return { questions, filled: 0, errors: [error!] };
  const errors: string[] = [];
  const byId = new Map(questions.map((q) => [q.id, { ...q }]));
  let filled = 0;
  const seen = new Set<string>();
  value.forEach((rawItem, i) => {
    const o = (rawItem ?? {}) as Record<string, unknown>;
    const id = str(o.id);
    if (!id) {
      errors.push(`第 ${i + 1} 条答案缺少 id。`);
      return;
    }
    if (seen.has(id)) errors.push(`答案题号 ${id} 重复。`);
    seen.add(id);
    const q = byId.get(id);
    if (!q) {
      errors.push(`答案 ${id} 找不到对应题目，请确认两次导入之间没有改动题号。`);
      return;
    }
    const answer = Array.isArray(o.answer) ? o.answer.map(str).filter(Boolean).join('|') : str(o.answer);
    if (answer) {
      if (q.type === 'choice') {
        const resolved = resolveChoiceAnswer(answer, q.options ?? []);
        if (resolved === null) {
          errors.push(`${id} 的正确答案“${answer}”不在选项中。`);
          return;
        }
        q.answer = resolved;
      } else q.answer = answer;
    }
    const explanation = str(o.explanation);
    if (explanation) q.explanation = explanation;
    byId.set(id, q);
    filled += 1;
  });
  const missing = questions.filter((q) => !seen.has(q.id)).map((q) => q.id);
  if (missing.length) errors.push(`以下题目没有对应答案：${missing.join('、')}。`);
  return { questions: questions.map((q) => byId.get(q.id)!), filled, errors };
}

/** 发布前校验，返回问题列表（为空表示可以发布） */
export function validateForPublish(title: string, body: string, questions: Question[]): string[] {
  const errors: string[] = [];
  if (!title.trim()) errors.push('请填写标题。');
  if (!body.trim()) errors.push('请粘贴阅读正文。');
  if (questions.length === 0) errors.push('至少需要一道题目。');
  const ids = new Set<string>();
  questions.forEach((q, i) => {
    const label = `第 ${i + 1} 题`;
    if (ids.has(q.id)) errors.push(`${label} 题号 ${q.id} 重复。`);
    ids.add(q.id);
    if (!q.prompt.trim()) errors.push(`${label} 缺少题干。`);
    if (q.type === 'choice') {
      const opts = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (new Set(opts).size < 2) errors.push(`${label} 至少需要两个不重复的选项。`);
      else if (new Set(opts).size !== opts.length) errors.push(`${label} 选项有重复。`);
      if (!q.answer) errors.push(`${label} 还没有设置正确答案。`);
      else if (!opts.includes(q.answer)) errors.push(`${label} 的正确答案不在选项中。`);
    } else if (q.type === 'blank') {
      if (!(q.answer ?? '').split('|').some((s) => s.trim())) errors.push(`${label} 还没有填写可接受答案。`);
    }
  });
  return errors;
}

export function nextQuestionId(questions: Question[]): string {
  let n = questions.length + 1;
  const ids = new Set(questions.map((q) => q.id));
  while (ids.has(`q${n}`)) n += 1;
  return `q${n}`;
}
