import { Link } from 'react-router-dom';
import { formatDateCn } from '../../../shared/dates';
import type { AssignmentListItem } from '../../../shared/types';
import { get } from '../../api';
import { AssignmentStatus, Empty, ErrorBox, Loading, ScoreText, formatTime, useLoad } from '../../ui';

interface Data {
  today: string;
  todayItems: AssignmentListItem[];
  pending: AssignmentListItem[];
  recent: AssignmentListItem[];
  counts: { students: number; published: number; drafts: number };
}

export function Overview() {
  const { data, error, loading, reload } = useLoad<Data>(() => get('/t/overview'));
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const done = data.todayItems.filter((a) => a.status === 'submitted' || a.status === 'graded').length;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>概览</h1>
          <p className="muted">{formatDateCn(data.today)}</p>
        </div>
        <div className="row">
          <Link to="/t/bank/new" className="btn">
            新建材料
          </Link>
          <Link to="/t/daily?assign=1" className="btn btn-primary">
            布置作业
          </Link>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">今日完成</div>
          <div className="value">
            {done}
            <span className="faint" style={{ fontSize: '1rem' }}>
              /{data.todayItems.length}
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="label">待批改</div>
          <div className="value" style={{ color: data.pending.length ? 'var(--red-pen)' : undefined }}>
            {data.pending.length}
          </div>
        </div>
        <div className="stat">
          <div className="label">已发布材料</div>
          <div className="value">{data.counts.published}</div>
        </div>
        <div className="stat">
          <div className="label">在读学生</div>
          <div className="value">{data.counts.students}</div>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>今日作业</h2>
            <Link to="/t/daily" className="btn-link small">
              全部 →
            </Link>
          </div>
          {data.todayItems.length ? (
            <div className="list">
              {data.todayItems.map((a) => (
                <div key={a.id} className="list-item">
                  <div className="grow">
                    <div className="title">{a.studentName}</div>
                    <div className="meta">{a.title}</div>
                  </div>
                  <ScoreText score={a.score} total={a.total} />
                  <AssignmentStatus a={a} />
                </div>
              ))}
            </div>
          ) : (
            <Empty title="今天还没有布置作业">
              <Link to="/t/daily?assign=1">去布置</Link>
            </Empty>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>待批改</h2>
            <Link to="/t/grading" className="btn-link small">
              作业批改 →
            </Link>
          </div>
          {data.pending.length ? (
            <div className="list">
              {data.pending.map((a) => (
                <Link key={a.id} to={`/t/grading/${a.id}`} className="list-item">
                  <div className="grow">
                    <div className="title">
                      {a.studentName} · {a.title}
                    </div>
                    <div className="meta">
                      <span>{formatDateCn(a.date)}</span>
                      <span>提交于 {formatTime(a.submittedAt)}</span>
                    </div>
                  </div>
                  <AssignmentStatus a={a} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="没有待批改的作业" />
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>最近提交</h2>
        </div>
        {data.recent.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>学生</th>
                  <th>材料</th>
                  <th>作业日期</th>
                  <th>首次成绩</th>
                  <th>订正</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{a.studentName}</td>
                    <td>
                      <Link to={`/t/grading/${a.id}`}>{a.title}</Link>
                    </td>
                    <td className="nowrap">{formatDateCn(a.date)}</td>
                    <td>
                      <ScoreText score={a.score} total={a.total} />
                    </td>
                    <td>
                      <ScoreText score={a.correctionScore} total={a.total} />
                    </td>
                    <td>
                      <AssignmentStatus a={a} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="还没有学生提交作业" />
        )}
      </section>
    </div>
  );
}
