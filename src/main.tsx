import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Page = 'home' | 'shelf' | 'reader' | 'notes' | 'toc' | 'settings';
type ShelfStatus = '想读' | '正在读' | '已读';

type Person = {
  key: 'elior' | 'nenei';
  name: string;
  avatar: string;
};

type Book = {
  title: string;
  author: string;
  status: ShelfStatus;
  progress: number;
  cover: string;
};

const accentPresets = [
  ['墨黑', '#111111'],
  ['旧金', '#9b7b36'],
  ['雾蓝', '#64748b'],
  ['苹果', '#6f8f55'],
  ['玫瑰灰', '#9f7b7b'],
] as const;

const books: Book[] = [
  { title: '苹果味的风', author: '第四章', status: '正在读', progress: 42, cover: 'botanical' },
  { title: '山间来信', author: '安妮宝贝', status: '想读', progress: 0, cover: 'mist' },
  { title: '岁月的岸', author: '渡边淳一', status: '想读', progress: 0, cover: 'cloud' },
  { title: '海边的房间', author: '黄守宏', status: '已读', progress: 100, cover: 'sea' },
];

const chapters = [
  ['第一章', '初遇', '已读'],
  ['第二章', '那年的夏天', '已读'],
  ['第三章', '风的来信', '已读'],
  ['第四章', '苹果味的风', '正在读'],
  ['第五章', '静默的下午', '未读'],
  ['第六章', '再见之前', '未读'],
];

const bodyText = [
  '风里有一颗青苹果的味道。',
  '那是从院子那棵老苹果树上吹来的风，带着一点酸，又带着一点甜。',
  '小时候我总以为，风是会记住味道的。它走过的地方，都会留下瞬间的气息。',
  '那天傍晚，阳光很软，我们坐在台阶上，谁也没有说话。',
  '风从树梢经过，苹果落地，发出轻轻的一声。',
  '我忽然觉得，时间也有味道。它不是苦的，也不是甜的，而是一种熟悉的安心。',
];

function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function Cover({ kind }: { kind: string }) {
  return <div className={'cover cover-' + kind} aria-hidden><span /></div>;
}

function Avatar({ person, muted = false }: { person: Person; muted?: boolean }) {
  if (person.avatar) {
    return <img className={'avatar ' + (muted ? 'muted' : '')} src={person.avatar} alt={person.name} />;
  }
  return <span className={'avatar avatar-letter ' + (muted ? 'muted' : '')}>{initials(person.name)}</span>;
}

function Header({ page, setPage, elior, nenei }: { page: Page; setPage: (page: Page) => void; elior: Person; nenei: Person }) {
  const tabs: { label: string; page: Page }[] = [
    { label: '首页', page: 'home' },
    { label: '书架', page: 'shelf' },
    { label: '阅读', page: 'reader' },
    { label: '页边', page: 'notes' },
  ];

  return (
    <header className='topbar'>
      <div>
        <button className='brand' onClick={() => setPage('home')} aria-label='回到首页'>nenei-yomiai</button>
        <nav className='tabs' aria-label='主导航'>
          {tabs.map((tab) => (
            <button key={tab.page} className={page === tab.page ? 'active' : ''} onClick={() => setPage(tab.page)}>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className='identity-mini'>
        <Avatar person={elior} />
        <Avatar person={nenei} muted />
        <button className='gear' onClick={() => setPage('settings')} aria-label='设置'>☰</button>
      </div>
    </header>
  );
}

function HomePage({ setPage, elior, nenei }: { setPage: (page: Page) => void; elior: Person; nenei: Person }) {
  return (
    <main className='screen home-screen'>
      <section className='hero-card'>
        <Cover kind='botanical' />
        <div className='hero-copy'>
          <p className='eyebrow'>正在读</p>
          <h1>苹果味的风</h1>
          <p>第四章</p>
          <div className='progress'><span style={{ width: '42%' }} /></div>
          <small>已读 42%</small>
        </div>
      </section>
      <div className='quick-actions'>
        <button onClick={() => setPage('toc')}>目录</button>
        <button onClick={() => setPage('notes')}>页边</button>
      </div>
      <section className='section-block'>
        <h2>最近的页边</h2>
        <NotePreview person={elior} text='这段的风像小时候院子里的味道。' />
        <NotePreview person={nenei} text='是啊，带着一点青苹果的酸。' />
      </section>
    </main>
  );
}

function NotePreview({ person, text }: { person: Person; text: string }) {
  return (
    <article className='note-preview'>
      <Avatar person={person} />
      <div>
        <strong>{person.name}:</strong>
        <p>{text}</p>
        <small>p.72 · 第四章</small>
      </div>
      <span className='arrow'>›</span>
    </article>
  );
}

function ShelfPage() {
  const [status, setStatus] = useState<ShelfStatus>('正在读');
  const filtered = books.filter((book) => book.status === status);

  return (
    <main className='screen shelf-screen'>
      <div className='screen-title'>
        <h1>书架</h1>
        <p>想读 · 正在读 · 已读</p>
      </div>
      <div className='status-tabs'>
        {(['想读', '正在读', '已读'] as ShelfStatus[]).map((item) => (
          <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item}</button>
        ))}
      </div>
      <section className='book-list'>
        {filtered.map((book) => (
          <article className='book-row' key={book.title}>
            <Cover kind={book.cover} />
            <div>
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              <small>{book.status}{book.progress ? ` · 已读 ${book.progress}%` : ''}</small>
              {book.progress > 0 && <div className='mini-progress'><span style={{ width: `${book.progress}%` }} /></div>}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function ReaderPage({ setPage }: { setPage: (page: Page) => void }) {
  return (
    <main className='screen reader-screen'>
      <div className='reader-top'>
        <button onClick={() => setPage('home')}>‹</button>
        <div>
          <button>Aa</button>
          <button>…</button>
        </div>
      </div>
      <article className='reading-paper'>
        <p className='chapter'>第四章</p>
        <h1>苹果味的风</h1>
        <div className='ornament'>✦</div>
        {bodyText.map((text, index) => (
          <p key={text} className={index === 1 ? 'with-note' : ''}>{text}</p>
        ))}
      </article>
      <div className='reader-progress'>
        <span>42%</span>
        <div><span /></div>
        <span>第72页 / 共168页</span>
      </div>
    </main>
  );
}

function NotesPage({ elior, nenei }: { elior: Person; nenei: Person }) {
  return (
    <main className='screen notes-screen'>
      <div className='screen-title inline'>
        <div>
          <h1>页边</h1>
          <p>苹果味的风 · 第四章</p>
        </div>
        <button className='text-button'>筛选</button>
      </div>
      <NoteCard person={elior} text='这段的风像小时候院子里的味道。' time='2026/06/08 18:32' />
      <NoteCard person={nenei} text='是啊，带着一点青苹果的酸。' time='2026/06/08 18:47' />
      <button className='primary-button'>＋ 添加批注</button>
    </main>
  );
}

function NoteCard({ person, text, time }: { person: Person; text: string; time: string }) {
  return (
    <article className='note-card'>
      <div className='note-head'>
        <Avatar person={person} />
        <strong>{person.name}:</strong>
        <span>“</span>
      </div>
      <p>{text}</p>
      <footer>
        <small>p.72</small>
        <small>{time}</small>
        <button>…</button>
      </footer>
    </article>
  );
}

function TocPage() {
  return (
    <main className='screen toc-screen'>
      <div className='screen-title'>
        <h1>目录</h1>
        <p>苹果味的风 · 已读 42%</p>
      </div>
      <div className='toc-progress'><span /></div>
      <section className='chapter-list'>
        {chapters.map(([no, title, state]) => (
          <article key={no} className={state === '正在读' ? 'current' : ''}>
            <span>{no}</span>
            <strong>{title}</strong>
            <small>{state}</small>
          </article>
        ))}
      </section>
    </main>
  );
}

function SettingsPage({ elior, nenei, setElior, setNenei, accent, setAccent }: {
  elior: Person;
  nenei: Person;
  setElior: (person: Person) => void;
  setNenei: (person: Person) => void;
  accent: string;
  setAccent: (value: string) => void;
}) {
  const updatePerson = (person: Person, setter: (person: Person) => void, patch: Partial<Person>) => setter({ ...person, ...patch });

  return (
    <main className='screen settings-screen'>
      <div className='screen-title centered'>
        <h1>设置</h1>
        <p>我们</p>
      </div>
      <section className='pair-card'>
        <Avatar person={elior} />
        <span>×</span>
        <Avatar person={nenei} muted />
      </section>
      <PersonEditor label='Elior' person={elior} onChange={(patch) => updatePerson(elior, setElior, patch)} />
      <PersonEditor label='Nenei' person={nenei} onChange={(patch) => updatePerson(nenei, setNenei, patch)} />
      <section className='settings-card'>
        <h2>主题色</h2>
        <div className='accent-row'>
          {accentPresets.map(([name, value]) => (
            <button
              key={value}
              className={accent === value ? 'active' : ''}
              style={{ '--swatch': value } as React.CSSProperties}
              onClick={() => setAccent(value)}
            >
              <span />{name}
            </button>
          ))}
        </div>
        <label className='field color-field'>
          <span>自定义</span>
          <input type='color' value={accent} onChange={(event) => setAccent(event.target.value)} />
          <code>{accent}</code>
        </label>
      </section>
      <section className='settings-card compact'>
        <div><span>字体大小</span><strong>中</strong></div>
        <div><span>行间距</span><strong>舒适</strong></div>
        <div><span>夜间模式</span><strong>关</strong></div>
      </section>
    </main>
  );
}

function PersonEditor({ label, person, onChange }: { label: string; person: Person; onChange: (patch: Partial<Person>) => void }) {
  return (
    <section className='settings-card person-editor'>
      <h2>{label}</h2>
      <label className='field'>
        <span>名字</span>
        <input value={person.name} onChange={(event) => onChange({ name: event.target.value })} />
      </label>
      <label className='field'>
        <span>头像链接</span>
        <input placeholder='https://...' value={person.avatar} onChange={(event) => onChange({ avatar: event.target.value })} />
      </label>
    </section>
  );
}

function BottomNav({ page, setPage }: { page: Page; setPage: (page: Page) => void }) {
  const nav: { page: Page; label: string; icon: string }[] = [
    { page: 'home', label: '首页', icon: '⌂' },
    { page: 'shelf', label: '书架', icon: '▥' },
    { page: 'notes', label: '页边', icon: '✎' },
    { page: 'settings', label: '设置', icon: '☰' },
  ];

  return (
    <nav className='bottom-nav'>
      {nav.map((item) => (
        <button key={item.page} className={page === item.page ? 'active' : ''} onClick={() => setPage(item.page)}>
          <span className='nav-icon'>{item.icon}</span>{item.label}
        </button>
      ))}
    </nav>
  );
}

function App() {
  const [page, setPage] = useState<Page>('home');
  const [accent, setAccent] = useState('#111111');
  const [elior, setElior] = useState<Person>({ key: 'elior', name: 'Elior', avatar: '' });
  const [nenei, setNenei] = useState<Person>({ key: 'nenei', name: 'Nenei', avatar: '' });
  const style = useMemo(() => ({ '--accent': accent } as React.CSSProperties), [accent]);

  return (
    <div className='app-shell' style={style}>
      <div className='phone-frame'>
        <Header page={page} setPage={setPage} elior={elior} nenei={nenei} />
        {page === 'home' && <HomePage setPage={setPage} elior={elior} nenei={nenei} />}
        {page === 'shelf' && <ShelfPage />}
        {page === 'reader' && <ReaderPage setPage={setPage} />}
        {page === 'notes' && <NotesPage elior={elior} nenei={nenei} />}
        {page === 'toc' && <TocPage />}
        {page === 'settings' && <SettingsPage elior={elior} nenei={nenei} setElior={setElior} setNenei={setNenei} accent={accent} setAccent={setAccent} />}
        <BottomNav page={page} setPage={setPage} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
