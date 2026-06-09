(() => {
  try {
    const STYLE_ID = 'bg-settings-preview-style';
    const CARD_ID = 'bg-settings-preview-card';
    const HOME_KEY = 'nenei-yomiai-home-bg-url';
    const READER_KEY = 'nenei-yomiai-reader-bg-url';

    const read = (key) => localStorage.getItem(key) || '';
    const write = (key, value) => {
      const next = String(value || '').trim();
      if (next) localStorage.setItem(key, next);
      else localStorage.removeItem(key);
    };

    const cssUrl = (value) => value ? `url("${String(value).replace(/"/g, '%22')}")` : 'none';

    const applyBackgrounds = () => {
      const homeUrl = read(HOME_KEY);
      const readerUrl = read(READER_KEY);
      const root = document.documentElement;
      root.style.setProperty('--yomiai-home-bg', cssUrl(homeUrl));
      root.style.setProperty('--yomiai-reader-bg', cssUrl(readerUrl));
      root.classList.toggle('has-yomiai-home-bg', Boolean(homeUrl));
      root.classList.toggle('has-yomiai-reader-bg', Boolean(readerUrl));

      const homeThumb = document.querySelector(`#${CARD_ID} [data-home-thumb]`);
      const readerThumb = document.querySelector(`#${CARD_ID} [data-reader-thumb]`);
      if (homeThumb) homeThumb.style.backgroundImage = homeUrl ? `linear-gradient(rgba(255,254,250,.55),rgba(255,254,250,.68)),${cssUrl(homeUrl)}` : '';
      if (readerThumb) readerThumb.style.backgroundImage = readerUrl ? `linear-gradient(rgba(255,254,250,.68),rgba(255,254,250,.78)),${cssUrl(readerUrl)}` : '';
    };

    const ensureStyle = () => {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        #${CARD_ID} small{display:block;margin-top:10px;color:#77726a;font-size:11px;line-height:1.6}
        #${CARD_ID} .bg-preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
        #${CARD_ID} .bg-preview-option{border:1px solid rgba(17,17,17,.14);background:rgba(255,255,255,.68);padding:12px;text-align:left}
        #${CARD_ID} .bg-preview-thumb{height:58px;border:1px solid rgba(17,17,17,.12);margin-bottom:9px;background:linear-gradient(135deg,#fffefa,#e7e2d6);background-size:cover;background-position:center}
        #${CARD_ID} .bg-preview-option:nth-child(2) .bg-preview-thumb{background:linear-gradient(135deg,#f8f5ee,#c9c1ae)}
        #${CARD_ID} .bg-preview-option strong{display:block;font-size:13px}
        #${CARD_ID} .bg-preview-option span{display:block;margin-top:4px;font-size:11px;color:#77726a;line-height:1.45}
        #${CARD_ID} input{width:100%;border:1px solid rgba(17,17,17,.18);border-radius:0;background:#fffefa;padding:13px 12px;outline:none}
        #${CARD_ID} input:focus{border-color:var(--accent)}
        #${CARD_ID} .bg-actions{display:flex;justify-content:flex-end;gap:12px;margin-top:12px}
        #${CARD_ID} .bg-actions button{font-size:13px;color:#3a3631;border-bottom:1px solid var(--accent)}
        .has-yomiai-home-bg .phone-frame::after{content:'';position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,254,250,.70),rgba(255,254,250,.80)),var(--yomiai-home-bg);background-size:cover;background-position:center;filter:grayscale(.18);z-index:0}
        .has-yomiai-home-bg .topbar,.has-yomiai-home-bg .screen,.has-yomiai-home-bg .bottom-nav{position:relative;z-index:2}
        .has-yomiai-reader-bg .reader-screen::before{content:'';position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,254,250,.82),rgba(255,254,250,.92)),var(--yomiai-reader-bg);background-size:cover;background-position:center;filter:grayscale(.12);z-index:0}
        .has-yomiai-reader-bg .reading-paper,.has-yomiai-reader-bg .reader-top,.has-yomiai-reader-bg .reader-tools,.has-yomiai-reader-bg .reader-progress{position:relative;z-index:2}
      `;
      document.head.appendChild(style);
    };

    const ensureCard = () => {
      const settings = document.querySelector('.settings-screen');
      if (!settings || document.getElementById(CARD_ID)) return;
      ensureStyle();

      const card = document.createElement('section');
      card.className = 'settings-card';
      card.id = CARD_ID;
      card.innerHTML = `
        <div class="settings-head"><h2>背景设置</h2><button class="text-button" type="button" data-bg-reset>恢复默认</button></div>
        <div class="bg-preview-grid">
          <div class="bg-preview-option"><div class="bg-preview-thumb" data-home-thumb></div><strong>主页背景</strong><span>用于书架入口和小房间氛围</span></div>
          <div class="bg-preview-option"><div class="bg-preview-thumb" data-reader-thumb></div><strong>阅读器背景</strong><span>加米白遮罩，优先保证正文可读</span></div>
        </div>
        <label class="field"><span>主页背景图 URL</span><input data-home-bg placeholder="https://..." /></label>
        <label class="field"><span>阅读器背景图 URL</span><input data-reader-bg placeholder="https://..." /></label>
        <small>保存在当前设备的浏览器里；换设备不会同步。清空输入框即可取消对应背景。</small>
      `;

      const cards = settings.querySelectorAll('.settings-card');
      const anchor = cards[1] || cards[0] || settings.querySelector('.pair-card');
      if (anchor) anchor.after(card);
      else settings.appendChild(card);

      const homeInput = card.querySelector('[data-home-bg]');
      const readerInput = card.querySelector('[data-reader-bg]');
      homeInput.value = read(HOME_KEY);
      readerInput.value = read(READER_KEY);

      homeInput.addEventListener('input', () => {
        write(HOME_KEY, homeInput.value);
        applyBackgrounds();
      });
      readerInput.addEventListener('input', () => {
        write(READER_KEY, readerInput.value);
        applyBackgrounds();
      });
      card.querySelector('[data-bg-reset]')?.addEventListener('click', () => {
        localStorage.removeItem(HOME_KEY);
        localStorage.removeItem(READER_KEY);
        homeInput.value = '';
        readerInput.value = '';
        applyBackgrounds();
      });
      applyBackgrounds();
    };

    const tick = () => {
      try {
        ensureStyle();
        applyBackgrounds();
        ensureCard();
      } catch (error) {
        console.warn('background settings skipped', error);
      }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
    else tick();
    window.setInterval(tick, 1200);
  } catch (error) {
    console.warn('background settings disabled', error);
  }
})();
