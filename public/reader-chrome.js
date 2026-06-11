(() => {
  let frame = null;
  let reader = null;
  let lastTop = 0;
  let lockedScrollTop = null;
  let lockUntil = 0;

  const isTyping = () => {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  const hasOpenLayer = () => Boolean(document.querySelector('.reader-sheet-backdrop, .reader-selection-bar, .search-results'));

  const showChrome = () => {
    frame?.classList.remove('reader-chrome-hidden');
  };

  const hideChrome = () => {
    if (isTyping() || hasOpenLayer()) return;
    frame?.classList.add('reader-chrome-hidden');
  };

  const rememberReaderScroll = () => {
    const currentReader = document.querySelector('.reader-screen');
    if (!currentReader) return;
    lockedScrollTop = currentReader.scrollTop;
    lockUntil = Date.now() + 420;
  };

  const restoreReaderScroll = () => {
    if (lockedScrollTop == null || Date.now() > lockUntil) return;
    const currentReader = document.querySelector('.reader-screen');
    if (!currentReader) return;
    if (Math.abs(currentReader.scrollTop - lockedScrollTop) > 1) {
      currentReader.scrollTop = lockedScrollTop;
      lastTop = lockedScrollTop;
    }
  };

  const restoreReaderScrollSoon = () => {
    window.requestAnimationFrame(restoreReaderScroll);
    window.setTimeout(restoreReaderScroll, 80);
    window.setTimeout(() => {
      restoreReaderScroll();
      lockedScrollTop = null;
    }, 220);
  };

  const onScroll = () => {
    if (!reader || !frame) return;
    restoreReaderScroll();

    const top = reader.scrollTop;
    const delta = top - lastTop;

    if (top < 24) {
      showChrome();
    } else if (delta > 10) {
      hideChrome();
    } else if (delta < -6) {
      showChrome();
    }

    lastTop = reader.scrollTop;
  };

  const bindReader = () => {
    const nextFrame = document.querySelector('.phone-frame');
    const nextReader = document.querySelector('.reader-screen');
    if (!nextFrame) return;

    if (!nextReader) {
      if (reader) reader.removeEventListener('scroll', onScroll);
      reader = null;
      frame = nextFrame;
      frame.classList.remove('reader-mode', 'reader-chrome-hidden');
      return;
    }

    frame = nextFrame;
    frame.classList.add('reader-mode');

    if (reader !== nextReader) {
      if (reader) reader.removeEventListener('scroll', onScroll);
      reader = nextReader;
      lastTop = reader.scrollTop;
      reader.addEventListener('scroll', onScroll, { passive: true });
    }

    if (reader.scrollTop < 24) showChrome();
  };

  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (target?.closest?.('.reader-paragraph, .paragraph-note-dot, .reader-selection-bar')) {
      rememberReaderScroll();
    }
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target?.closest?.('.reader-paragraph, .paragraph-note-dot, .reader-selection-bar')) {
      restoreReaderScrollSoon();
    }
  }, true);

  document.addEventListener('focusin', showChrome, true);
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('.topbar, .reader-top, .reader-tools, .reader-selection-bar, .reader-sheet-backdrop')) {
      showChrome();
    }
  }, true);

  const observer = new MutationObserver(() => {
    bindReader();
    restoreReaderScroll();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindReader);
  } else {
    bindReader();
  }

  window.setInterval(bindReader, 600);
})();
