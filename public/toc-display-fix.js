(() => {
  const bodyTitlePattern = /^第\s*[一二三四五六七八九十百千万零〇两\d]+\s*[章节回卷部]/;
  const emptyGeneratedPattern = /^第\s*\d+\s*章$/;

  const normalizeTitle = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const readCount = (value) => {
    const match = String(value || '').match(/(\d+)\s*段/);
    return match ? Number(match[1]) : 0;
  };

  const fixToc = () => {
    const list = document.querySelector('.chapter-list');
    if (!list) return;

    let bodyCount = 0;
    const rows = Array.from(list.querySelectorAll('button'));
    rows.forEach((row) => {
      const label = row.querySelector('span');
      const titleNode = row.querySelector('strong');
      const countNode = row.querySelector('small');
      const title = normalizeTitle(titleNode?.textContent);
      const paragraphCount = readCount(countNode?.textContent);

      if (!label || !titleNode) return;

      if (paragraphCount === 0 && emptyGeneratedPattern.test(title)) {
        row.style.display = 'none';
        return;
      }

      row.style.display = '';
      if (bodyTitlePattern.test(title)) {
        bodyCount += 1;
        label.textContent = `第 ${bodyCount} 章`;
      } else if (bodyCount === 0) {
        label.textContent = '前置';
      } else {
        label.textContent = '附录';
      }
    });
  };

  const fixReaderHeading = () => {
    const paper = document.querySelector('.reading-paper');
    if (!paper) return;
    const chapterLabel = paper.querySelector('p.chapter');
    const title = normalizeTitle(paper.querySelector('h1')?.textContent);
    if (!chapterLabel || !title) return;

    if (bodyTitlePattern.test(title)) {
      chapterLabel.textContent = title;
    } else if (!bodyTitlePattern.test(title)) {
      chapterLabel.textContent = '前置';
    }
  };

  const fix = () => {
    fixToc();
    fixReaderHeading();
  };

  const observer = new MutationObserver(fix);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fix);
  } else {
    fix();
  }

  window.setInterval(fix, 700);
})();
