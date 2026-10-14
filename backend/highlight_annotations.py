"""Annotation writes with optional highlight-only records, using the existing schema."""
import hashlib
import re
import time
from datetime import datetime, timezone


def save_annotation(conn, book_id, data):
    text = (data.get('text') or '').strip()
    quote = data.get('quote')
    chapter = int(data.get('chapterIndex') or 1)
    paragraph = data.get('paragraphIndex')
    author = data.get('author') or 'ai'
    if not text:
        if data.get('kind') != 'highlight' or not isinstance(quote, str) or not quote.strip():
            raise ValueError('text is required unless saving a quoted highlight')
        if chapter < 1 or isinstance(paragraph, bool) or not isinstance(paragraph, int) or paragraph < 0:
            raise ValueError('a highlight requires a valid chapter and paragraph')
        quote = re.sub(r'\s+', ' ', quote).strip()
        if not conn.in_transaction:
            conn.execute('BEGIN IMMEDIATE')
        existing = conn.execute(
            "select id, created_at from annotations where book_id = ? and chapter_index = ? "
            "and paragraph_index = ? and quote = ? and author = ? and text = '' limit 1",
            (book_id, chapter, paragraph, quote, author),
        ).fetchone()
        if existing:
            return {'ok': True, 'id': existing[0], 'createdAt': existing[1]}
    annotation_id = data.get('id') or hashlib.sha1(f'{book_id}-{chapter}-{text}-{time.time_ns()}'.encode()).hexdigest()[:16]
    timestamp = datetime.now(timezone.utc).isoformat()
    conn.execute(
        'insert into annotations (id, book_id, chapter_index, paragraph_index, quote, text, author, created_at) '
        'values (?, ?, ?, ?, ?, ?, ?, ?)',
        (annotation_id, book_id, chapter, paragraph, quote, text, author, timestamp),
    )
    return {'ok': True, 'id': annotation_id, 'createdAt': timestamp}
