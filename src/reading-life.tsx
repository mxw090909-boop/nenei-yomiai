import { useEffect, useState } from 'react';

type Position = { chapterIndex: number; paragraphIndex?: number };
type Note = Position & { id: string; quote?: string; text: string; author: string; createdAt: string };
const read = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
export const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function rememberFarthest(bookId: string, position: Position) {
  const key = `yomiai-farthest-${bookId}`;
  const old = read<Position>(key, { chapterIndex: 0, paragraphIndex: -1 });
  if (position.chapterIndex > old.chapterIndex || (position.chapterIndex === old.chapterIndex && (position.paragraphIndex ?? -1) > (old.paragraphIndex ?? -1))) localStorage.setItem(key, JSON.stringify(position));
}
export function useReadingTime(bookId: string | undefined, active: boolean) {
  useEffect(() => {
    if (!bookId || !active) return;
    let previous = Date.now(), activity = previous;
    let foreground = !document.hidden && document.hasFocus();
    const flush = () => {
      const now = Date.now();
      // Long scheduling gaps indicate a suspended device, not active reading.
      const end = Math.min(now, activity + 180000);
      if (foreground && now - previous < 30000 && end > previous) {
        const key = 'yomiai-reading-time';
        const stats = read<Record<string, Record<string, number>>>(key, {});
        let start = previous;
        while (start < end) {
          const date = new Date(start), day = dayKey(date);
          const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()+1).getTime();
          const stop = Math.min(end, midnight);
          stats[day] ||= {}; stats[day][bookId] = (stats[day][bookId] || 0) + stop - start;
          start = stop;
        }
        localStorage.setItem(key, JSON.stringify(stats));
      }
      previous = now;
    };
    const touch = () => { const now = Date.now(); if (now - activity > 180000) flush(); activity = now; };
    const visibility = () => { flush(); foreground = !document.hidden && document.hasFocus(); previous = activity = Date.now(); };
    const blur = () => { flush(); foreground = false; };
    const focus = () => { previous = activity = Date.now(); foreground = !document.hidden; };
    const timer = window.setInterval(flush, 10000);
    for (const event of ['pointerdown','touchstart','scroll','keydown']) document.addEventListener(event, touch, { capture: true, passive: true });
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur); window.addEventListener('focus', focus); window.addEventListener('pagehide', blur);
    return () => {
      flush(); clearInterval(timer);
      for (const event of ['pointerdown','touchstart','scroll','keydown']) document.removeEventListener(event, touch, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); window.removeEventListener('pagehide', blur);
    };
  }, [bookId, active]);
}
const duration = (ms: number) => ms > 0 && ms < 60000 ? '不足 1 分钟' : `${Math.floor(ms / 60000)} 分钟`;
export function ReadingTime({ bookId }: { bookId: string }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState(() => read<Record<string, Record<string, number>>>('yomiai-reading-time', {}));
  useEffect(() => {
    const refresh = () => setStats(read('yomiai-reading-time', {}));
    refresh(); window.addEventListener('focus', refresh); window.addEventListener('storage', refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh); };
  }, []);
  const today = Object.values(stats[dayKey()] || {}).reduce((a,b)=>a+b,0);
  const week=Array.from({length:7},(_,i)=>{const date=new Date();date.setDate(date.getDate()-6+i);const key=dayKey(date);return {key,date,total:Object.values(stats[key]||{}).reduce((a,b)=>a+b,0)};});
  const max=Math.max(60000,...week.map(day=>day.total));
  return <div className='reading-time'><button onClick={()=>setOpen(!open)} aria-expanded={open}>今天读了 {duration(today)}</button>{open && <div className='time-detail'><p>这本书 · {duration(Object.values(stats).reduce((sum, day)=>sum+(day[bookId] || 0),0))}</p><div className='reading-week'>{week.map(({key,date,total})=><div className={'reading-day'+(key===dayKey()?' today':'')} key={key} aria-label={`${date.getMonth()+1}月${date.getDate()}日，${duration(total)}`}><span>{['日','一','二','三','四','五','六'][date.getDay()]}</span><div className='day-track'><i style={{height:`${total ? Math.max(5,total/max*100):0}%`}} /></div><strong>{total ? Math.max(1,Math.floor(total/60000)) : '—'}</strong><small>{date.getMonth()+1}/{date.getDate()}</small></div>)}</div><small>近七天 · 分钟 · 不足一分钟记作 1</small></div>}</div>;
}
export function DailyQuote({ bookId, title, notes, onOpen, onRead }: { bookId: string; title: string; notes: Note[]; onOpen: (note: Note)=>void; onRead: (notes: Note[])=>void }) {
  const [day, setDay] = useState(dayKey());
  const [chosen, setChosen] = useState('');
  const [open, setOpen] = useState(false);
  const farthest = read<Position>(`yomiai-farthest-${bookId}`, { chapterIndex: 0, paragraphIndex: -1 });
  const eligible = notes.filter(n=>n.quote?.trim() && n.paragraphIndex != null && (n.chapterIndex < farthest.chapterIndex || (n.chapterIndex === farthest.chapterIndex && n.paragraphIndex <= (farthest.paragraphIndex ?? -1))));
  const quoteKey = (n: Note) => `${n.chapterIndex}:${n.paragraphIndex}:${n.quote!.trim()}`;
  const candidates = [...new Map(eligible.map(n=>[quoteKey(n),n])).values()];
  const storageKey = `yomiai-daily-${bookId}`;
  useEffect(()=>{
    const refresh = ()=>setDay(dayKey());
    const timer = window.setInterval(refresh,30000); window.addEventListener('focus',refresh);
    return ()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  const signature = candidates.map(quoteKey).sort().join('|');
  useEffect(()=>{
    const saved = read<{day:string;quote:string}>(storageKey,{day:'',quote:''});
    const next = saved.day===day && candidates.some(n=>quoteKey(n)===saved.quote) ? saved.quote : candidates.length ? quoteKey(candidates[Math.floor(Math.random()*candidates.length)]) : '';
    setChosen(next);setOpen(false);
    if(next) localStorage.setItem(storageKey,JSON.stringify({day,quote:next}));
  },[bookId,day,signature]);
  const quote = candidates.find(n=>quoteKey(n)===chosen);
  if(!quote) return null;
  const thread = eligible.filter(n=>quoteKey(n)===chosen).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
  return <section className='daily-quote'><div className='daily-heading'><span>今日摘句</span>{candidates.length>1 && <button onClick={()=>{const other=candidates.filter(n=>quoteKey(n)!==chosen);const next=quoteKey(other[Math.floor(Math.random()*other.length)]);setChosen(next);setOpen(false);localStorage.setItem(storageKey,JSON.stringify({day,quote:next}));}}>换一句</button>}</div><button className='quote-open' aria-label='查看这句的页边' onClick={()=>{setOpen(true);onRead(thread);}}><blockquote>{quote.quote}</blockquote><span>《{title}》</span></button>{open && <div className='reader-sheet-backdrop' onClick={()=>setOpen(false)}><section className='reader-annotation-sheet daily-sheet' role='dialog' aria-modal='true' aria-label='这句的页边' onClick={e=>e.stopPropagation()}><div className='daily-heading'><span>页边</span><button autoFocus onClick={()=>setOpen(false)} aria-label='关闭页边'>×</button></div><blockquote>{quote.quote}</blockquote>{thread.map(note=><article className='thread-note' data-author={note.author} key={note.id}><strong>{note.author==='ai'?'Elior':'Nenei'}</strong><p>{note.text}</p></article>)}<button className='text-button' onClick={()=>onOpen(quote)}>回到原文</button></section></div>}</section>;
}
