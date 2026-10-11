import type { ReadingGenerateScene } from './types';

export const DEFAULT_READING_PROMPT = `请根据下面的英语文章，为初三学生编写{count}道单项选择题，每题4个不重复选项，且只有1个明确正确答案。难度：{difficulty}。考查点：{focus}。不得虚构文章事实，不使用仅凭常识即可回答的问题。中文解析要指出原文依据，并解释干扰项为什么错误。

输出两个独立区块：<questions> 内为题目 JSON 数组，<solutions> 内为答案解析 JSON 数组。题号使用 q1 至 q{count} 且保持一致。题目字段包括 id、type、prompt、options、tag，type 为 choice；答案字段包括 id、answer、explanation。答案最好写选项完整文字，也可用 A/B/C/D。只输出这两个区块，区块内部使用合法 JSON，不写注释。

文章标题：{title}
文章如下：
{passage}`;

export const DEFAULT_READING_SCENE: ReadingGenerateScene = {
  enabled: true,
  count: 4,
  difficulty: '中考难度，适合初三学生',
  focus: '主旨大意、细节理解、推理判断',
  prompt: DEFAULT_READING_PROMPT,
};

export function buildReadingPrompt(scene: ReadingGenerateScene, title: string, passage: string): string {
  const values: Record<string, string> = {
    count: String(scene.count),
    difficulty: scene.difficulty,
    focus: scene.focus,
    title: title.trim() || '（无标题）',
    passage: passage.trim(),
  };
  const template = scene.prompt.trim() || DEFAULT_READING_PROMPT;
  let out = template.replace(/\{(count|difficulty|focus|title|passage)\}/g, (_, k: string) => values[k]);
  // 模板里删掉了 {passage} 时，仍然把正文附在最后
  if (!template.includes('{passage}')) out += `\n\n文章如下：\n${values.passage}`;
  return out;
}
