import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export function LoginPage() {
  const { login, setup, needsSetup } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = needsSetup ? await setup(username, displayName, password) : await login(username, password);
      nav(user.role === 'teacher' ? '/t' : '/s', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const quick = async (u: string) => {
    setBusy(true);
    setError('');
    try {
      const user = await login(u, 'demo123');
      nav(user.role === 'teacher' ? '/t' : '/s', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card stack-lg">
        <div className="stack" style={{ gap: 4 }}>
          <div className="login-title">English Daily</div>
          <p className="muted">每天一点英语：阅读、作答、订正。</p>
        </div>
        <form className="card stack" onSubmit={submit}>
          <h2>{needsSetup ? '初始化教师账号' : '登录'}</h2>
          {needsSetup && <p className="muted small">第一次使用，请先创建教师账号。学生账号之后由老师在“学生账号”中创建。</p>}
          <label className="field">
            <span>用户名</span>
            <input id="login-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" required />
          </label>
          {needsSetup && (
            <label className="field">
              <span>显示名称</span>
              <input id="login-name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="例如：王老师" />
            </label>
          )}
          <label className="field">
            <span>密码</span>
            <input
              id="login-pass"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={needsSetup ? 'new-password' : 'current-password'}
              required
            />
            {needsSetup && <span className="hint">至少 6 位</span>}
          </label>
          {error && <div className="notice notice-red">{error}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? '请稍候…' : needsSetup ? '创建并登录' : '登录'}
          </button>
        </form>
        {import.meta.env.VITE_DEMO && !needsSetup && (
          <div className="card stack">
            <div className="section-title">演示账号</div>
            <div className="row">
              <button className="btn grow" onClick={() => quick('teacher')} disabled={busy}>
                以老师身份进入
              </button>
              <button className="btn grow" onClick={() => quick('lihua')} disabled={busy}>
                以学生（李华）进入
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
