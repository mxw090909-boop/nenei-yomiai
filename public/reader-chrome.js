(() => {
  let frame = null;
  let reader = null;
  let meter = null;
  let meterThumb = null;
  let meterHideTimer = null;
  let lastTop = 0;
  let lockedScrollTop = null;
  let lockUntil = 0;

  const isTyping = () => {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  const hasOpenLayer = () => Boolean(document.querySelector('.reader-sheet-backdrop, .reader-selection-bar, .search-results'));

  const ensureMeterStyle = () => {
    if (document.getElementById('reader-scroll-meter-style')) return;
    const style = document.createElement('style');
    style.id = 'reader-scroll-meter-style';
    style.textContent = `
      .reader-scroll-meter{position:absolute;right:5px;top:92px;bottom:30px;width:3px;border-radius:999px;pointer-events:none;z-index:60;opacity:0;transition:opacity .24s ease;background:rgba(255,254,250,.08);box-shadow:0 0 0 1px rgba(255,255,255,.10);backdrop-filter:blur(8px) saturate(.9);-webkit-backdrop-filter:blur(8px) saturate(.9)}
      .reader-scroll-meter.is-visible{opacity:1}
      .reader-scroll-meter__thumb{position:absolute;left:0;right:0;top:0;height:28px;min-height:28px;border-radius:999px;background:rgba(255,254,250,.13);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18),0 1px 4px rgba(30,28,24,.045);backdrop-filter:blur(10px) saturate(.82);-webkit-backdrop-filter:blur(10px) saturate(.82);transform:translateY(0)}
      .phone-frame:not(.reader-mode) .reader-scroll-meter{display:none}
      @media (min-width:481px){.reader-scroll-meter{right:7px}}
    `;
    document.head.appendChild(style);
  };

  const ensureMeter = () => {
    ensureMeterStyle();
    if (!frame) return;
    if (meter && meter.parentElement === frame) return;
    meter?.remove();
    meter = document.createElement('div');
    meter.className = 'reader-scroll-meter';
    meter.setAttribute('aria-hidden', 'true');
    meterThumb = document.createElement('div');
    meterThumb.className = 'reader-scroll-meter__thumb';
    meter.appendChild(meterThumb);
    frame.appendChild(meter);
  };

  const updateMeter = (visible = false) => {
    if (!reader || !frame) return;
    ensureMeter();
    if (!meter || !meterThumb) return;
    const maxScroll = Math.max(0, reader.scrollHeight - reader.clientHeight);
    if (maxScroll < 16) {
      meter.classList.remove('is-visible');
      return;
    }
    const trackHeight = meter.clientHeight || Math.max(80, reader.clientHeight - 122);
    const ratio = Math.min(1, Math.max(0, reader.clientHeight / Math.max(reader.scrollHeight, 1)));
    const thumbHeight = Math.max(28, Math.round(trackHeight * ratio));
    const progress = Math.min(1, Math.max(0, reader.scrollTop / maxScroll));
    const top = Math.round((trackHeight - thumbHeight) * progress);
    meterThumb.style.height = `${thumbHeight}px`;
    meterThumb.style.transform = `translateY(${top}px)`;
    if (visible) {
      meter.classList.add('is-visible');
      window.clearTimeout(meterHideTimer);
      meterHideTimer = window.setTimeout(() => meter?.classList.remove('is-visible'), 900);
    }
  };

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
      updateMeter(true);
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

    updateMeter(true);
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
      meter?.remove();
      meter = null;
      meterThumb = null;
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

    ensureMeter();
    updateMeter(false);
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
    if (event.target?.closest?.('.topbar, .reader-top, .reader-tools')) {
      showChrome();
    }
  }, true);

  const observer = new MutationObserver(() => {
    bindReader();
    restoreReaderScroll();
    updateMeter(false);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindReader);
  } else {
    bindReader();
  }

  window.addEventListener('resize', () => updateMeter(false), { passive: true });
  window.setInterval(bindReader, 600);
})();
