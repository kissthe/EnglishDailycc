// 兼容 OpenAI 协议的 Chat Completions 调用。baseUrl 填 mock 时使用本地模拟输出（演示用）
import { DEFAULT_READING_SCENE } from '../shared/prompt';
import type { AiConfig, ReadingGenerateScene } from '../shared/types';
import { type Db, getSetting, setSetting } from './db';

export interface StoredAiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export const AI_KEY = 'ai_config';
export const SCENE_KEY = 'scene:reading_generate';

export function loadAiConfig(db: Db): StoredAiConfig {
  return getSetting<StoredAiConfig>(db, AI_KEY, { baseUrl: '', model: '', apiKey: '' });
}

export function publicAiConfig(cfg: StoredAiConfig): AiConfig {
  const k = cfg.apiKey;
  return {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasKey: !!k,
    keyPreview: k ? (k.length > 8 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '已设置') : '',
  };
}

export function loadReadingScene(db: Db): ReadingGenerateScene {
  return { ...DEFAULT_READING_SCENE, ...getSetting<Partial<ReadingGenerateScene>>(db, SCENE_KEY, {}) };
}

export function saveReadingScene(db: Db, scene: ReadingGenerateScene): void {
  setSetting(db, SCENE_KEY, scene);
}

export class AiError extends Error {}

export type ChatFn = (cfg: StoredAiConfig, prompt: string, opts?: { maxTokens?: number }) => Promise<string>;

export const chatCompletion: ChatFn = async (cfg, prompt, opts = {}) => {
  if (cfg.baseUrl.trim().toLowerCase() === 'mock') return mockCompletion(prompt);
  if (!cfg.baseUrl || !cfg.model) throw new AiError('请先在 AI 配置中心填写接口地址和模型。');
  if (!cfg.apiKey) throw new AiError('请先在 AI 配置中心填写 API 密钥。');
  const url = cfg.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions';
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: opts.maxTokens ?? 4000,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new AiError(`无法连接 AI 接口：${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  if (!res.ok) throw new AiError(`AI 接口返回错误 ${res.status}：${text.slice(0, 300)}`);
  try {
    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('缺少 choices[0].message.content');
    return content;
  } catch (e) {
    throw new AiError(`AI 返回内容无法识别：${e instanceof Error ? e.message : String(e)}`);
  }
};

// ---------- 模拟输出：从原文抽句子生成判断题，便于没有密钥时体验完整流程 ----------

function mockCompletion(prompt: string): string {
  if (!prompt.includes('文章如下')) return 'OK';
  const count = Number(prompt.match(/编写(\d+)道/)?.[1] ?? 4);
  const title = prompt.match(/文章标题：(.*)/)?.[1]?.trim() ?? '';
  const passage = prompt.split('文章如下：').pop() ?? '';
  const sentences = passage
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(' ').length >= 6 && s.length <= 160);
  const questions: unknown[] = [];
  const solutions: unknown[] = [];
  const titleOptions = [title || 'A Day to Remember', 'How to Cook Rice', 'A Trip to the Moon', 'The History of Football'];
  questions.push({ id: 'q1', type: 'choice', prompt: 'Which is the best title for the passage?', options: titleOptions, tag: '主旨大意' });
  solutions.push({ id: 'q1', answer: titleOptions[0], explanation: '【模拟输出】全文围绕这一主题展开，其他标题与文章内容无关。' });
  for (const s of sentences) {
    if (questions.length >= count) break;
    const i = questions.length;
    const wrongs: string[] = [];
    for (let v = 0; wrongs.length < 3 && v < 9; v++) {
      const w = alter(s, v);
      if (w !== s && !wrongs.includes(w)) wrongs.push(w);
    }
    if (wrongs.length < 3) continue;
    const options = [s, ...wrongs];
    const rot = i % 4;
    const shuffled = [...options.slice(rot), ...options.slice(0, rot)];
    questions.push({
      id: `q${i + 1}`,
      type: 'choice',
      prompt: 'Which of the following is TRUE according to the passage?',
      options: shuffled,
      tag: '细节理解',
    });
    solutions.push({ id: `q${i + 1}`, answer: s, explanation: `【模拟输出】原文原句：“${s}” 其余选项改动了原文信息。` });
  }
  return `<questions>\n${JSON.stringify(questions, null, 2)}\n</questions>\n<solutions>\n${JSON.stringify(solutions, null, 2)}\n</solutions>`;
}

const SWAPS: [RegExp, string][] = [
  [/\b(is|are|was|were|will|can|could|should|would)\b/, '$1 not'],
  [/\b(always)\b/, 'never'],
  [/\b(many)\b/, 'few'],
  [/\b(more)\b/, 'less'],
  [/\b(before)\b/, 'after'],
  [/\b(first)\b/, 'last'],
];

function alter(s: string, variant: number): string {
  if (variant === 0) {
    const num = s.match(/\b\d+\b/);
    if (num) return s.replace(num[0], String(Number(num[0]) + 2));
  }
  for (const [re, rep] of SWAPS.slice(variant % SWAPS.length).concat(SWAPS)) {
    if (re.test(s)) {
      const out = s.replace(re, rep);
      if (out !== s) return variant === 2 ? out.replace(/\.$/, ' every day.') : out;
    }
  }
  const words = s.split(' ');
  const idx = Math.min(words.length - 2, 2 + variant * 2);
  words.splice(idx, 0, ['only', 'never', 'hardly'][variant % 3]);
  return words.join(' ');
}
