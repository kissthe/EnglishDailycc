import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './Layout';
import { AccountPage } from './pages/Account';
import { LoginPage } from './pages/Login';
import { StudentHome } from './pages/student/Home';
import { StudentTask } from './pages/student/Task';
import { AiCenter } from './pages/teacher/AiCenter';
import { BankPage } from './pages/teacher/Bank';
import { DailyPage } from './pages/teacher/Daily';
import { EditorPage } from './pages/teacher/Editor';
import { GradingDetailPage, GradingPage } from './pages/teacher/Grading';
import { Overview } from './pages/teacher/Overview';
import { StudentsPage } from './pages/teacher/Students';
import { Loading, ToastProvider } from './ui';

function Routed() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user)
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  if (user.role === 'teacher')
    return (
      <Layout>
        <Routes>
          <Route path="/t" element={<Overview />} />
          <Route path="/t/bank" element={<BankPage />} />
          <Route path="/t/bank/new" element={<EditorPage />} />
          <Route path="/t/bank/:id" element={<EditorPage />} />
          <Route path="/t/daily" element={<DailyPage />} />
          <Route path="/t/grading" element={<GradingPage />} />
          <Route path="/t/grading/:id" element={<GradingDetailPage />} />
          <Route path="/t/students" element={<StudentsPage />} />
          <Route path="/t/ai" element={<AiCenter />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/t" replace />} />
        </Routes>
      </Layout>
    );
  return (
    <Layout>
      <Routes>
        <Route path="/s" element={<StudentHome />} />
        <Route path="/s/task/:id" element={<StudentTask />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/s" replace />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <HashRouter>
          <Routed />
        </HashRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
