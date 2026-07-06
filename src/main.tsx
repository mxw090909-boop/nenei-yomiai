import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE = 'https://43-133-253-81.nip.io/yomiai-api';
const FONT_DB = 'nenei-yomiai-fonts';
const FONT_STORE = 'fonts';
const APPEARANCE_DB = 'nenei-yomiai-appearance';
const APPEARANCE_STORE = 'kv';
const PERSON_AVATAR_KEYS = {
  elior: 'nenei-yomiai-elior-avatar',
  nenei: 'nenei-yomiai-nenei-avatar',
} as const;

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

type LocalProgress = {
  chapterIndex: number;
  paragraphIndex?: number;
  percent: number;
  updatedAt: number;
};

type StoredFont = {
  id: string;
  name: string;
  family: string;
  blob: Blob;
};

type ChapterSummary = Pick<Chapter, 'chapterIndex' | 'title' | 'paragraphs'>;

type DisplayChapter = ChapterSummary & {
  displayLabel: string;
  hiddenFromToc: boolean;
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

function progressStorageKey(bookId: string) {
  return `nenei-yomiai-progress-${bookId}`;
}

function loadLocalProgress(bookId: string): LocalProgress | undefined {
  try {
    const raw = localStorage.getItem(progressStorageKey(bookId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<LocalProgress>;
    if (!parsed.chapterIndex || !Number.isFinite(parsed.chapterIndex)) return undefined;
    return {
      chapterIndex: Math.max(1, Math.round(parsed.chapterIndex)),
      paragraphIndex: typeof parsed.paragraphIndex === 'number' ? parsed.paragraphIndex : undefined,
      percent: typeof parsed.percent === 'number' ? Math.min(100, Math.max(0, Math.round(parsed.percent))) : 0,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return undefined;
  }
}

function saveLocalProgress(bookId: string, progress: LocalProgress) {
  localStorage.setItem(progressStorageKey(bookId), JSON.stringify(progress));
}

function calcProgressPercent(chapterIndex: number, chapterCount?: number) {
  if (!chapterCount) return 0;
  return Math.min(100, Math.max(0, Math.round((chapterIndex / chapterCount) * 100)));
}

const bodyChapterTitlePattern = /^第\s*[一二三四五六七八九十百千万零〇两\d]+\s*[章节回卷部]/;
const emptyGeneratedChapterPattern = /^第\s*\d+\s*章$/;

function normalizeChapterTitle(title: string) {
  return title.replace(/\s+/g, ' ').trim();
}

function getDisplayChapters(chapters: ChapterSummary[]): DisplayChapter[] {
  let bodyChapterCount = 0;

  return chapters.map((chapter) => {
    const title = normalizeChapterTitle(chapter.title);
    const hiddenFromToc = chapter.paragraphs.length === 0 && emptyGeneratedChapterPattern.test(title);

    if (!hiddenFromToc && bodyChapterTitlePattern.test(title)) {
      bodyChapterCount += 1;
      return { ...chapter, displayLabel: `第 ${bodyChapterCount} 章`, hiddenFromToc };
    }

    return {
      ...chapter,
      displayLabel: bodyChapterCount === 0 ? '前置' : '附录',
      hiddenFromToc,
    };
  });
}

function getReaderChapterLabel(chapter: Chapter | undefined, displayChapters: DisplayChapter[]) {
  if (!chapter) return '读取中';
  const title = normalizeChapterTitle(chapter.title);
  if (bodyChapterTitlePattern.test(title) && chapter.paragraphs.length > 0) return title;
  return displayChapters.find((item) => item.chapterIndex === chapter.chapterIndex)?.displayLabel || title;
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

function openAppearanceDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(APPEARANCE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(APPEARANCE_STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadAppearanceValue(key: string) {
  const db = await openAppearanceDb();
  return new Promise<string>((resolve, reject) => {
    const tx = db.transaction(APPEARANCE_STORE, 'readonly');
    const request = tx.objectStore(APPEARANCE_STORE).get(key);
    request.onsuccess = () => resolve(typeof request.result?.value === 'string' ? request.result.value : '');
    request.onerror = () => reject(request.error);
  });
}

async function saveAppearanceValue(key: string, value: string) {
  const db = await openAppearanceDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(APPEARANCE_STORE, 'readwrite');
    tx.objectStore(APPEARANCE_STORE).put({ id: key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function mirrorAvatarToLocalStorage(personKey: Person['key'], avatar: string) {
  const storageKey = PERSON_AVATAR_KEYS[personKey];
  const next = avatar.trim();
  if (next) localStorage.setItem(storageKey, next);
  else localStorage.removeItem(storageKey);
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
        <p className='empty-copy'>来写下第一条想法吧</p>
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

function ReaderPage({ book, chapter, chapters, annotations, chapterIndex, setChapterIndex, selectedFont, fontSize, setFontSize, paragraphIndex, setParagraphIndex, setPage, onAddAnnotation }: {
  book?: Book;
  chapter?: Chapter;
  chapters: ChapterSummary[];
  annotations: Annotation[];
  chapterIndex: number;
  setChapterIndex: (index: number) => void;
  selectedFont: string;
  fontSize: number;
  setFontSize: (size: number) => void;
  paragraphIndex?: number;
  setParagraphIndex: (index?: number) => void;
  setPage: (page: Page) => void;
  onAddAnnotation: (text: string, quote?: string, paragraphIndex?: number) => Promise<void>;
}) {
  const screenRef = useRef<HTMLElement>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [annotationTarget, setAnnotationTarget] = useState<{
    quote: string;
    paragraphIndex?: number;
    source: 'paragraph' | 'selection';
  } | null>(null);
  const displayChapters = useMemo(() => getDisplayChapters(chapters), [chapters]);
  const readerChapterLabel = getReaderChapterLabel(chapter, displayChapters);

  const searchResults = useMemo(() => {
    const keyword = search.trim();
    if (!keyword) return [];
    return chapters.flatMap((item) => item.paragraphs
      .map((text, index) => ({ chapterIndex: item.chapterIndex, title: item.title, paragraphIndex: index, text }))
      .filter((item) => item.text.includes(keyword) || item.title.includes(keyword)))
      .slice(0, 20);
  }, [chapters, search]);

  const annotationsByParagraph = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    const paragraphs = chapter?.paragraphs || [];
 
    const normalizeText = (value?: string) => (value || '').replace(/\s+/g, ' ').trim();

    annotations.forEach((annotation) => {
      let targetIndex = annotation.paragraphIndex;
      const cleanQuote = normalizeText(annotation.quote);

      if (cleanQuote) {
        const indexedParagraph =
          targetIndex != null && Number.isFinite(targetIndex) && targetIndex >= 0
            ? paragraphs[targetIndex]
            : undefined;

        const indexedContainsQuote = indexedParagraph
          ? normalizeText(indexedParagraph).includes(cleanQuote)
          : false;

        if (!indexedContainsQuote) {
          const quoteMatchedIndex = paragraphs.findIndex((paragraph) =>
            normalizeText(paragraph).includes(cleanQuote),
          );

          if (quoteMatchedIndex >= 0) {
            targetIndex = quoteMatchedIndex;
          } else if (targetIndex == null || !Number.isFinite(targetIndex) || targetIndex < 0) {
            return;
          }
        }
      }

      if (
        targetIndex == null ||
        !Number.isFinite(targetIndex) ||
        targetIndex < 0 ||
        targetIndex >= paragraphs.length
      ) {
        return;
      }

      map.set(targetIndex, [...(map.get(targetIndex) || []), annotation]);
    });

    return map;
  }, [annotations, chapter?.paragraphs]);

  const [threadTarget, setThreadTarget] = useState<{
    quote: string;
    paragraphIndex: number;
    annotations: Annotation[];
  } | null>(null);

  useEffect(() => {
    if (paragraphIndex == null) {
      screenRef.current?.scrollTo({ top: 0 });
      return;
    }
    window.setTimeout(() => {
      document.getElementById(`paragraph-${chapterIndex}-${paragraphIndex}`)?.scrollIntoView({ block: 'center' });
    }, 80);
  }, [chapterIndex, paragraphIndex]);

  useEffect(() => {
    setAnnotationTarget(null);
    setThreadTarget(null);
    setDraft('');
    setComposerOpen(false);
  }, [chapterIndex]);

  if (!book) {
    return <main className='screen reader-screen'><p className='empty-copy'>先去书架导入一本书。</p></main>;
  }

  const goChapter = (index: number, nextParagraph?: number) => {
    setAnnotationTarget(null);
    setThreadTarget(null);
    setComposerOpen(false);
    setParagraphIndex(nextParagraph);
    setChapterIndex(Math.min(book.chapterCount, Math.max(1, index)));
  };

  const captureTextSelection = () => {
    const selection = window.getSelection();
    const quote = selection?.toString().replace(/\s+/g, ' ').trim() || '';
    if (quote.length < 2) return;

    const anchor = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    const paragraphElement = anchor?.closest('[data-paragraph-index]');
    const nextParagraphIndex = paragraphElement?.getAttribute('data-paragraph-index');
    const parsedParagraphIndex = nextParagraphIndex == null ? undefined : Number(nextParagraphIndex);

    if (parsedParagraphIndex != null && Number.isFinite(parsedParagraphIndex)) {
      setParagraphIndex(parsedParagraphIndex);
    }
    setAnnotationTarget({
      quote,
      paragraphIndex: parsedParagraphIndex != null && Number.isFinite(parsedParagraphIndex) ? parsedParagraphIndex : paragraphIndex,
      source: 'selection',
    });
    setComposerOpen(false);
  };

  const openAnnotationThread = (index: number, text: string) => {
    const existing = annotationsByParagraph.get(index) || [];
    setParagraphIndex(index);
    setAnnotationTarget({ quote: text, paragraphIndex: index, source: 'paragraph' });
    setThreadTarget({ quote: text, paragraphIndex: index, annotations: existing });
    setComposerOpen(false);
  };

  const selectParagraph = (index: number, text: string) => {
    const selectedText = window.getSelection()?.toString().replace(/\s+/g, ' ').trim() || '';
    if (selectedText.length > 1) return;
    const existing = annotationsByParagraph.get(index) || [];
    if (existing.length) {
      openAnnotationThread(index, text);
      return;
    }
    setParagraphIndex(index);
    setThreadTarget(null);
    setAnnotationTarget({ quote: text, paragraphIndex: index, source: 'paragraph' });
    setComposerOpen(false);
  };

  const closeAnnotationTarget = () => {
    setAnnotationTarget(null);
    setThreadTarget(null);
    setComposerOpen(false);
    setDraft('');
    window.getSelection()?.removeAllRanges();
  };

  const saveAnnotation = async () => {
    if (!draft.trim() || !annotationTarget) return;
    await onAddAnnotation(draft.trim(), annotationTarget.quote, annotationTarget.paragraphIndex);
    setDraft('');
    setComposerOpen(false);
    setThreadTarget(null);
    setAnnotationTarget(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <main className='screen reader-screen' ref={screenRef}>
      <div className='reader-top'>
        <button disabled={chapterIndex <= 1} onClick={() => goChapter(chapterIndex - 1)}>‹</button>
        <div>
          <button onClick={() => setPage('toc')}>目录</button>
          <button disabled={chapterIndex >= book.chapterCount} onClick={() => goChapter(chapterIndex + 1)}>›</button>
        </div>
      </div>
      <section className='reader-tools'>
        <label className='reader-search'>
          <span>搜索</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder='输入书中内容' />
        </label>
        <div className='reader-type-tools'>
          <button onClick={() => setFontSize(Math.max(14, fontSize - 1))}>A-</button>
          <strong>{fontSize}</strong>
          <button onClick={() => setFontSize(Math.min(28, fontSize + 1))}>A+</button>
        </div>
        {!!searchResults.length && (
          <div className='search-results'>
            {searchResults.map((result) => (
              <button key={`${result.chapterIndex}-${result.paragraphIndex}`} onClick={() => {
                goChapter(result.chapterIndex, result.paragraphIndex);
                setSearch('');
              }}>
                <strong>{result.title}</strong>
                <span>{result.text.slice(0, 54)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <article
        className='reading-paper'
        onMouseUp={captureTextSelection}
        onTouchEnd={() => window.setTimeout(captureTextSelection, 80)}
        style={{
          ...(selectedFont ? { fontFamily: selectedFont } : {}),
          '--reader-font-size': `${fontSize}px`,
        } as React.CSSProperties}
      >
        <p className='chapter'>{readerChapterLabel}</p>
        <h1>{chapter?.title || book.title}</h1>
        <div className='ornament'>✦</div>
        {(chapter?.paragraphs || []).map((text, index) => {
          const paragraphAnnotations = annotationsByParagraph.get(index) || [];
          const count = paragraphAnnotations.length;
          const isTarget = annotationTarget?.paragraphIndex === index;
          const isThread = threadTarget?.paragraphIndex === index;
          const isCurrent = paragraphIndex === index;
          const className = [
            'reader-paragraph',
            count ? 'paragraph-has-note' : '',
            isTarget ? 'paragraph-selected' : '',
            isThread ? 'paragraph-thread-open' : '',
            isCurrent && !isTarget ? 'paragraph-current' : '',
          ].filter(Boolean).join(' ');

          return (
            <p
              id={`paragraph-${chapterIndex}-${index}`}
              data-paragraph-index={index}
              key={`${chapterIndex}-${index}`}
              className={className}
              onClick={() => selectParagraph(index, text)}
            >
              {count > 0 && (
                <button
                  type='button'
                  className='paragraph-note-dot'
                  aria-label={`查看 ${count} 条批注`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openAnnotationThread(index, text);
                  }}
                >
                  {count}
                </button>
              )}
              {text}
            </p>
          );
        })}
      </article>
      <div className='reader-progress'>
        <div className='progress-meta'>
          <span>{book.progress}%</span>
          <span>{chapter?.title || '读取中'}</span>
        </div>
        <input
          aria-label='阅读进度'
          className='progress-slider'
          type='range'
          min='1'
          max={book.chapterCount}
          value={chapterIndex}
          onChange={(event) => goChapter(Number(event.target.value))}
        />
      </div>

      {annotationTarget && !composerOpen && !threadTarget && (
        <div className='reader-selection-bar'>
          <button className='selection-summary' onClick={() => setComposerOpen(true)}>
            <span>{annotationTarget.source === 'selection' ? '已选文字' : `第 ${(annotationTarget.paragraphIndex ?? 0) + 1} 段`}</span>
            <strong>{annotationTarget.quote.slice(0, 36)}{annotationTarget.quote.length > 36 ? '…' : ''}</strong>
          </button>
          <button className='selection-add' onClick={() => setComposerOpen(true)}>+ Nenei 页边</button>
          <button className='selection-close' onClick={closeAnnotationTarget} aria-label='取消批注目标'>×</button>
        </div>
      )}


      {threadTarget && !composerOpen && (
        <div className='reader-sheet-backdrop' onClick={() => setThreadTarget(null)}>
          <section className='reader-annotation-sheet reader-thread-sheet' onClick={(event) => event.stopPropagation()}>
            <span className='sheet-handle' />
            <p className='sheet-label'>这一段的页边</p>
            <blockquote>{threadTarget.quote}</blockquote>
            <div className='thread-note-list'>
              {threadTarget.annotations.map((annotation) => (
                <article className='thread-note' key={annotation.id}>
                  <div>
                    <strong>{annotation.author === 'ai' ? 'Elior' : 'Nenei'}</strong>
                    <small>{new Date(annotation.createdAt).toLocaleString()}</small>
                  </div>
                  {annotation.quote && annotation.quote !== threadTarget.quote && <em>“{annotation.quote}”</em>}
                  <p>{annotation.text}</p>
                </article>
              ))}
            </div>
            <div className='sheet-actions'>
              <button onClick={closeAnnotationTarget}>收起</button>
              <button className='solid-button' onClick={() => {
                setAnnotationTarget({ quote: threadTarget.quote, paragraphIndex: threadTarget.paragraphIndex, source: 'paragraph' });
                setThreadTarget(null);
                setComposerOpen(true);
              }}>Nenei 再写一条</button>
            </div>
          </section>
        </div>
      )}

      {composerOpen && annotationTarget && (
        <div className='reader-sheet-backdrop' onClick={() => setComposerOpen(false)}>
          <section className='reader-annotation-sheet' onClick={(event) => event.stopPropagation()}>
            <span className='sheet-handle' />
            <p className='sheet-label'>{annotationTarget.source === 'selection' ? '引用所选文字' : '引用这一段'}</p>
            <blockquote>{annotationTarget.quote}</blockquote>
            <label>
              <span>Nenei</span>
              <textarea
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder='写在页边……'
              />
            </label>
            <div className='sheet-actions'>
              <button onClick={() => setComposerOpen(false)}>先不写</button>
              <button className='solid-button' disabled={!draft.trim()} onClick={saveAnnotation}>保存</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}


function NotesPage({ book, annotations, chapterIndex, onAddAnnotation }: { book?: Book; annotations: Annotation[]; chapterIndex: number; onAddAnnotation: (text: string) => Promise<void> }) {
  const [draft, setDraft] = useState('');
  return (
    <main className='screen notes-screen'>
      <div className='screen-title inline'>
        <div>
          <h1>页边</h1>
          <p>{book ? book.title : '未选择书本'}</p>
        </div>
        <button className='text-button'>筛选</button>
      </div>
      <section className='annotation-composer compact-composer'>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`给第 ${chapterIndex} 章添加批注`} />
        <div>
          <button className='solid-button' disabled={!draft.trim()} onClick={async () => {
            await onAddAnnotation(draft);
            setDraft('');
          }}>保存批注</button>
        </div>
      </section>
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
      {!annotations.length && <p className='empty-copy'>还没有批注。</p>}
    </main>
  );
}

function TocPage({ book, chapters, chapterIndex, setChapterIndex, setPage }: {
  book?: Book;
  chapters: ChapterSummary[];
  chapterIndex: number;
  setChapterIndex: (index: number) => void;
  setPage: (page: Page) => void;
}) {
  const displayChapters = useMemo(
    () => getDisplayChapters(chapters).filter((chapter) => !chapter.hiddenFromToc),
    [chapters],
  );

  return (
    <main className='screen toc-screen'>
      <div className='screen-title'>
        <h1>目录</h1>
        <p>{book ? `${book.title} · 已读 ${book.progress}%` : '未选择书本'}</p>
      </div>
      <div className='toc-progress'><span style={{ width: `${book?.progress || 0}%` }} /></div>
      <section className='chapter-list'>
        {displayChapters.map((chapter) => (
          <button key={chapter.chapterIndex} className={chapter.chapterIndex === chapterIndex ? 'current' : ''} onClick={() => {
            setChapterIndex(chapter.chapterIndex);
            setPage('reader');
          }}>
            <span>{chapter.displayLabel}</span>
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
  const [fontSize, setFontSizeState] = useState(Number(localStorage.getItem('nenei-yomiai-font-size') || '18'));

  const progressSyncTimer = useRef<number | undefined>(undefined);
  const avatarHydrated = useRef({ elior: false, nenei: false });

  const selectedBook = books.find((book) => book.id === selectedBookId) || books[0];
  const style = useMemo(() => ({ '--accent': accent } as React.CSSProperties), [accent]);

  const setSelectedFont = (value: string) => {
    setSelectedFontState(value);
    localStorage.setItem('nenei-yomiai-font', value);
  };

  const setFontSize = (value: number) => {
    setFontSizeState(value);
    localStorage.setItem('nenei-yomiai-font-size', String(value));
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
    loadAppearanceValue(PERSON_AVATAR_KEYS.elior)
      .then((avatar) => {
        if (avatar) {
          setElior((current) => ({ ...current, avatar }));
          mirrorAvatarToLocalStorage('elior', avatar);
        }
        avatarHydrated.current.elior = true;
      })
      .catch((error) => {
        avatarHydrated.current.elior = true;
        console.error(error);
      });

    loadAppearanceValue(PERSON_AVATAR_KEYS.nenei)
      .then((avatar) => {
        if (avatar) {
          setNenei((current) => ({ ...current, avatar }));
          mirrorAvatarToLocalStorage('nenei', avatar);
        }
        avatarHydrated.current.nenei = true;
      })
      .catch((error) => {
        avatarHydrated.current.nenei = true;
        console.error(error);
      });
  }, []);

  useEffect(() => {
    if (!avatarHydrated.current.elior) return;
    saveAppearanceValue(PERSON_AVATAR_KEYS.elior, elior.avatar).catch(console.error);
    mirrorAvatarToLocalStorage('elior', elior.avatar);
  }, [elior.avatar]);

  useEffect(() => {
    if (!avatarHydrated.current.nenei) return;
    saveAppearanceValue(PERSON_AVATAR_KEYS.nenei, nenei.avatar).catch(console.error);
    mirrorAvatarToLocalStorage('nenei', nenei.avatar);
  }, [nenei.avatar]);

  useEffect(() => {
    if (!selectedBook) return;
    setSelectedBookId(selectedBook.id);
    localStorage.setItem('nenei-yomiai-book', selectedBook.id);

    const localProgress = loadLocalProgress(selectedBook.id);
    if (localProgress) {
      setChapterIndex(Math.min(selectedBook.chapterCount, Math.max(1, localProgress.chapterIndex)));
      setParagraphIndex(localProgress.paragraphIndex);
      setBooks((currentBooks) => currentBooks.map((book) => (
        book.id === selectedBook.id ? { ...book, progress: localProgress.percent } : book
      )));
    } else {
      api<{ ok: boolean; progress: { chapterIndex: number; paragraphIndex?: number; percent?: number }[] }>(`/progress?bookId=${selectedBook.id}`)
        .then((data) => {
          const current = data.progress[0];
          if (current) {
            setChapterIndex(current.chapterIndex);
            setParagraphIndex(current.paragraphIndex);
            const percent = typeof current.percent === 'number'
              ? Math.min(100, Math.max(0, Math.round(current.percent)))
              : calcProgressPercent(current.chapterIndex, selectedBook.chapterCount);
            saveLocalProgress(selectedBook.id, {
              chapterIndex: current.chapterIndex,
              paragraphIndex: current.paragraphIndex,
              percent,
              updatedAt: Date.now(),
            });
          }
        })
        .catch(console.error);
    }

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
    const percent = calcProgressPercent(chapterIndex, selectedBook.chapterCount);
    const nextStatus: ShelfStatus = percent >= 100
      ? '已读'
      : selectedBook.status === '已读'
        ? '已读'
        : '正在读';

    const localProgress: LocalProgress = {
      chapterIndex,
      paragraphIndex,
      percent,
      updatedAt: Date.now(),
    };

    localStorage.setItem('nenei-yomiai-chapter', String(chapterIndex));
    saveLocalProgress(selectedBook.id, localProgress);
    setBooks((currentBooks) => currentBooks.map((book) => (
      book.id === selectedBook.id ? { ...book, progress: percent, status: nextStatus } : book
    )));

    if (progressSyncTimer.current) {
      window.clearTimeout(progressSyncTimer.current);
    }

    progressSyncTimer.current = window.setTimeout(() => {
      api('/progress', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: selectedBook.id, chapterIndex, paragraphIndex, percent, status: nextStatus }),
      }).catch(console.error);
    }, 220);

    return () => {
      if (progressSyncTimer.current) {
        window.clearTimeout(progressSyncTimer.current);
      }
    };
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
      setParagraphIndex(undefined);
      saveLocalProgress(data.book.id, { chapterIndex: 1, paragraphIndex: undefined, percent: calcProgressPercent(1, data.book.chapterCount), updatedAt: Date.now() });
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

  const addAnnotation = async (text: string, quote?: string, targetParagraphIndex?: number) => {
    if (!selectedBook) return;
    await api(`/books/${selectedBook.id}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterIndex,
        paragraphIndex: targetParagraphIndex,
        quote,
        text,
        author: 'nenei',
      }),
    });
    const data = await api<{ ok: boolean; annotations: Annotation[] }>(`/books/${selectedBook.id}/annotations?chapterIndex=${chapterIndex}`);
    setAnnotations(data.annotations);
  };

  return (
    <div className='app-shell' style={style}>
      <div className='phone-frame'>
        <Header setPage={setPage} elior={elior} nenei={nenei} />
        {page === 'home' && <HomePage setPage={setPage} book={selectedBook} />}
        {page === 'shelf' && <ShelfPage books={books} selectedBookId={selectedBook?.id} onSelectBook={(id) => {
          const targetBook = books.find((book) => book.id === id);
          const savedProgress = loadLocalProgress(id);
          setSelectedBookId(id);
          setChapterIndex(savedProgress?.chapterIndex || 1);
          setParagraphIndex(savedProgress?.paragraphIndex);
          if (targetBook && savedProgress) {
            setBooks((currentBooks) => currentBooks.map((book) => (
              book.id === id ? { ...book, progress: savedProgress.percent } : book
            )));
          }
          setPage('reader');
        }} onImport={importBook} importing={importing} />}
        {page === 'reader' && <ReaderPage book={selectedBook} chapter={chapter} chapters={chapters} annotations={annotations} chapterIndex={chapterIndex} setChapterIndex={setChapterIndex} selectedFont={selectedFont} fontSize={fontSize} setFontSize={setFontSize} paragraphIndex={paragraphIndex} setParagraphIndex={setParagraphIndex} setPage={setPage} onAddAnnotation={addAnnotation} />}
        {page === 'notes' && <NotesPage book={selectedBook} annotations={annotations} chapterIndex={chapterIndex} onAddAnnotation={addAnnotation} />}
        {page === 'toc' && <TocPage book={selectedBook} chapters={chapters} chapterIndex={chapterIndex} setChapterIndex={setChapterIndex} setPage={setPage} />}
        {page === 'settings' && <SettingsPage elior={elior} nenei={nenei} setElior={setElior} setNenei={setNenei} accent={accent} setAccent={setAccent} fonts={fonts} selectedFont={selectedFont} setSelectedFont={setSelectedFont} onImportFont={importFont} />}
        {page !== 'reader' && <BottomNav page={page} setPage={setPage} />}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
