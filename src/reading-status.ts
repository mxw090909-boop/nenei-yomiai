export function readingStatus(current: '未读' | '正在读' | '已读', chapter: number, chapterCount: number, pastFirstScreen: boolean, atEnd: boolean): '未读' | '正在读' | '已读' {
  if (current === '已读' || (chapter === chapterCount && atEnd)) return '已读';
  if (current === '正在读' || chapter > 1 || pastFirstScreen) return '正在读';
  return '未读';
}
