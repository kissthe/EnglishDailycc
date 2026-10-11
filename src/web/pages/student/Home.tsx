import { Link } from 'react-router-dom';
import { formatDateCn } from '../../../shared/dates';
import type { AssignmentListItem } from '../../../shared/types';
import { get } from '../../api';
import { useAuth } from '../../auth';
import { AssignmentStatus, Empty, ErrorBox, Loading, ScoreText, useLoad } from '../../ui';

interface Data {
  today: string;
  assignments: AssignmentListItem[];
  upcomingCount: number;
}

function TaskRow({ a, showDate }: { a: AssignmentListItem; showDate?: boolean }) {
  const action =
    a.status === 'not_started' ? '开始' : a.status === 'in_progress' ? '继续作答' : a.correctionStatus === 'in_progress' ? '继续订正' : '查看';
  return (
    <Link to={`/s/task/${a.id}`} className="list-item">
      <div className="grow">
        <div className="row">
          <span className="title">{a.title}</span>
          {a.hasNewFeedback && <span className="pill pill-red">新反馈</span>}
        </div>
        <div className="meta">
          {showDate && <span>{formatDateCn(a.date)}</span>}
          <span>阅读 · {a.questionCount} 题</span>
          {a.score !== null && (
            <span>
              首次成绩 <ScoreText score={a.score} total={a.total} />
            </span>
          )}
          {a.correctionScore !== null && (
            <span>
              订正 <ScoreText score={a.correctionScore} total={a.total} />
            </span>
          )}
        </div>
      </div>
      <AssignmentStatus a={a} forStudent />
      <span className={`btn btn-sm ${a.status === 'not_started' || a.status === 'in_progress' ? 'btn-primary' : ''}`}>{action}</span>
    </Link>
  );
}

export function StudentHome() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad<Data>(() => get('/s/my/assignments'));
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const todayItems = data.assignments.filter((a) => a.date === data.today);
  const past = data.assignments.filter((a) => a.date !== data.today);
  const unfinished = past.filter((a) => a.status === 'not_started' || a.status === 'in_progress');
  const followUp = past.filter(
    (a) =>
      !unfinished.includes(a) &&
      (a.hasNewFeedback || a.correctionStatus === 'in_progress' || (a.correctionRequired && a.correctionStatus === 'none')),
  );
  const history = past.filter((a) => !unfinished.includes(a) && !followUp.includes(a));
  const doneToday = todayItems.filter((a) => a.status === 'submitted' || a.status === 'graded').length;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>{user?.displayName}，你好</h1>
          <p className="muted">
            今天是 {formatDateCn(data.today)}
            {todayItems.length > 0 && ` · 今日作业已完成 ${doneToday}/${todayItems.length}`}
          </p>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>今日作业</h2>
        </div>
        {todayItems.length ? (
          <div className="list">
            {todayItems.map((a) => (
              <TaskRow key={a.id} a={a} />
            ))}
          </div>
        ) : (
          <Empty title="今天没有布置作业">
            {data.upcomingCount > 0 ? `老师已经提前布置了 ${data.upcomingCount} 份作业，到日期后会出现在这里。` : '可以复习一下之前的错题。'}
          </Empty>
        )}
      </section>

      {unfinished.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>之前未完成</h2>
            <span className="pill pill-warn">{unfinished.length}</span>
          </div>
          <div className="list">
            {unfinished.map((a) => (
              <TaskRow key={a.id} a={a} showDate />
            ))}
          </div>
        </section>
      )}

      {followUp.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>反馈与订正</h2>
          </div>
          <div className="list">
            {followUp.map((a) => (
              <TaskRow key={a.id} a={a} showDate />
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>历史记录</h2>
        </div>
        {history.length ? (
          <div className="list">
            {history.map((a) => (
              <TaskRow key={a.id} a={a} showDate />
            ))}
          </div>
        ) : (
          <Empty title="还没有历史记录" />
        )}
      </section>
    </div>
  );
}
