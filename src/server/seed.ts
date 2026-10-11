// 演示数据：浏览器预览版和 `npm run seed` 共用
import { addDays } from '../shared/dates';
import type { Material, MaterialSnapshot, Question } from '../shared/types';
import { AI_KEY } from './ai';
import { hashPassword } from './auth';
import { type Db, newId, nowIso, setSetting } from './db';

const MUSEUM: Pick<Material, 'title' | 'source' | 'body' | 'questions' | 'answerRelease'> = {
  title: 'A Trip to the Science Museum',
  source: '原创练习文章',
  answerRelease: 'after_submit',
  body: `Last Friday, Class 3 of Grade 9 visited the city science museum. The trip was planned by our English teacher, Ms. Wang, because we were learning a unit about inventions.

We met at the school gate at 8:30 and went there by bus. The ride took about forty minutes. When we arrived, a guide named Mr. Chen showed us around. He told us that the museum has more than 2,000 objects, but we only had time to see three halls.

The most popular hall was the one about robots. A small robot could answer questions in both Chinese and English. My friend Tom asked it, "What is your favourite food?" The robot answered, "I don't eat, but I love electricity!" Everyone laughed.

In the space hall, we saw a model of China's space station. Mr. Chen explained how astronauts sleep, eat and exercise in space. I was surprised to learn that they have to tie themselves to the wall when they sleep.

Before we left, Ms. Wang asked each of us to write down one invention we would like to create. I wrote "a pen that corrects spelling mistakes". We returned to school at three in the afternoon, tired but happy.`,
  questions: [
    {
      id: 'q1',
      type: 'choice',
      prompt: 'Why did Ms. Wang plan the trip?',
      options: [
        'Because the museum was free on Friday.',
        'Because the students were learning about inventions.',
        'Because Tom wanted to see the robots.',
        'Because the class won a science competition.',
      ],
      answer: 'Because the students were learning about inventions.',
      explanation: '第一段：because we were learning a unit about inventions。其他选项原文都没有提到。',
      tag: '细节理解',
    },
    {
      id: 'q2',
      type: 'choice',
      prompt: 'How did the students get to the museum?',
      options: ['On foot.', 'By subway.', 'By bus.', 'By bike.'],
      answer: 'By bus.',
      explanation: '第二段：We met at the school gate at 8:30 and went there by bus。',
      tag: '细节理解',
    },
    {
      id: 'q3',
      type: 'choice',
      prompt: 'Why did everyone laugh in the robot hall?',
      options: [
        'Tom asked the question in Chinese.',
        'The robot broke down suddenly.',
        'Mr. Chen told them a joke.',
        'The robot gave a funny answer.',
      ],
      answer: 'The robot gave a funny answer.',
      explanation: '第三段：机器人回答 “I don\'t eat, but I love electricity!” 之后 Everyone laughed，可推断是回答有趣。A 原文没说用中文提问；B、C 原文没有依据。',
      tag: '推理判断',
    },
    {
      id: 'q4',
      type: 'choice',
      prompt: 'What is the passage mainly about?',
      options: [
        'How robots learn different languages.',
        'A class trip to a science museum.',
        "Life on China's space station.",
        "Ms. Wang's favourite inventions.",
      ],
      answer: 'A class trip to a science museum.',
      explanation: '全文按时间顺序记叙了一次去科技馆的班级出行。A、C 只是其中的细节，D 原文没有提到。',
      tag: '主旨大意',
    },
  ],
};

const LETTER: typeof MUSEUM = {
  title: 'A Letter to Lucy（语篇填空）',
  source: '原创练习文章',
  answerRelease: 'after_submit',
  body: `阅读短文，在空白处填入一个适当的词，或填入括号中单词的正确形式。

Dear Lucy,

How are you? I am writing to tell you about my new school life. This term I (1)______ (start) to live at school from Monday to Friday. At first I felt a little lonely, but now I am getting (2)______ (use) to it.

My roommates are all very friendly. One of (3)______ is from Hainan, and she often tells us interesting stories about the sea. Every evening we study together in the library (4)______ 9 o'clock. On weekends I go home and help my mother cook. I think living at school makes me more (5)______ (independence).

Please write back and tell me about your school.

Yours,
Li Hua`,
  questions: [
    { id: 'q1', type: 'blank', prompt: '(1) start', answer: 'started|have started', explanation: 'This term 表示本学期已经开始的事，用一般过去时 started 或现在完成时 have started。', tag: '动词时态' },
    { id: 'q2', type: 'blank', prompt: '(2) use', answer: 'used', explanation: 'get used to sth. 意为“逐渐习惯于”，这里 used 是形容词，不能写 using。', tag: '固定搭配' },
    { id: 'q3', type: 'blank', prompt: '(3)', answer: 'them', explanation: 'one of 后接宾格代词，指代前面的 roommates，用 them。', tag: '代词' },
    { id: 'q4', type: 'blank', prompt: '(4)', answer: 'until|till', explanation: '一直学习到 9 点，表示动作持续到某一时间点，用 until / till。', tag: '介词' },
    { id: 'q5', type: 'blank', prompt: '(5) independence', answer: 'independent', explanation: 'make sb. + 形容词，more 后接形容词，independence 的形容词是 independent。', tag: '词性转换' },
  ],
};

const RUNNING: typeof MUSEUM = {
  title: 'Why I Started Running',
  source: '原创练习文章',
  answerRelease: 'after_grading',
  body: `Two years ago, I could not run 800 metres without stopping. I always came last in PE class, and some classmates laughed at me. I felt so embarrassed that I wanted to give up sports completely.

Then my uncle, who runs marathons, gave me some advice. "Don't compare yourself with others," he said. "Just try to be a little better than yesterday." He also helped me make a simple plan: run for ten minutes every morning and add one minute each week.

The first month was really hard. My legs hurt and I often wanted to stay in bed. But I wrote down every run in a notebook, and seeing the list grow made me proud. Slowly, running became easier.

Last month, I finished the 800-metre test in 3 minutes and 40 seconds. It was not the fastest in my class, but it was my best ever. Now running is not a task for me. It is the most relaxing part of my day.`,
  questions: [
    {
      id: 'q1',
      type: 'choice',
      prompt: 'How did the writer feel about sports two years ago?',
      options: ['Excited and confident.', 'Embarrassed and wanted to give up.', 'Bored but patient.', 'Angry with the PE teacher.'],
      answer: 'Embarrassed and wanted to give up.',
      explanation: '第一段：I felt so embarrassed that I wanted to give up sports completely。',
      tag: '细节理解',
    },
    {
      id: 'q2',
      type: 'choice',
      prompt: "What was the uncle's advice mainly about?",
      options: ['Running faster than classmates.', 'Joining a marathon team.', "Focusing on one's own progress.", 'Eating healthy food before running.'],
      answer: "Focusing on one's own progress.",
      explanation: '叔叔说 Don\'t compare yourself with others … be a little better than yesterday，重点是关注自己的进步。A 恰好与“不要和别人比”相反。',
      tag: '推理判断',
    },
    {
      id: 'q3',
      type: 'blank',
      prompt: 'The writer added ______ minute(s) to the morning run each week.（填数字或英文单词）',
      answer: '1|one',
      explanation: '第二段：add one minute each week。',
      tag: '细节理解',
    },
    {
      id: 'q4',
      type: 'text',
      prompt: '用英语回答（1–2 句）：What helped the writer keep running?',
      answer: "The uncle's advice and simple plan helped. Writing down every run in a notebook also made the writer feel proud.",
      explanation: '要点：① 叔叔的建议 / 计划；② 记录每次跑步带来成就感。答出两点、句子正确得满分。',
      tag: '英语表达',
      points: 2,
    },
  ],
};

const ROBOTS_DRAFT = {
  title: 'Robots in Our Daily Life',
  source: '原创练习文章（草稿，可用于体验 AI 出题）',
  body: `Robots are no longer only in science fiction films. Today, they are becoming part of our daily life. In some restaurants, robots carry food to the tables. In hospitals, they help doctors with difficult operations. Some families even have small robots that clean the floor while people are at work.

Many people think robots will make life easier. They can do boring or dangerous jobs, so humans have more time for creative work. However, some people worry that robots will take away jobs from workers. They also wonder whether children will spend less time talking with real people.

Scientists say the key is to use robots wisely. Robots are good at repeating tasks quickly and correctly, but they are not good at understanding feelings. Teachers, doctors and artists will still be needed in the future. Maybe the best future is one where robots and humans work together.`,
};

function snapshotOf(id: string, m: typeof MUSEUM): MaterialSnapshot {
  return { materialId: id, kind: 'reading', title: m.title, source: m.source, body: m.body, questions: m.questions as Question[], answerRelease: m.answerRelease };
}

export async function seedDemo(db: Db, today: string): Promise<void> {
  const exists = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users');
  if ((exists?.n ?? 0) > 0) return;
  const pw = await hashPassword('demo123');
  const created = new Date(Date.now() - 7 * 86400_000).toISOString();
  const teacherId = newId('u_');
  const lihua = newId('u_');
  const xiaoming = newId('u_');
  db.run(`INSERT INTO users VALUES (?, 'teacher', 'teacher', '王老师', ?, 1, ?)`, [teacherId, pw, created]);
  db.run(`INSERT INTO users VALUES (?, 'student', 'lihua', '李华', ?, 1, ?)`, [lihua, pw, created]);
  db.run(`INSERT INTO users VALUES (?, 'student', 'xiaoming', '王小明', ?, 1, ?)`, [xiaoming, pw, created]);

  const mats: [string, typeof MUSEUM][] = [
    [newId('m_'), MUSEUM],
    [newId('m_'), LETTER],
    [newId('m_'), RUNNING],
  ];
  for (const [id, m] of mats) {
    db.run(
      `INSERT INTO materials(id, kind, title, source, body, questions, status, answer_release, created_at, updated_at, published_at)
       VALUES (?, 'reading', ?, ?, ?, ?, 'published', ?, ?, ?, ?)`,
      [id, m.title, m.source, m.body, JSON.stringify(m.questions), m.answerRelease, created, created, created],
    );
  }
  db.run(
    `INSERT INTO materials(id, kind, title, source, body, questions, status, answer_release, created_at, updated_at, published_at)
     VALUES (?, 'reading', ?, ?, ?, '[]', 'draft', 'after_submit', ?, ?, NULL)`,
    [newId('m_'), ROBOTS_DRAFT.title, ROBOTS_DRAFT.source, ROBOTS_DRAFT.body, nowIso(), nowIso()],
  );

  const [[museumId, museum], [letterId, letter], [runningId, running]] = mats;
  const assign = (studentId: string, date: string, id: string, m: typeof MUSEUM) => {
    const aid = newId('a_');
    db.run('INSERT INTO assignments(id, student_id, material_id, date, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      aid,
      studentId,
      id,
      date,
      JSON.stringify(snapshotOf(id, m)),
      created,
    ]);
    return aid;
  };

  // 今天：科技馆阅读，未开始
  assign(lihua, today, museumId, museum);
  assign(xiaoming, today, museumId, museum);
  // 明天：已提前布置（学生端明天才能看到）
  assign(lihua, addDays(today, 1), runningId, running);

  // 昨天：语篇填空已提交，自动判分，老师留了反馈并要求订正
  const y = assign(lihua, addDays(today, -1), letterId, letter);
  const yTime = new Date(Date.now() - 20 * 3600_000).toISOString();
  const yGrade = new Date(Date.now() - 18 * 3600_000).toISOString();
  const yAnswers = { q1: 'started', q2: 'using', q3: 'them', q4: 'until', q5: 'independence' };
  db.run(
    `INSERT INTO submissions(assignment_id, status, draft, draft_saved_at, first_answers, first_submitted_at, teacher_comment,
       question_comments, correction_required, graded_at, feedback_at)
     VALUES (?, 'graded', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      y,
      JSON.stringify({ answers: yAnswers }),
      yTime,
      JSON.stringify(yAnswers),
      yTime,
      '整体不错！两处错误都和词形有关：get used to 里的 used 是形容词；more 后面要接形容词。订正时写一句中文说明你为什么选错。',
      JSON.stringify({ q2: '注意区分 be/get used to（习惯于）和 be used to do（被用来做）。' }),
      yGrade,
      yGrade,
    ],
  );

  // 前天：跑步阅读（含表达题），已提交，等待老师批改
  const d2 = assign(lihua, addDays(today, -2), runningId, running);
  const d2Time = new Date(Date.now() - 44 * 3600_000).toISOString();
  const d2Answers = {
    q1: 'Embarrassed and wanted to give up.',
    q2: 'Running faster than classmates.',
    q3: 'one',
    q4: 'His uncle advice and he write down every run in notebook, it make him proud.',
  };
  db.run(
    `INSERT INTO submissions(assignment_id, status, draft, draft_saved_at, first_answers, first_submitted_at)
     VALUES (?, 'submitted', ?, ?, ?, ?)`,
    [d2, JSON.stringify({ answers: d2Answers }), d2Time, JSON.stringify(d2Answers), d2Time],
  );

  setSetting(db, AI_KEY, { baseUrl: 'mock', model: 'demo-model', apiKey: '' });
}
