import { readingStatus } from './reading-status';
import { useRemembered, usePagePosition, groupNotes } from './page-memory';
import { BackupSettings } from './device-backup';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { rememberFarthest, useReadingTime, ReadingTime, DailyQuote } from './reading-life';
import { useReaderScroll, BackgroundSettings, useBackgrounds } from './reader-enhancements';

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
type ShelfStatus = '未读' | '正在读' | '已读';

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
  paragraphOffset?: number;
  pending?: boolean;
  status?: ShelfStatus;
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
      paragraphOffset: parsed.paragraphOffset,
      pending: parsed.pending,
      status: parsed.status,
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
      <button className='brand' onClick={() => setPage('home')} aria-label='回到首页'><svg className='brand-mark' viewBox='0 0 512 512' aria-hidden='true' focusable='false'>
        <rect width='512' height='512' rx='112' fill='#f7f4ec' />
        <path d='M115 139c48-7 92 10 124 43v191c-34-34-77-51-124-43zM397 139c-48-7-92 10-124 43v191c34-34 77-51 124-43z' fill='currentColor' />
        <path d='M148 174c25 1 46 8 64 21M148 200c25 1 46 8 64 21M364 174c-25 1-46 8-64 21' fill='none' stroke='#f7f4ec' strokeWidth='7' strokeLinecap='round' opacity='.6' />
        <path d='M250 192h12v163l-6-7-6 7z' fill='currentColor' opacity='.55' />
      </svg><span className='brand-type'><span>VERSO</span>{' '}<small>À DEUX</small></span></button>
      <div className='identity-mini'>
        <Avatar person={elior} />
        <Avatar person={nenei} muted />
        <button className='gear' onClick={() => setPage('settings')} aria-label='设置'>☰</button>
      </div>
    </header>
  );
}

function HomePage({ setPage, book, notes, onOpen, onRead }: { setPage: (page: Page) => void; book?: Book; notes: Annotation[]; onOpen: (note: Annotation) => void; onRead: (notes: Annotation[]) => void }) {
  return <main className='screen home-screen'>
    <section className='hero-card'><Cover book={book} /><div className='hero-copy'><p className='eyebrow'>正在读</p><h1>{book?.title || '还没有书'}</h1><p>{book?.author || '从书架导入一本 epub'}</p><div className='progress'><span style={{width:`${book?.progress || 0}%`}} /></div><small>已读 {book?.progress || 0}%</small></div></section>
    <button className='continue-book' onClick={()=>setPage(book?'reader':'shelf')}>{book?'继续阅读':'去书架'}</button>
    {book && <><ReadingTime bookId={book.id} /><DailyQuote key={book.id} bookId={book.id} title={book.title} notes={notes} onRead={items=>onRead(items as Annotation[])} onOpen={note=>onOpen(note as Annotation)} /></>}
  </main>;
}

function ShelfPage({ books, selectedBookId, onSelectBook, onImport, importing, onStatus }: {
  books: Book[];
  selectedBookId?: string;
  onSelectBook: (bookId: string) => void;
  onImport: (file: File) => void;
  importing: boolean;
  onStatus: (status: ShelfStatus) => void;
}) {
  const [status, setStatus] = useRemembered<ShelfStatus>('yomiai-view-shelf-status', '正在读');
  const shelfRef = usePagePosition(`yomiai-view-shelf-${status}`, books.length > 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = books.filter((book) => book.status === status);

  return (
    <main ref={shelfRef} className='screen shelf-screen' aria-label='书架'>
      <div className='shelf-toolbar'>
        <div className='status-tabs'>
          {(['未读', '正在读', '已读'] as ShelfStatus[]).map((item) => (
            <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item}</button>
          ))}
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

      <section className={'book-list' + (status === '已读' ? ' cover-wall' : '')}>
        {filtered.map((book) => (
          <div className='shelf-entry' key={book.id}><button className={'book-row ' + (book.id === selectedBookId ? 'selected' : '')} key={book.id} onClick={() => onSelectBook(book.id)}>
            <Cover book={book} />
            <div>
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              <small>{book.status} · {book.chapterCount} 章{book.progress ? ` · 已读 ${book.progress}%` : ''}</small>
              <div className='mini-progress'><span style={{ width: `${book.progress}%` }} /></div>
            </div>
          </button>{book.id === selectedBookId && <details className='book-manage'><summary aria-label='管理这本书'>···</summary><label><span>阅读状态</span><select aria-label='书籍状态' value={book.status} onChange={e=>onStatus(e.target.value as ShelfStatus)}>{(['未读','正在读','已读'] as ShelfStatus[]).map(value=><option key={value}>{value}</option>)}</select></label></details>}</div>
        ))}
        {!filtered.length && <p className='empty-copy'>这里还没有书。</p>}
      </section>
    </main>
  );
}

function ReaderPage({ noteJump, onConsumeJump, book, chapter, chapters, annotations, chapterIndex, setChapterIndex, selectedFont, fontSize, setFontSize, paragraphIndex, setParagraphIndex, setPage, onAddAnnotation, onPosition, initialOffset, onReadNotes, onLoadChapters }: {
  noteJump: Annotation | null;
  onConsumeJump: () => void;
  onPosition: (paragraph: number, offset: number, fraction: number, pastFirstScreen: boolean, atEnd: boolean) => void;
  initialOffset?: number;
  onReadNotes: (notes: Annotation[]) => void;
  onLoadChapters: () => void;
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
  const [arrival, setArrival] = useState<{ index: number; quote: string } | null>(null);
  const jumpIndex = noteJump && chapter ? (() => {
    const quoted = noteJump.quote?.trim() || '';
    const index = noteJump.paragraphIndex;
    if (index != null && chapter.paragraphs[index] && (!quoted || chapter.paragraphs[index].includes(quoted))) return index;
    const match = quoted ? chapter.paragraphs.findIndex(text => text.includes(quoted)) : -1;
    return match >= 0 ? match : index;
  })() : undefined;
  useEffect(() => {
    if (!noteJump || !chapter) return;
    if (jumpIndex != null && chapter.paragraphs[jumpIndex]) {
      setParagraphIndex(jumpIndex);
      setArrival({ index: jumpIndex, quote: noteJump.quote?.trim() || '' });
    }
    onConsumeJump();
  }, [noteJump, chapter]);
  useEffect(() => {
    if (!arrival) return;
    const timer = window.setTimeout(() => setArrival(null), 3100);
    return () => window.clearTimeout(timer);
  }, [arrival]);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useReadingTime(book?.id, Boolean(chapter));
  const draftKey = `yomiai-draft-${book?.id}-${chapterIndex}`;
  const [draft, setDraft] = useState(() => { try { return JSON.parse(localStorage.getItem(draftKey) || '{}').text || ''; } catch { return ''; } });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [annotationTarget, setAnnotationTarget] = useState<{
    quote: string;
    paragraphIndex?: number;
    source: 'paragraph' | 'selection';
  } | null>(() => { try { return JSON.parse(localStorage.getItem(draftKey) || '{}').target || null; } catch { return null; } });
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

  const capturePosition = useReaderScroll(screenRef, { chapterKey: `${book?.id}-${chapterIndex}`, paragraphIndex: jumpIndex ?? paragraphIndex, initialOffset, fontSize, onPosition });
  const chooseTarget = (target: NonNullable<typeof annotationTarget>) => {
    const key = `${draftKey}-${target.paragraphIndex ?? "chapter"}-${encodeURIComponent(target.quote)}`;
    setDraft(localStorage.getItem(key) || '');
    setAnnotationTarget(target); setSaveError('');
  };
  const updateDraft = (text: string) => {
    setDraft(text);
    if (!annotationTarget) return;
    const key = `${draftKey}-${annotationTarget.paragraphIndex ?? "chapter"}-${encodeURIComponent(annotationTarget.quote)}`;
    if (text.trim()) {
      localStorage.setItem(key, text);
      localStorage.setItem(draftKey, JSON.stringify({ text, target: annotationTarget }));
    } else {
      localStorage.removeItem(key); localStorage.removeItem(draftKey);
    }
  };
  useEffect(() => {
    setThreadTarget(current => current ? { ...current, annotations: annotationsByParagraph.get(current.paragraphIndex) || [] } : null);
  }, [annotationsByParagraph]);
  if (!book) {
    return <main className='screen reader-screen'><p className='empty-copy'>先去书架导入一本书。</p></main>;
  }

  const goChapter = (index: number, nextParagraph?: number) => {
    setArrival(null);
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

    chooseTarget({
      quote,
      paragraphIndex: parsedParagraphIndex != null && Number.isFinite(parsedParagraphIndex) ? parsedParagraphIndex : paragraphIndex,
      source: 'selection',
    });
    setComposerOpen(false);
  };

  const openAnnotationThread = (index: number, text: string) => {
    const existing = annotationsByParagraph.get(index) || [];
    onReadNotes(existing);
    chooseTarget({ quote: text, paragraphIndex: index, source: 'paragraph' });
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
    setThreadTarget(null);
    chooseTarget({ quote: text, paragraphIndex: index, source: 'paragraph' });
    setComposerOpen(false);
  };

  const closeAnnotationTarget = () => {
    setAnnotationTarget(null);
    setThreadTarget(null);
    setComposerOpen(false);
    window.getSelection()?.removeAllRanges();
  };

  const saveAnnotation = async () => {
    if (!draft.trim() || !annotationTarget || savingRef.current) return;
    savingRef.current = true; setSaving(true); setSaveError('');
    try {
    await onAddAnnotation(draft.trim(), annotationTarget.quote, annotationTarget.paragraphIndex);
    localStorage.removeItem(`${draftKey}-${annotationTarget.paragraphIndex ?? "chapter"}-${encodeURIComponent(annotationTarget.quote)}`);
    localStorage.removeItem(draftKey);
    setDraft('');
    setComposerOpen(false);
    setThreadTarget(null);
    setAnnotationTarget(null);
    window.getSelection()?.removeAllRanges();
    } catch { setSaveError('保存失败，草稿已保留。'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  return (
    <main className='screen reader-screen' ref={screenRef}>
      <section className='reader-tools'>
      <div className='reader-top'>
        <button aria-label='回到首页' onClick={()=>setPage('home')}>‹</button>
        <span className='reader-chapter-name'>{chapter?.title}</span>
        <button aria-label='阅读菜单' aria-expanded={menuOpen} onClick={()=>{setMenuOpen(!menuOpen);setSearchOpen(false);setSearch('');}}>···</button>
      </div>
      {menuOpen && <div className='reader-menu'>
        <button onClick={()=>setPage('toc')}>目录</button>
        <button className='search-toggle' onClick={() => { setSearchOpen(!searchOpen); onLoadChapters(); }} aria-expanded={searchOpen}>搜索</button>
        {searchOpen && <label className='reader-search'>
          <input aria-label='搜索书中内容' value={search} onChange={(event) => setSearch(event.target.value)} placeholder='输入书中内容' />
        </label>}
        <div className='reader-type-tools'>
          <button onClick={() => { capturePosition(); setFontSize(Math.max(14, fontSize - 1)); }}>A-</button>
          <strong>{fontSize}</strong>
          <button onClick={() => { capturePosition(); setFontSize(Math.min(28, fontSize + 1)); }}>A+</button>
        </div>
        </div>}
        {searchOpen && !chapters.length && <small>正在加载搜索内容…</small>}
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
          const isCurrent = false;
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
              {arrival?.index === index ? (() => {
                const start = arrival.quote ? text.indexOf(arrival.quote) : -1;
                return start >= 0 ? <>{text.slice(0, start)}<mark className='reader-jump-mark'>{text.slice(start, start + arrival.quote.length)}</mark>{text.slice(start + arrival.quote.length)}</> : <mark className='reader-jump-mark'>{text}</mark>;
              })() : text}
            </p>
          );
        })}
      </article>
      <nav className='chapter-navigation'><button disabled={chapterIndex<=1} onClick={()=>goChapter(chapterIndex-1)}>上一章</button><button disabled={chapterIndex>=book.chapterCount} onClick={()=>goChapter(chapterIndex+1)}>下一章</button></nav>
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
            <p className='sheet-label'>页边</p>
            <blockquote>{threadTarget.quote}</blockquote>
            <div className='thread-note-list'>
              {threadTarget.annotations.map((annotation) => (
                <article className='thread-note' data-author={annotation.author} key={annotation.id}>
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
                chooseTarget({ quote: threadTarget.quote, paragraphIndex: threadTarget.paragraphIndex, source: 'paragraph' });
                setThreadTarget(null);
                setComposerOpen(true);
              }}>再写一条</button>
            </div>
          </section>
        </div>
      )}

      {saveError && <p className='reader-error' role='alert'>{saveError}</p>}
      {composerOpen && annotationTarget && (
        <div className='reader-sheet-backdrop' onClick={() => setComposerOpen(false)}>
          <section className='reader-annotation-sheet' onClick={(event) => event.stopPropagation()}>
            <span className='sheet-handle' />
            <p className='sheet-label'>引用</p>
            <blockquote>{annotationTarget.quote}</blockquote>
            <label>
              <span>Nenei</span>
              <textarea
                autoFocus
                value={draft}
                onChange={(event) => updateDraft(event.target.value)}
                placeholder='写在页边……'
              />
            </label>
            <div className='sheet-actions'>
              <button onClick={() => setComposerOpen(false)}>先不写</button>
              <button className='solid-button' disabled={!draft.trim() || saving} onClick={saveAnnotation}>{saving ? '保存中' : '保存'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}


function NotesPage({ book, annotations, onOpen, isUnread }: { book?: Book; annotations: Annotation[]; onOpen: (note: Annotation) => void; isUnread: (note: Annotation) => boolean }) {
  const viewKey = `yomiai-view-notes-${book?.id || 'none'}`;
  const [author, setAuthor] = useRemembered(viewKey + '-author', 'all');
  const [chapterFilter, setChapterFilter] = useRemembered(viewKey + '-chapter', 'all');
  const [keyword, setKeyword] = useRemembered(viewKey + '-keyword', '');
  const [filterOpen, setFilterOpen] = useRemembered(viewKey + '-open', false);
  const notesRef = usePagePosition(`${viewKey}-${author}-${chapterFilter}-${keyword}`, annotations.length > 0);
  const filtered = annotations.filter(note => (author === 'all' || note.author === author || (author === 'unread' && isUnread(note))) && (chapterFilter === 'all' || note.chapterIndex === Number(chapterFilter)) && `${note.text} ${note.quote || ''}`.includes(keyword.trim())).sort((a, b) => a.chapterIndex - b.chapterIndex || (a.paragraphIndex ?? Number.MAX_SAFE_INTEGER) - (b.paragraphIndex ?? Number.MAX_SAFE_INTEGER) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return <main ref={notesRef} className='screen notes-screen' aria-label='页边'>
    <p className='notes-context'><span>{book?.title || '未选择书本'}</span><small>{annotations.length} 条页边</small></p>
    <details className="note-filter-panel" open={filterOpen} onToggle={e => setFilterOpen(e.currentTarget.open)}><summary>筛选</summary>
    <div className='note-filters'>
      <select aria-label='批注作者' value={author} onChange={e => setAuthor(e.target.value)}><option value='all'>我们两人</option><option value='ai'>Elior</option><option value='nenei'>Nenei</option><option value='unread'>未读留言</option></select>
      <select aria-label='批注章节' value={chapterFilter} onChange={e => setChapterFilter(e.target.value)}><option value='all'>所有章节</option>{[...new Set(annotations.map(n => n.chapterIndex))].sort((a,b) => a-b).map(n => <option key={n} value={n}>第 {n} 章</option>)}</select>
      <input aria-label='搜索批注' value={keyword} onChange={e => setKeyword(e.target.value)} placeholder='找一句话或一个想法' />
    </div>
    </details>
    {groupNotes(filtered).map(({key, entries}) => <section className='note-thread' key={key}>
      {entries[0].quote && <blockquote>{entries[0].quote}</blockquote>}
      {entries.map(note => <article className='note-card' data-author={note.author} key={note.id}><div className='note-head'><strong>{note.author === 'ai' ? 'Elior' : 'Nenei'}{isUnread(note) ? ' · 未读' : ''}</strong><small>{new Date(note.createdAt).toLocaleDateString()}</small></div><p>{note.text}</p></article>)}
      <footer><small>第 {entries[0].chapterIndex} 章</small><button onClick={() => onOpen(entries[0])}>回到原文</button></footer>
    </section>)}
    {!filtered.length && <p className='empty-copy'>这里还没有符合条件的页边。</p>}
  </main>;
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
      {!chapters.length && <p className='empty-copy'>正在加载目录…</p>}
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
  const [peopleOpen, setPeopleOpen] = useRemembered('yomiai-view-settings-people', false);
  const [appearanceOpen, setAppearanceOpen] = useRemembered('yomiai-view-settings-appearance', true);
  const settingsRef = usePagePosition('yomiai-view-settings-scroll');

  return (
    <main ref={settingsRef} className='screen settings-screen' aria-label='设置'>
      <details className='settings-group' open={peopleOpen} onToggle={e => setPeopleOpen(e.currentTarget.open)}><summary>我们</summary>
      <section className='pair-card'>
        <Avatar person={elior} />
        <span>×</span>
        <Avatar person={nenei} muted />
      </section>
      <PersonEditor label='Elior' person={elior} onChange={(patch) => updatePerson(elior, setElior, patch)} />
      <PersonEditor label='Nenei' person={nenei} onChange={(patch) => updatePerson(nenei, setNenei, patch)} />
      </details>
      <details className='settings-group' open={appearanceOpen} onToggle={e => setAppearanceOpen(e.currentTarget.open)}><summary>阅读外观</summary>
      <details className='appearance-more'><summary>背景图片</summary><BackgroundSettings /></details>
      <section className='settings-card'>
        <h2>主题色</h2>
        <div className='accent-row'>
          {accentPresets.map(([name, value]) => (
            <button key={value} className={accent === value ? 'active' : ''} style={{ '--swatch': value } as React.CSSProperties} onClick={() => setAccent(value)}>
              <span />{name}
            </button>
          ))}
        </div>
        <details className='appearance-more'><summary>自定义颜色</summary><label className='field color-field'>
          <span>自定义</span>
          <input type='color' value={accent} onChange={(event) => setAccent(event.target.value)} />
          <code>{accent}</code>
        </label></details>
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
      </details>
      <BackupSettings />
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

function NavIcon({ page }: { page: Page }) {
  const paths: Partial<Record<Page, string>> = {
    home: 'M3 4.5c3.5-.5 6 .5 9 3v14c-3-2.5-5.5-3.5-9-3V4.5Zm18 0c-3.5-.5-6 .5-9 3v14c3-2.5 5.5-3.5 9-3V4.5Z',
    shelf: 'M3 6h4v14H3zM9 3h4v17H9zM15 6l4-1 3 14-4 1zM3 16h4M9 7h4',
    notes: 'M14 21H4V3h16v10M8 7h8M8 11h5M8 15h3M16 15h6v4h-3l-3 3v-7Z',
    settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
  };
  return <svg viewBox='0 0 24 24' width='21' height='21' fill='none' stroke='currentColor' strokeWidth='1.35' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d={paths[page]} /></svg>;
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
        <button key={item.page} aria-label={item.label} aria-current={page === item.page ? 'page' : undefined} className={page === item.page ? 'active' : ''} onClick={() => setPage(item.page)}>
          <span className='nav-icon' aria-hidden='true'><NavIcon page={item.page} /></span>
        </button>
      ))}
    </nav>
  );
}

function App() {
  const [page, setPage] = useState<Page>('home');
  const [accent, setAccent] = useState(() => {
    try {
      const saved = localStorage.getItem('yomiai-accent');
      return saved && /^#[0-9a-f]{6}$/i.test(saved) ? saved : '#111111';
    } catch { return '#111111'; }
  });
  useEffect(() => {
    try { localStorage.setItem('yomiai-accent', accent); } catch { /* Keep theme usable when storage is unavailable. */ }
  }, [accent]);
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

  const [progressReady, setProgressReady] = useState('');
  const [initialOffset, setInitialOffset] = useState(0);
  const [noteJump, setNoteJump] = useState<Annotation | null>(null);
  const [notice, setNotice] = useState('');
  const [chapterRetry, setChapterRetry] = useState(0);
  const [searchRequested, setSearchRequested] = useState(false);
  const chapterCache = useRef(new Map<string, ChapterSummary[]>());
  const [seenNotes, setSeenNotes] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('yomiai-seen-notes') || '[]'); } catch { return []; } });
  const notesRequest = useRef(0);
  const syncQueues = useRef(new Map<string, Promise<void>>());
  useBackgrounds();
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
    setBooks(data.books.map(book => ({ ...book, status: (book.status as string) === '想读' ? '未读' : book.status }))); 
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

  const refreshNotes = async (bookId: string) => {
    const request = ++notesRequest.current;
    const data = await api<{ annotations: Annotation[] }>(`/books/${bookId}/annotations`);
    if (request === notesRequest.current) {
      setAnnotations(data.annotations.sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
      const baselineKey = `yomiai-unread-started-${bookId}`;
      if (!localStorage.getItem(baselineKey)) {
        markRead(data.annotations);
        localStorage.setItem(baselineKey, '1');
      }
    }
  };

  useEffect(() => {
    if (!selectedBook) return;
    const id = selectedBook.id;
    const controller = new AbortController();
    setProgressReady(''); setChapter(undefined); setChapters(chapterCache.current.get(id) || []); setSearchRequested(false); setAnnotations([]);
    setSelectedBookId(id); localStorage.setItem('nenei-yomiai-book', id);
    const local = loadLocalProgress(id);
    const restore = (progress?: LocalProgress) => {
      if (progress) rememberFarthest(id, progress);
      setChapterIndex(Math.min(selectedBook.chapterCount, Math.max(1, progress?.chapterIndex || 1)));
      setParagraphIndex(progress?.paragraphIndex);
      setInitialOffset(progress?.paragraphOffset || 0);
      setProgressReady(id);
    };
    // Resolve the newest bookmark before allowing the reader to write progress.
    api<{ progress: { chapterIndex: number; paragraphIndex?: number; percent?: number; updatedAt?: string }[] }>(`/progress?bookId=${id}`, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        const remote = data.progress[0];
        const remoteTime = remote?.updatedAt ? Date.parse(remote.updatedAt) : 0;
        if (local && (local.pending || local.updatedAt >= remoteTime)) restore(local);
        else if (remote) {
          const next = { chapterIndex: remote.chapterIndex, paragraphIndex: remote.paragraphIndex, percent: remote.percent || 0, updatedAt: remoteTime };
          saveLocalProgress(id, next); restore(next);
        } else restore(local);
      }).catch(() => { if (!controller.signal.aborted) restore(local); });
    refreshNotes(id).catch(() => { if (!controller.signal.aborted) setNotice('页边暂时未能加载，恢复网络后会重试。'); });
    return () => { controller.abort(); ++notesRequest.current; };
  }, [selectedBook?.id]);

  useEffect(() => {
    if (!selectedBook || (page !== 'toc' && !searchRequested) || chapterCache.current.has(selectedBook.id)) return;
    const id = selectedBook.id;
    const controller = new AbortController();
    api<{ chapters: ChapterSummary[] }>(`/books/${id}/chapters?from=1&to=${selectedBook.chapterCount}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { chapterCache.current.set(id, data.chapters); setChapters(data.chapters); } })
      .catch(() => { if (!controller.signal.aborted) setNotice('目录与搜索暂时未能加载，请重新打开重试。'); });
    return () => controller.abort();
  }, [selectedBook?.id, page, searchRequested]);

  useEffect(() => {
    if (!selectedBook || progressReady !== selectedBook.id) return;
    const controller = new AbortController();
    setChapter(undefined);
    api<{ chapter: Chapter }>(`/books/${selectedBook.id}/chapters/${chapterIndex}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setChapter(data.chapter); })
      .catch(() => { if (!controller.signal.aborted) setNotice('章节暂时未能加载，请检查网络后重新打开。'); });
    return () => controller.abort();
  }, [selectedBook?.id, chapterIndex, progressReady, chapterRetry]);

  useEffect(() => {
    if (!selectedBook) return;
    const refresh = () => { if (!document.hidden) refreshNotes(selectedBook.id).catch(() => {}); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [selectedBook?.id]);

  const syncProgress = (book: Book, progress: LocalProgress) => {
    const queue = (syncQueues.current.get(book.id) || Promise.resolve()).then(async () => {
      if (loadLocalProgress(book.id)?.updatedAt !== progress.updatedAt) return;
      try {
        await api('/progress', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: book.id, chapterIndex: progress.chapterIndex, paragraphIndex: progress.paragraphIndex, percent: progress.percent, status: progress.status || book.status }) });
        const latest = loadLocalProgress(book.id);
        if (latest?.updatedAt === progress.updatedAt) saveLocalProgress(book.id, { ...latest, pending: false, updatedAt: Date.now() });
      } catch { setNotice('阅读位置已保存在这台设备，联网后继续同步。'); }
    });
    syncQueues.current.set(book.id, queue);
  };
  useEffect(() => {
    const retry = () => {
      for (const book of books) {
        const pending = loadLocalProgress(book.id);
        if (pending?.pending) syncProgress(book, pending);
      }
    };
    window.addEventListener('online', retry);
    retry();
    return () => window.removeEventListener('online', retry);
  }, [books.map(book => book.id).join(',')]);

  const savePosition = (paragraph: number, offset: number, fraction: number, pastFirstScreen: boolean, atEnd: boolean) => {
    if (!selectedBook || progressReady !== selectedBook.id) return;
    const book = selectedBook;
    const status = readingStatus(book.status, chapterIndex, book.chapterCount, pastFirstScreen, atEnd);
    const percent = status === '已读' ? 100 : Math.min(99, Math.max(0, Math.round(((chapterIndex - 1 + fraction) / book.chapterCount) * 100)));
    const progress: LocalProgress = { chapterIndex, paragraphIndex: paragraph, paragraphOffset: offset, percent, status, updatedAt: Date.now(), pending: true };
    rememberFarthest(book.id, progress);
    saveLocalProgress(book.id, progress);
    setBooks(current => current.map(item => item.id === book.id ? { ...item, progress: percent, status } : item));
    syncProgress(book, progress);
  };
  const changeBookStatus = (status: ShelfStatus) => {
    if (!selectedBook || progressReady !== selectedBook.id) return;
    const saved = loadLocalProgress(selectedBook.id);
    const progress: LocalProgress = { chapterIndex, paragraphIndex, ...saved, status, percent: status === '已读' ? 100 : Math.min(99, saved?.percent || 0), updatedAt: Date.now(), pending: true };
    const book = { ...selectedBook, status, progress: progress.percent };
    saveLocalProgress(book.id, progress);
    setBooks(current => current.map(item => item.id === book.id ? book : item));
    syncProgress(book, progress);
  };
  const markRead = (notes: Annotation[]) => setSeenNotes(current => {
    const next = [...new Set([...current, ...notes.filter(n => n.author === 'ai').map(n => n.id)])];
    localStorage.setItem('yomiai-seen-notes', JSON.stringify(next)); return next;
  });
  const isUnread = (note: Annotation) => note.author === 'ai' && !seenNotes.includes(note.id);
  const continueReading = (nextPage: Page) => {
    if (nextPage === 'reader' && selectedBook) {
      const saved = loadLocalProgress(selectedBook.id);
      if (saved) { setChapterIndex(saved.chapterIndex); setParagraphIndex(saved.paragraphIndex); setInitialOffset(saved.paragraphOffset || 0); }
    }
    setPage(nextPage);
  };
  const openNote = (note: Annotation) => { setNoteJump(note); markRead([note]); setInitialOffset(0); setChapterIndex(note.chapterIndex); setParagraphIndex(note.paragraphIndex); setPage('reader'); };

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
    await refreshNotes(selectedBook.id).catch(() => setNotice('批注已保存，列表稍后刷新。'));
  };

  return (
    <div className='app-shell' style={style}>
      <div className='phone-frame'>
        {notice && <button className='app-notice' onClick={() => setNotice('')}>{notice} ×</button>}
        {page !== 'reader' && <Header setPage={setPage} elior={elior} nenei={nenei} />}
        {page === 'home' && <HomePage setPage={continueReading} book={selectedBook} notes={annotations} onOpen={openNote} onRead={markRead} />}
        {page === 'shelf' && <ShelfPage onStatus={changeBookStatus} books={books} selectedBookId={selectedBook?.id} onSelectBook={(id) => {
          const targetBook = books.find((book) => book.id === id);
          const savedProgress = loadLocalProgress(id);
          setSelectedBookId(id);
          setChapterIndex(savedProgress?.chapterIndex || 1);
          setParagraphIndex(savedProgress?.paragraphIndex);
          setInitialOffset(savedProgress?.paragraphOffset || 0);
          if (targetBook && savedProgress) {
            setBooks((currentBooks) => currentBooks.map((book) => (
              book.id === id ? { ...book, progress: savedProgress.percent } : book
            )));
          }
          setPage('reader');
        }} onImport={importBook} importing={importing} />}
        {page === 'reader' && (progressReady !== selectedBook?.id || !chapter || chapter.bookId !== selectedBook?.id || chapter.chapterIndex !== chapterIndex) && <main className='screen'><p>正在打开书页…</p><button className='text-button' onClick={() => setChapterRetry(value => value + 1)}>重新加载</button></main>}
        {page === 'reader' && progressReady === selectedBook?.id && chapter?.bookId === selectedBook?.id && chapter?.chapterIndex === chapterIndex && <ReaderPage noteJump={noteJump} onConsumeJump={() => setNoteJump(null)} key={`${selectedBook?.id}-${chapterIndex}`} initialOffset={initialOffset} onPosition={savePosition} onReadNotes={markRead} onLoadChapters={() => setSearchRequested(true)} book={selectedBook} chapter={chapter} chapters={chapters} annotations={annotations.filter(note => note.chapterIndex === chapterIndex)} chapterIndex={chapterIndex} setChapterIndex={index => { setInitialOffset(0); setChapterIndex(index); }} selectedFont={selectedFont} fontSize={fontSize} setFontSize={setFontSize} paragraphIndex={paragraphIndex} setParagraphIndex={setParagraphIndex} setPage={setPage} onAddAnnotation={addAnnotation} />}
        {page === 'notes' && <NotesPage key={selectedBook?.id} book={selectedBook} annotations={annotations} onOpen={openNote} isUnread={isUnread} />}
        {page === 'toc' && <TocPage book={selectedBook} chapters={chapters} chapterIndex={chapterIndex} setChapterIndex={index => { setParagraphIndex(undefined); setInitialOffset(0); setChapterIndex(index); }} setPage={setPage} />}
        {page === 'settings' && <SettingsPage elior={elior} nenei={nenei} setElior={setElior} setNenei={setNenei} accent={accent} setAccent={setAccent} fonts={fonts} selectedFont={selectedFont} setSelectedFont={setSelectedFont} onImportFont={importFont} />}
        {page !== 'reader' && <BottomNav page={page} setPage={setPage} />}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
