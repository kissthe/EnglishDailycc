import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';

const TEACHER_NAV = [
  { to: '/t', label: '概览', end: true },
  { to: '/t/bank', label: '精选题库' },
  { to: '/t/daily', label: '每日作业' },
  { to: '/t/grading', label: '作业批改' },
  { to: '/t/students', label: '学生账号' },
  { to: '/t/ai', label: 'AI 配置中心' },
];
const STUDENT_NAV = [{ to: '/s', label: '作业', end: true }];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const items = user?.role === 'teacher' ? TEACHER_NAV : STUDENT_NAV;
  return (
    <>
      {import.meta.env.VITE_DEMO && (
        <div className="demo-bar">
          演示版：数据只保存在当前浏览器，AI 使用模拟输出。教师 teacher / 学生 lihua，密码都是 demo123{' '}
          <button className="btn-link" onClick={() => (window as unknown as { __edResetDemo?: () => void }).__edResetDemo?.()}>
            重置演示数据
          </button>
        </div>
      )}
      <header className="topbar">
        <div className="topbar-inner">
          <Link to={user?.role === 'teacher' ? '/t' : '/s'} className="brand">
            <b>English Daily</b>
            <span>{user?.role === 'teacher' ? '教师端' : '学生端'}</span>
          </Link>
          <nav className="nav">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end}>
                {i.label}
              </NavLink>
            ))}
          </nav>
          <div className="user-chip">
            <NavLink to="/account" className="btn-link">
              {user?.displayName}
            </NavLink>
            <button
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                await logout();
                nav('/');
              }}
            >
              退出
            </button>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
