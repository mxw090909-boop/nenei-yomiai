type TextRange = { start: number; end: number };
export const normalizeQuote = (quote?: string) => (quote || '').replace(/\s+/gu, ' ').trim();

// Keep source offsets while matching the whitespace-normalized quotes saved by the reader.
function normalizedText(text: string) {
  let value = '';
  const offsets: TextRange[] = [];
  for (const match of text.matchAll(/\s+|\S+/gu)) {
    const start = match.index!;
    if (/^\s/u.test(match[0])) {
      value += ' ';
      offsets.push({ start, end: start + match[0].length });
    } else {
      value += match[0];
      for (let i = 0; i < match[0].length; i++) offsets.push({ start: start + i, end: start + i + 1 });
    }
  }
  return { value, offsets };
}

export function quotedRanges(text: string, quotes: (string | undefined)[]) {
  const source = normalizedText(text);
  const ranges: (TextRange & { quote: string })[] = [];
  for (const quote of quotes) {
    const clean = normalizeQuote(quote);
    if (!clean) {
      ranges.push({ start: 0, end: text.length, quote: text });
      continue;
    }
    let from = 0;
    while (from < source.value.length) {
      const start = source.value.indexOf(clean, from);
      if (start < 0) break;
      const range = { start: source.offsets[start].start, end: source.offsets[start + clean.length - 1].end };
      ranges.push({ ...range, quote: text.slice(range.start, range.end) });
      from = start + clean.length;
    }
  }
  // Legacy notes with an outdated quote still belong to their resolved paragraph.
  if (quotes.length && !ranges.length) ranges.push({ start: 0, end: text.length, quote: text });
  return ranges;
}

export function quoteThreads<T extends { quote?: string }>(text: string, notes: T[]) {
  const groups = new Map<string, { quote: string; notes: T[] }>();
  for (const note of notes) {
    const quote = quotedRanges(text, [note.quote])[0]?.quote || text;
    const key = normalizeQuote(quote);
    const thread = groups.get(key) || { quote, notes: [] };
    thread.notes.push(note);
    groups.set(key, thread);
  }
  return [...groups.values()];
}

export function quoteFragments(text: string, quotes: (string | undefined)[]) {
  const ranges = quotedRanges(text, quotes);
  const boundaries = [...new Set([0, text.length, ...ranges.flatMap(range => [range.start, range.end])])].sort((a,b) => a-b);
  return boundaries.slice(0, -1).map((start, index) => ({
    text: text.slice(start, boundaries[index + 1]),
    quotes: [...new Set(ranges.filter(range => range.start <= start && range.end >= boundaries[index + 1]).map(range => range.quote))],
  }));
}

export function annotatedSegments(text: string, quotes: (string | undefined)[]) {
  const ranges = quotedRanges(text, quotes);
  const merged: TextRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  const segments: { text: string; highlighted: boolean }[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), highlighted: false });
    if (range.end > range.start) segments.push({ text: text.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments;
}

export function markerBaseColor(accent: string) {
  const hex = /^#[\da-f]{6}$/i.test(accent) ? accent : '#111111';
  const rgb = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
  const brightness = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  // Very pale custom themes need deeper ink to remain visible on the reading paper.
  const scale = brightness > 175 ? 175 / brightness : 1;
  return `rgb(${rgb.map(channel => Math.round(channel * scale)).join(', ')})`;
}

export function markerStroke(accent: string, fontSize: number) {
  const color = markerBaseColor(accent);
  const capWidth = Number((fontSize * .4).toFixed(3));
  // Paint the translucent ink ONCE, then cut only the outer nib edges out of it.
  // There are no separately rasterized cap/centre boundaries to leave pale seams
  // (or overlapping translucent layers to make dark seams) at fractional pixels.
  const leftCut = 'M0 0H9.5Q9 0 8.4 1.4L1.1 18.4Q0.5 20 1.8 20H0Z';
  const rightCut = 'M8.5 0H10V20H0.5Q1.4 20 2 18.6L9.3 1.6Q9.9 0 8.5 0Z';
  const result: Record<string, string> = {};
  for (const [state, opacity] of [['idle', .27], ['active', .39]] as const) {
    // Nested SVGs retain font-relative nib widths as the outer viewport stretches
    // to each line fragment. Clamp to half a fragment for very short highlights.
    const nib = (side: 'left' | 'right', path: string) => `<svg x="${side === 'left' ? '0' : '100%'}" width="${capWidth}" height="100%" style="width:min(${capWidth}px,50%)" viewBox="0 0 10 20" preserveAspectRatio="none" overflow="visible"><path d="${path}"${side === 'right' ? ' transform="translate(-10 0)"' : ''} fill="black"/></svg>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><defs><mask id="nib" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" style="mask-type:luminance"><rect width="100%" height="100%" fill="white"/>${nib('left', leftCut)}${nib('right', rightCut)}</mask></defs><rect width="100%" height="100%" fill="${color}" fill-opacity="${opacity}" mask="url(#nib)"/></svg>`;
    result[`--reader-marker-${state}`] = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }
  return result;
}
