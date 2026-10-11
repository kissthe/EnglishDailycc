import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AssignmentListItem } from '../shared/types';

// ---------------- 提示 ----------------
type Toast = { id: number; text: string; error?: boolean };
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 5000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'toast-error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- 弹窗 ----------------
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------- 二次确认按钮（嵌入页面中 confirm() 不可用） ----------------
export function ConfirmButton({
  children,
  confirmText = '确认？',
  onConfirm,
  className = 'btn btn-sm btn-danger',
  disabled,
}: {
  children: ReactNode;
  confirmText?: ReactNode;
  onConfirm: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!armed)
    return (
      <button
        className={className}
        disabled={disabled}
        onClick={() => {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 4000);
        }}
      >
        {children}
      </button>
    );
  return (
    <span className="row" style={{ gap: 4 }}>
      <button
        className={className}
        onClick={async () => {
          clearTimeout(timer.current);
          setArmed(false);
          await onConfirm();
        }}
      >
        {confirmText}
      </button>
      <button className="btn btn-sm btn-ghost" onClick={() => setArmed(false)}>
        取消
      </button>
    </span>
  );
}

// ---------------- 数据加载 ----------------
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

export function Loading({ text = '加载中…' }: { text?: string }) {
  return <div className="empty faint">{text}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-red row-between">
      <span>{error}</span>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

// ---------------- 作业状态 ----------------
export function AssignmentStatus({ a, forStudent }: { a: AssignmentListItem; forStudent?: boolean }) {
  if (a.status === 'not_started') return <span className="pill">未开始</span>;
  if (a.status === 'in_progress') return <span className="pill pill-accent">作答中</span>;
  if (a.status === 'submitted') return <span className="pill pill-warn">{forStudent ? '已提交 · 待批改' : '待批改'}</span>;
  if (a.correctionStatus === 'in_progress') return <span className="pill pill-accent">订正中</span>;
  if (a.correctionStatus === 'submitted') return <span className="pill pill-warn">订正待批改</span>;
  if (a.correctionStatus === 'graded') return <span className="pill pill-ok">已订正</span>;
  if (a.correctionRequired) return <span className="pill pill-red">需订正</span>;
  return <span className="pill pill-ok">已完成</span>;
}

export function ScoreText({ score, total }: { score: number | null; total: number }) {
  if (score === null) return <span className="faint">—</span>;
  return (
    <span className="num">
      <b style={{ color: score < total ? 'var(--red-pen)' : 'var(--ok)' }}>{score}</b>
      <span className="faint">/{total}</span>
    </span>
  );
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
