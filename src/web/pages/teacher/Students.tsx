import { type FormEvent, useState } from 'react';
import type { User } from '../../../shared/types';
import { get, patch, post } from '../../api';
import { Empty, ErrorBox, Loading, Modal, formatTime, useLoad, useToast } from '../../ui';

export function StudentsPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad<{ students: User[] }>(() => get('/t/students'));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>学生账号</h1>
          <p className="muted">学生账号由老师创建，学生用用户名和密码登录。停用后学生无法登录，作业记录保留。</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          添加学生
        </button>
      </div>
      <section className="card">
        {data?.students.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>用户名</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.students.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.displayName}</b>
                    </td>
                    <td className="num">{s.username}</td>
                    <td>{s.active ? <span className="pill pill-ok">正常</span> : <span className="pill">已停用</span>}</td>
                    <td className="small muted nowrap">{formatTime(s.createdAt)}</td>
                    <td className="nowrap">
                      <button className="btn btn-sm" onClick={() => setEditing(s)}>
                        编辑
                      </button>{' '}
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={async () => {
                          await patch(`/t/students/${s.id}`, { active: !s.active });
                          toast(s.active ? '已停用' : '已启用');
                          reload();
                        }}
                      >
                        {s.active ? '停用' : '启用'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="还没有学生">点击“添加学生”创建第一个学生账号。</Empty>
        )}
      </section>

      {creating && (
        <StudentForm
          title="添加学生"
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            await post('/t/students', v);
            toast(`已创建：${v.displayName || v.username}。请把用户名和密码告诉学生`);
            setCreating(false);
            reload();
          }}
        />
      )}
      {editing && (
        <StudentForm
          title={`编辑 ${editing.displayName}`}
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            await patch(`/t/students/${editing.id}`, { displayName: v.displayName, password: v.password || undefined });
            toast(v.password ? '已保存，新密码生效，学生需要重新登录' : '已保存');
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function StudentForm({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: User;
  onClose: () => void;
  onSubmit: (v: { username: string; displayName: string; password: string }) => Promise<void>;
}) {
  const [username, setUsername] = useState(initial?.username ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onSubmit({ username, displayName, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>姓名</span>
          <input id="stu-name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="例如：李华" required />
        </label>
        <label className="field">
          <span>用户名</span>
          <input
            id="stu-user"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={!!initial}
            placeholder="字母或数字，例如 lihua"
            autoCapitalize="off"
            required
          />
        </label>
        <label className="field">
          <span>{initial ? '重置密码（留空则不修改）' : '初始密码'}</span>
          <input id="stu-pass" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required={!initial} autoComplete="new-password" />
          <span className="hint">至少 6 位。学生登录后可以在“我的账号”自行修改。</span>
        </label>
        {error && <div className="notice notice-red">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary">保存</button>
        </div>
      </form>
    </Modal>
  );
}
