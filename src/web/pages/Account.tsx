import { type FormEvent, useState } from 'react';
import { post } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../ui';

export function AccountPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) return setError('两次输入的新密码不一致');
    try {
      await post('/auth/password', { oldPassword, newPassword });
      toast('密码已修改');
      setOld('');
      setNew('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="page-narrow stack-lg" style={{ margin: '0 auto' }}>
      <div className="page-head">
        <div>
          <h1>我的账号</h1>
          <p className="muted">
            {user?.displayName} · 用户名 {user?.username} · {user?.role === 'teacher' ? '教师' : '学生'}
          </p>
        </div>
      </div>
      <form className="card stack" onSubmit={submit} style={{ maxWidth: 420 }}>
        <h2>修改密码</h2>
        <label className="field">
          <span>原密码</span>
          <input id="pw-old" className="input" type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>新密码</span>
          <input id="pw-new" className="input" type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} autoComplete="new-password" required />
          <span className="hint">至少 6 位。修改后其他设备需要重新登录。</span>
        </label>
        <label className="field">
          <span>再次输入新密码</span>
          <input id="pw-confirm" className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>
        {error && <div className="notice notice-red">{error}</div>}
        <div>
          <button className="btn btn-primary">保存新密码</button>
        </div>
      </form>
    </div>
  );
}
