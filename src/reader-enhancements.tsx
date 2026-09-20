import { useEffect, useRef, useState, type RefObject } from 'react';

type ReaderOptions = {
  chapterKey: string;
  paragraphIndex?: number;
  initialOffset?: number;
  fontSize: number;
  onPosition: (paragraph: number, offset: number, fraction: number) => void;
};

// Only scrollTop is read during a gesture. Locate the paragraph after scrolling
// settles, using a binary search rather than measuring every paragraph per frame.
export function useReaderScroll(ref: RefObject<HTMLElement | null>, options: ReaderOptions) {
  const onPosition = useRef(options.onPosition);
  onPosition.current = options.onPosition;
  const anchor = useRef({ paragraph: options.paragraphIndex ?? -1, offset: options.initialOffset || 0 });
  const capture = useRef<() => void>(() => {});
  const restore = useRef<() => void>(() => {});
  useEffect(() => {
    const reader = ref.current;
    const frame = reader?.closest('.phone-frame');
    if (!reader || !frame) return;
    frame.classList.add('reader-mode');
    const paragraphs = [...reader.querySelectorAll<HTMLElement>('[data-paragraph-index]')];
    let idle = 0, animation = 0, restoring = true, dirty = false;
    let lastTop = reader.scrollTop, directionStart = lastTop, direction = 0;
    const locate = () => {
      if (!paragraphs.length) return;
      const top = reader.getBoundingClientRect().top + 24;
      let low = 0, high = paragraphs.length - 1;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (paragraphs[mid].getBoundingClientRect().bottom <= top) low = mid + 1;
        else high = mid;
      }
      const bounds = paragraphs[low].getBoundingClientRect();
      anchor.current = { paragraph: low, offset: Math.max(0, Math.min(1, (top - bounds.top) / Math.max(1, bounds.height))) };
      onPosition.current(low, anchor.current.offset, (low + anchor.current.offset) / paragraphs.length);
    };
    capture.current = locate;
    const flush = () => {
      window.clearTimeout(idle);
      if (!restoring && dirty) { dirty = false; locate(); }
    };
    restore.current = () => {
      const target = paragraphs[anchor.current.paragraph];
      if (!target) { reader.scrollTop = 0; restoring = false; return; }
      restoring = true;
      const bounds = target.getBoundingClientRect();
      reader.scrollTop += bounds.top - reader.getBoundingClientRect().top - 24 + anchor.current.offset * bounds.height;
      lastTop = reader.scrollTop;
      frame.classList.toggle('reader-chrome-hidden', lastTop > 24);
      directionStart = lastTop;
      requestAnimationFrame(() => { restoring = false; });
    };
    const firstFrame = requestAnimationFrame(() => restore.current());
    const onScroll = () => {
      if (restoring) return;
      dirty = true;
      window.clearTimeout(idle);
      idle = window.setTimeout(flush, 600);
      if (animation) return;
      animation = requestAnimationFrame(() => {
        animation = 0;
        const top = reader.scrollTop;
        const nextDirection = Math.sign(top - lastTop);
        if (nextDirection !== direction) { directionStart = lastTop; direction = nextDirection; }
        if (top < 24 || (direction < 0 && directionStart - top > 12)) frame.classList.remove('reader-chrome-hidden');
        else if (direction > 0 && top - directionStart > 20 && !reader.querySelector('.reader-sheet-backdrop, .reader-selection-bar, .search-results') && !reader.contains(document.activeElement)) frame.classList.add('reader-chrome-hidden');
        lastTop = top;
      });
    };
    const show = () => frame.classList.remove('reader-chrome-hidden');
    const visibility = () => { if (document.hidden) flush(); };
    reader.addEventListener('scroll', onScroll, { passive: true });
    reader.addEventListener('focusin', show);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', flush);
    return () => {
      flush(); cancelAnimationFrame(firstFrame); cancelAnimationFrame(animation);
      reader.removeEventListener('scroll', onScroll); reader.removeEventListener('focusin', show);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', flush);
      frame.classList.remove('reader-mode', 'reader-chrome-hidden');
    };
  }, [options.chapterKey]);
  useEffect(() => {
    anchor.current = { paragraph: options.paragraphIndex ?? -1, offset: options.initialOffset || 0 };
    restore.current();
  }, [options.paragraphIndex, options.initialOffset]);
  useEffect(() => { restore.current(); }, [options.fontSize]);
  return () => capture.current();
}

const HOME_KEY = 'nenei-yomiai-home-bg-url';
const READER_KEY = 'nenei-yomiai-reader-bg-url';
function applyBackgrounds() {
  for (const [key, name] of [[HOME_KEY, 'home'], [READER_KEY, 'reader']]) {
    const value = localStorage.getItem(key) || '';
    document.documentElement.style.setProperty(`--yomiai-${name}-bg`, value ? `url(${JSON.stringify(value)})` : 'none');
    document.documentElement.classList.toggle(`has-yomiai-${name}-bg`, Boolean(value));
  }
}
export function useBackgrounds() {
  useEffect(() => { applyBackgrounds(); window.addEventListener('storage', applyBackgrounds); return () => window.removeEventListener('storage', applyBackgrounds); }, []);
}
export function BackgroundSettings() {
  const [home, setHome] = useState(localStorage.getItem(HOME_KEY) || '');
  const [reader, setReader] = useState(localStorage.getItem(READER_KEY) || '');
  const update = (key: string, value: string) => { localStorage.setItem(key, value); applyBackgrounds(); };
  return <section className='settings-card'>
    <div className='settings-head'><h2>背景设置</h2><button onClick={() => { setHome(''); setReader(''); update(HOME_KEY, ''); update(READER_KEY, ''); }}>恢复默认</button></div>
    <label className='field'><span>主页背景图 URL</span><input value={home} onChange={e => { setHome(e.target.value); update(HOME_KEY, e.target.value); }} placeholder='https://…' /></label>
    <label className='field'><span>阅读器背景图 URL</span><input value={reader} onChange={e => { setReader(e.target.value); update(READER_KEY, e.target.value); }} placeholder='https://…' /></label>
    <small>保存在当前设备；清空输入即可恢复默认背景。</small>
  </section>;
}
