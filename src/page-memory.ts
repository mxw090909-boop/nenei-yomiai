import { useLayoutEffect, useRef, useState } from 'react';

export function useRemembered<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? initial; } catch { return initial; }
  });
  const update = (next: T) => {
    setValue(next);
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Memory still works in this view. */ }
  };
  return [value, update] as const;
}

export function usePagePosition(key: string, ready = true) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !ready) return;
    let top = 0;
    try { top = Number(sessionStorage.getItem(key)) || 0; } catch { /* Start at the top. */ }
    node.scrollTop = top;
    const save = () => { try { sessionStorage.setItem(key, String(node.scrollTop)); } catch { /* Optional view state. */ } };
    node.addEventListener('scroll', save, { passive: true });
    return () => { node.removeEventListener('scroll', save); };
  }, [key, ready]);
  return ref;
}

type Note = { id: string; bookId: string; chapterIndex: number; paragraphIndex?: number; quote?: string; createdAt: string };
export function groupNotes<T extends Note>(notes: T[]) {
  const groups = new Map<string, T[]>();
  for (const note of notes) {
    const key = note.quote?.trim() && note.paragraphIndex != null
      ? JSON.stringify([note.bookId, note.chapterIndex, note.paragraphIndex, note.quote.trim()]) : note.id;
    const group = groups.get(key) || [];
    group.push(note); groups.set(key, group);
  }
  return [...groups.entries()].map(([key, entries]) => ({ key, entries: entries.sort((a,b) => Date.parse(a.createdAt)-Date.parse(b.createdAt)) }));
}
