import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE = 'https://43-133-253-81.nip.io/yomiai-api';
const FONT_DB = 'nenei-yomiai-fonts';
const FONT_STORE = 'fonts';

type Page = 'home' | 'shelf' | 'reader' | 'notes' | 'toc' | 'settings';
type ShelfStatus = '想读' | '正在读' | '已读';

type Person = {
  key: 'elior' | 'nenei';
  name: string;
  avatar: string;
};

type Book = {
  id: string;
  title: string;
  author: string;
  status: ShelfStatus;
  progress: number;
  coverDataUrl?: string;
  chapterCount: number;
};

type Chapter = {
  bookId: string;
  chapterIndex: number;
  title: string;
  html: string;
  text: string;
  paragraphs: string[];
};

type Annotation = {
  id: string;
  bookId: string;
  chapterIndex: number;
  paragraphIndex?: number;
  quote?: string;
  text: string;
  author: 'ai' | 'nenei';
  createdAt: string;
};

type StoredFont = {
  id: string;
  name: string;
  family: string;
  blob: Blob;
};

const accentPresets = [
  ['墨黑', '#111111'],
  ['旧金', '#9b7b36'],
  ['雾蓝', '#64748b'],
  ['苹果', '#6f8f55'],
  ['玫瑰灰', '#9f7b7b'],
] as const;

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), options);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function openFontDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FONT_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(FONT_STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadFonts() {
  const db = await openFontDb();
  return new Promise<StoredFont[]>((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readonly');
    const request = tx.objectStore(FONT_STORE).getAll();
    request.onsuccess = () => resolve(request.result as StoredFont[]);
    request.onerror = () => reject(request.error);
  });
}

async function saveFont(font: StoredFont) {
  const db = await openFontDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readwrite');
    tx.objectStore(FONT_STORE).put(font);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function installFont(font: StoredFont) {
  const face = new FontFace(font.family, `url(${URL.createObjectURL(font.blob)})`);
  const loaded = await face.load();
  document.fonts.add(loaded);
}

function Cover({ book, kind = 'botanical' }: { book?: Book; kind?: string }) {
  if (book?.coverDataUrl) {
    return <img className='cover cover-image' src={book.coverDataUrl} alt={book.title} />;
  }
  return <div className={'cover cover-' + kind} aria-hidden><span /></div>;
}

function Avatar({ person, muted = false }: { person: Person; muted?: boolean }) {
  if (person.avatar) {
    return <img className={'avatar ' + (muted ? 'muted' : '')} src={person.avatar} alt={person.name} />;
  }
  return <span className={'avatar avatar-letter ' + (muted ? 'muted' : '')}>{initials(person.name)}</span>;
}

function Header({ setPage, elior, nenei }: { setPage: (page: Page) => void; elior: Person; nenei: Person }) {
  return (
    <header className='topbar'>
      <button className='brand' onClick={() => setPage('home')} aria-label='回到首页'>nenei-yomiai</button>
      <div className='identity-mini'>
        <Avatar person={elior} />
        <Avatar person={nenei} muted />
        <button className='gear' onClick={() => setPage('settings')} aria-label='设置'>☰</button>
      </div>
    </header>
  );
}

function HomePage({ setPage, book }: { setPage: (page: Page) => void; book?: Book }) {
  return (
    <main className='screen home-screen'>
      <section className='hero-card'>
        <Cover book={book} />
        <div className='hero-copy'>
          <p className='eyebrow'>正在读</p>
          <h1>{book?.title || '还没有书'}</h1>
          <p>{book?.author || '从书架导入一本 epub'}</p>
          <div className='progress'><span style={{ width: `${book?.progress || 0}%` }} /></div>
          <small>已读 {book?.progress || 0}%</small>
        </div>
      </section>
      <div className='quick-actions'>
        <button onClick={() => setPage('toc')}>目录</button>
        <button onClick={() => setPage('notes')}>页边</button>
      </div>
      <section className='section-block'>
        <h2>最近的页边</h2>
        <p className='empty-copy'>批注会从 VPS 同步到这里。</p>
      </section>
    </main>
  );
}

function ShelfPage({ books, selectedBookId, onSelectBook, onImport, importing }: {
  books: Book[];
  selectedBookId?: string;
  onSelectBook: (bookId: string) => void;
  onImport: (file: File) => void;
  importing: boolean;
}) {
  const [status, setStatus] = useState<ShelfStatus>('正在读');
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = books.filter((book) => book.status === status);

  return (
    <main className='screen shelf-screen'>
      <div className='screen-title inline'>
        <div>
          <h1>书架</h1>
          <p>想读 · 正在读 · 已读</p>
        </div>
        <button className='text-button' onClick={() => inputRef.current?.click()} disabled={importing}>
          {importing ? '导入中' : '导入'}
        </button>
        <input
          ref={inputRef}
          className='hidden-input'
          type='file'
          accept='.epub,application/epub+zip'
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.currentTarget.value = '';
          }}
        />
      </div>
      <div className='status-tabs'>
        {(['想读', '正在读', '已读'] as ShelfStatus[]).map((item) => (
          <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item}</button>
        ))}
      </div>
      <section className='book-list'>
        {filtered.map((book) => (
          <button className={'book-row ' + (book.id === selectedBookId ? 'selected' : '')} key={book.id} onClick={() => onSelectBook(book.id)}>
            <Cover book={book} />
            <div>
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              <small>{book.status} · {book.chapterCount} 章{book.progress ? ` · 已读 ${book.progress}%` : ''}</small>
              <div className='mini-progress'><span style={{ width: `${book.progress}%` }} /></div>
            </div>
          </button>
        ))}
        {!filtered.length && <p className='empty-copy'>这里还没有书。</p>}
      </section>
    </main>
  );
}

function ReaderPage({ book, chapter, chapterIndex, setChapterIndex, selectedFont, paragraphIndex, setParagraphIndex }: {
  book?: Book;
  chapter?: Chapter;
  chapterIndex: number;
  setChapterIndex: (index: number) => void;
  selectedFont: string;
  paragraphIndex?: number;
  setParagraphIndex: (index: number) => void;
}) {
  if (!book) {
    return <main className='screen reader-screen'><p className='empty-copy'>先去书架导入一本书。</p></main>;
  }

  return (
    <main className='screen reader-screen'>
      <div className='reader-top'>
        <button disabled={chapterIndex <= 1} onClick={() => setChapterIndex(chapterIndex - 1)}>‹</button>
        <div>
          <button>{chapterIndex} / {book.chapterCount}</button>
          <button disabled={chapterIndex >= book.chapterCount} onClick={() => setChapterIndex(chapterIndex + 1)}>›</button>
        </div>
      </div>
      <article className='reading-paper' style={selectedFont ? { fontFamily: selectedFont } : undefined}>
        <p className='chapter'>第 {chapterIndex} 章</p>
        <h1>{chapter?.title || book.title}</h1>
        <div className='ornament'>✦</div>
        {(chapter?.paragraphs || []).map((text, index) => (
          <p key={`${chapterIndex}-${index}`} className={index === paragraphIndex ? 'with-note' : ''} onClick={() => setParagraphIndex(index)}>
            {text}
          </p>
        ))}
      </article>
      <div className='reader-progress'>
        <span>{book.progress}%</span>
        <div><span style={{ width: `${book.progress}%` }} /></div>
        <span>{chapter?.title || '读取中'}</span>
      </div>
    </main>
  );
}

function NotesPage({ book, annotations }: { book?: Book; annotations: Annotation[] }) {
  return (
    <main className='screen notes-screen'>
      <div className='screen-title inline'>
        <div>
          <h1>页边</h1>
          <p>{book ? book.title : '未选择书本'}</p>
        </div>
        <button className='text-button'>筛选</button>
      </div>
      {annotations.map((annotation) => (
        <article className='note-card' key={annotation.id}>
          <div className='note-head'>
            <span className='avatar avatar-letter'>{annotation.author === 'ai' ? 'E' : 'N'}</span>
            <strong>{annotation.author === 'ai' ? 'Elior:' : 'Nenei:'}</strong>
            <span>“</span>
          </div>
          <p>{annotation.text}</p>
          <footer>
            <small>第 {annotation.chapterIndex} 章{annotation.paragraphIndex != null ? ` · 段 ${annotation.paragraphIndex + 1}` : ''}</small>
            <small>{new Date(annotation.createdAt).toLocaleString()}</small>
            <button>…</button>
          </footer>
        </article>
      ))}
      {!annotations.length && <p className='empty-copy'>还没有批注。之后我/GPT 会通过 MCP 写到这里。</p>}
    </main>
  );
}

function TocPage({ book, chapters, chapterIndex, setChapterIndex, setPage }: {
  book?: Book;
  chapters: Pick<Chapter, 'chapterIndex' | 'title' | 'paragraphs'>[];
  chapterIndex: number;
  setChapterIndex: (index: number) => void;
  setPage: (page: Page) => void;
}) {
  return (
    <main className='screen toc-screen'>
      <div className='screen-title'>
        <h1>目录</h1>
        <p>{book ? `${book.title} · 已读 ${book.progress}%` : '未选择书本'}</p>
      </div>
      <div className='toc-progress'><span style={{ width: `${book?.progress || 0}%` }} /></div>
      <section className='chapter-list'>
        {chapters.map((chapter) => (
          <button key={chapter.chapterIndex} className={chapter.chapterIndex === chapterIndex ? 'current' : ''} onClick={() => {
            setChapterIndex(chapter.chapterIndex);
            setPage('reader');
          }}>
            <span>第 {chapter.chapterIndex} 章</span>
            <strong>{chapter.title}</strong>
            <small>{chapter.paragraphs.length} 段</small>
          </button>
        ))}
      </section>
    </main>
  );
}

function SettingsPage({ elior, nenei, setElior, setNenei, accent, setAccent, fonts, selectedFont, setSelectedFont, onImportFont }: {
  elior: Person;
  nenei: Person;
  setElior: (person: Person) => void;
  setNenei: (person: Person) => void;
  accent: string;
  setAccent: (value: string) => void;
  fonts: StoredFont[];
  selectedFont: string;
  setSelectedFont: (value: string) => void;
  onImportFont: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
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
            <button key={value} className={accent === value ? 'active' : ''} style={{ '--swatch': value } as React.CSSProperties} onClick={() => setAccent(value)}>
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
      <section className='settings-card'>
        <div className='settings-head'>
          <h2>本地字体</h2>
          <button className='text-button' onClick={() => inputRef.current?.click()}>导入</button>
        </div>
        <input
          ref={inputRef}
          className='hidden-input'
          type='file'
          accept='.ttf,.otf,.woff,.woff2,font/*'
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportFont(file);
            event.currentTarget.value = '';
          }}
        />
        <label className='field'>
          <span>阅读字体</span>
          <select value={selectedFont} onChange={(event) => setSelectedFont(event.target.value)}>
            <option value=''>默认宋体</option>
            {fonts.map((font) => <option value={font.family} key={font.id}>{font.name}</option>)}
          </select>
        </label>
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
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookId, setSelectedBookId] = useState(localStorage.getItem('nenei-yomiai-book') || '');
  const [chapterIndex, setChapterIndex] = useState(Number(localStorage.getItem('nenei-yomiai-chapter') || '1'));
  const [paragraphIndex, setParagraphIndex] = useState<number | undefined>(undefined);
  const [chapter, setChapter] = useState<Chapter>();
  const [chapters, setChapters] = useState<Pick<Chapter, 'chapterIndex' | 'title' | 'paragraphs'>[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [importing, setImporting] = useState(false);
  const [fonts, setFonts] = useState<StoredFont[]>([]);
  const [selectedFont, setSelectedFontState] = useState(localStorage.getItem('nenei-yomiai-font') || '');

  const selectedBook = books.find((book) => book.id === selectedBookId) || books[0];
  const style = useMemo(() => ({ '--accent': accent } as React.CSSProperties), [accent]);

  const setSelectedFont = (value: string) => {
    setSelectedFontState(value);
    localStorage.setItem('nenei-yomiai-font', value);
  };

  const refreshBooks = async () => {
    const data = await api<{ ok: boolean; books: Book[] }>('/books');
    setBooks(data.books);
    if (!selectedBookId && data.books[0]) {
      setSelectedBookId(data.books[0].id);
      localStorage.setItem('nenei-yomiai-book', data.books[0].id);
    }
  };

  useEffect(() => {
    refreshBooks().catch(console.error);
    loadFonts().then(async (items) => {
      setFonts(items);
      await Promise.all(items.map(installFont));
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedBook) return;
    setSelectedBookId(selectedBook.id);
    localStorage.setItem('nenei-yomiai-book', selectedBook.id);
    api<{ ok: boolean; progress: { chapterIndex: number; paragraphIndex?: number }[] }>(`/progress?bookId=${selectedBook.id}`)
      .then((data) => {
        const current = data.progress[0];
        if (current) {
          setChapterIndex(current.chapterIndex);
          setParagraphIndex(current.paragraphIndex);
        }
      })
      .catch(console.error);
    api<{ ok: boolean; chapters: Pick<Chapter, 'chapterIndex' | 'title' | 'paragraphs'>[] }>(`/books/${selectedBook.id}/chapters?from=1&to=${selectedBook.chapterCount}`)
      .then((data) => setChapters(data.chapters))
      .catch(console.error);
  }, [selectedBook?.id]);

  useEffect(() => {
    if (!selectedBook) return;
    localStorage.setItem('nenei-yomiai-chapter', String(chapterIndex));
    api<{ ok: boolean; chapter: Chapter }>(`/books/${selectedBook.id}/chapters/${chapterIndex}`)
      .then((data) => setChapter(data.chapter))
      .catch(console.error);
    api<{ ok: boolean; annotations: Annotation[] }>(`/books/${selectedBook.id}/annotations?chapterIndex=${chapterIndex}`)
      .then((data) => setAnnotations(data.annotations))
      .catch(console.error);
  }, [selectedBook?.id, chapterIndex]);

  useEffect(() => {
    if (!selectedBook) return;
    const percent = selectedBook.chapterCount ? Math.min(100, Math.max(0, Math.round((chapterIndex / selectedBook.chapterCount) * 100))) : 0;
    api('/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: selectedBook.id, chapterIndex, paragraphIndex, percent }),
    }).then(refreshBooks).catch(console.error);
  }, [selectedBook?.id, chapterIndex, paragraphIndex]);

  const importBook = async (file: File) => {
    setImporting(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const data = await api<{ ok: boolean; book: Book }>('/books', { method: 'POST', body });
      await refreshBooks();
      setSelectedBookId(data.book.id);
      setChapterIndex(1);
      setPage('reader');
    } finally {
      setImporting(false);
    }
  };

  const importFont = async (file: File) => {
    const family = `YomiaiLocal-${Date.now()}`;
    const font: StoredFont = { id: family, name: file.name.replace(/\.(ttf|otf|woff2?|)$/i, ''), family, blob: file };
    await saveFont(font);
    await installFont(font);
    setFonts(await loadFonts());
    setSelectedFont(family);
  };

  return (
    <div className='app-shell' style={style}>
      <div className='phone-frame'>
        <Header setPage={setPage} elior={elior} nenei={nenei} />
        {page === 'home' && <HomePage setPage={setPage} book={selectedBook} />}
        {page === 'shelf' && <ShelfPage books={books} selectedBookId={selectedBook?.id} onSelectBook={(id) => {
          setSelectedBookId(id);
          setChapterIndex(1);
          setPage('reader');
        }} onImport={importBook} importing={importing} />}
        {page === 'reader' && <ReaderPage book={selectedBook} chapter={chapter} chapterIndex={chapterIndex} setChapterIndex={setChapterIndex} selectedFont={selectedFont} paragraphIndex={paragraphIndex} setParagraphIndex={setParagraphIndex} />}
        {page === 'notes' && <NotesPage book={selectedBook} annotations={annotations} />}
        {page === 'toc' && <TocPage book={selectedBook} chapters={chapters} chapterIndex={chapterIndex} setChapterIndex={setChapterIndex} setPage={setPage} />}
        {page === 'settings' && <SettingsPage elior={elior} nenei={nenei} setElior={setElior} setNenei={setNenei} accent={accent} setAccent={setAccent} fonts={fonts} selectedFont={selectedFont} setSelectedFont={setSelectedFont} onImportFont={importFont} />}
        <BottomNav page={page} setPage={setPage} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
