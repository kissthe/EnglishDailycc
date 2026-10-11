import { useEffect, useState } from 'react';
import { DEFAULT_READING_PROMPT } from '../../../shared/prompt';
import type { AiConfig, ReadingGenerateScene } from '../../../shared/types';
import { get, post, put } from '../../api';
import { ErrorBox, Loading, useLoad, useToast } from '../../ui';

const PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
];

const FUTURE = [
  { name: '阅读 · 划线翻译', phase: '第三期', desc: '学生提交阅读后，选中词句查看翻译' },
  { name: '听力 · 关键词与完整转述', phase: '第二期', desc: '核对关键词笔记和英文转述，给出语法和表达建议' },
  { name: '作文 · 辅助批改', phase: '第二期', desc: '评分与反馈建议，老师确认后采用' },
];

export function AiCenter() {
  const { data, error, loading, reload } = useLoad<{ config: AiConfig; readingScene: ReadingGenerateScene }>(() => get('/t/ai/config'));
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>AI 配置中心</h1>
          <p className="muted">支持兼容 OpenAI 接口的服务商。密钥只保存在服务器上，学生看不到。AI 生成的内容都需要老师核对后才会使用。</p>
        </div>
      </div>
      <Connection initial={data.config} />
      <ReadingScene initial={data.readingScene} />
      <section className="card stack">
        <h2>其他场景</h2>
        <div className="list">
          {FUTURE.map((f) => (
            <div key={f.name} className="list-item">
              <div className="grow">
                <div className="title">{f.name}</div>
                <div className="meta">{f.desc}</div>
              </div>
              <span className="pill">{f.phase}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Connection({ initial }: { initial: AiConfig }) {
  const toast = useToast();
  const [cfg, setCfg] = useState(initial);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState('');
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const saveCfg = async (extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await put<{ config: AiConfig }>('/t/ai/config', { baseUrl, model, apiKey, ...extra });
      setCfg(r.config);
      setApiKey('');
      toast('已保存');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setTest(null);
    setBusy(true);
    try {
      const r = await post<{ ok: boolean; reply?: string; error?: string; ms?: number }>('/t/ai/test');
      setTest(r.ok ? { ok: true, text: `连接成功（${r.ms} ms），模型回复：${r.reply}` } : { ok: false, text: r.error ?? '连接失败' });
    } finally {
      setBusy(false);
    }
  };

  const isMock = baseUrl.trim().toLowerCase() === 'mock';

  return (
    <section className="card stack">
      <div className="card-head">
        <h2>接口与模型</h2>
        {cfg.baseUrl ? <span className="pill pill-ok">已配置</span> : <span className="pill pill-warn">未配置</span>}
      </div>
      <div className="row small">
        <span className="muted">常用服务商：</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setBaseUrl(p.baseUrl);
              setModel(p.model);
            }}
          >
            {p.name}
          </button>
        ))}
        <span className="faint">（模型名称以服务商文档为准）</span>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>API 地址</span>
          <input id="ai-base" className="input num" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
          <span className="hint">填到 /v1 为止，系统会自动拼接 /chat/completions。填 mock 使用模拟输出。</span>
        </label>
        <label className="field">
          <span>模型</span>
          <input id="ai-model" className="input num" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
        </label>
      </div>
      <label className="field">
        <span>API 密钥</span>
        <input
          id="ai-key"
          className="input num"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={cfg.hasKey ? `已保存（${cfg.keyPreview}），留空则不修改` : isMock ? '模拟模式不需要密钥' : 'sk-…'}
          autoComplete="off"
        />
      </label>
      {test && <div className={`notice ${test.ok ? 'notice-ok' : 'notice-red'}`}>{test.text}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy} onClick={() => saveCfg()}>
          保存设置
        </button>
        <button className="btn" disabled={busy} onClick={runTest}>
          测试连接
        </button>
        {cfg.hasKey && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => saveCfg({ clearKey: true, apiKey: '' })}>
            清除密钥
          </button>
        )}
      </div>
      <p className="small faint">测试使用已保存的设置，修改后请先保存。</p>
    </section>
  );
}

function ReadingScene({ initial }: { initial: ReadingGenerateScene }) {
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const set = (p: Partial<ReadingGenerateScene>) => {
    setS((x) => ({ ...x, ...p }));
    setDirty(true);
  };
  useEffect(() => setS(initial), [initial]);

  const save = async (next = s) => {
    try {
      const r = await put<{ readingScene: ReadingGenerateScene }>('/t/ai/scenes/reading_generate', next);
      setS(r.readingScene);
      setDirty(false);
      toast('场景配置已保存');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };

  return (
    <section className="card stack">
      <div className="card-head">
        <h2>阅读 · 辅助出题</h2>
        <label className="switch">
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={(e) => {
              const next = { ...s, enabled: e.target.checked };
              setS(next);
              save(next);
            }}
          />
          <span className="small">{s.enabled ? '已启用' : '已暂停'}</span>
        </label>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>题目数量</span>
          <input id="sc-count" className="input num" type="number" min={1} max={30} value={s.count} onChange={(e) => set({ count: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>难度</span>
          <input id="sc-diff" className="input" value={s.difficulty} onChange={(e) => set({ difficulty: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>考查点</span>
        <input id="sc-focus" className="input" value={s.focus} onChange={(e) => set({ focus: e.target.value })} />
      </label>
      <label className="field">
        <span>出题提示词</span>
        <textarea id="sc-prompt" className="textarea mono" style={{ minHeight: 260 }} value={s.prompt} onChange={(e) => set({ prompt: e.target.value })} />
        <span className="hint">
          可用占位符：<code>{'{count}'}</code> 题目数量、<code>{'{difficulty}'}</code> 难度、<code>{'{focus}'}</code> 考查点、<code>{'{title}'}</code> 标题、
          <code>{'{passage}'}</code> 正文。请保留 &lt;questions&gt; 和 &lt;solutions&gt; 两个区块的输出要求，否则无法自动解析。
        </span>
      </label>
      <div className="row">
        <button className="btn btn-primary" disabled={!dirty} onClick={() => save()}>
          保存场景配置
        </button>
        <button className="btn btn-ghost" onClick={() => set({ prompt: DEFAULT_READING_PROMPT })}>
          恢复默认提示词
        </button>
      </div>
    </section>
  );
}
