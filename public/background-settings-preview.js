(() => {
  try {
    const STYLE_ID = 'bg-settings-preview-style';
    const CARD_ID = 'bg-settings-preview-card';

    const ensureStyle = () => {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        #${CARD_ID} small{display:block;margin-top:10px;color:#77726a;font-size:11px;line-height:1.6}
        #${CARD_ID} .bg-preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
        #${CARD_ID} .bg-preview-option{border:1px solid rgba(17,17,17,.14);background:rgba(255,255,255,.68);padding:12px;text-align:left}
        #${CARD_ID} .bg-preview-thumb{height:58px;border:1px solid rgba(17,17,17,.12);margin-bottom:9px;background:linear-gradient(135deg,#fffefa,#e7e2d6)}
        #${CARD_ID} .bg-preview-option:nth-child(2) .bg-preview-thumb{background:linear-gradient(135deg,#f8f5ee,#c9c1ae)}
        #${CARD_ID} .bg-preview-option strong{display:block;font-size:13px}
        #${CARD_ID} .bg-preview-option span{display:block;margin-top:4px;font-size:11px;color:#77726a;line-height:1.45}
        #${CARD_ID} input{width:100%;border:1px solid rgba(17,17,17,.18);border-radius:0;background:#fffefa;padding:13px 12px;outline:none}
        #${CARD_ID} input:focus{border-color:var(--accent)}
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
        <div class="settings-head"><h2>背景设置 · 预览入口</h2><button class="text-button" type="button" disabled>稍后接入</button></div>
        <div class="bg-preview-grid">
          <div class="bg-preview-option"><div class="bg-preview-thumb"></div><strong>主页背景</strong><span>用于书架入口和小房间氛围</span></div>
          <div class="bg-preview-option"><div class="bg-preview-thumb"></div><strong>阅读器背景</strong><span>加米白遮罩，优先保证正文可读</span></div>
        </div>
        <label class="field"><span>主页背景图 URL</span><input placeholder="https://..." disabled /></label>
        <label class="field"><span>阅读器背景图 URL</span><input placeholder="https://..." disabled /></label>
        <small>这一版只放入口预览，不保存、不改背景、不碰本地存储。确认位置和样式后再正式接入。</small>
      `;

      const cards = settings.querySelectorAll('.settings-card');
      const anchor = cards[1] || cards[0] || settings.querySelector('.pair-card');
      if (anchor) anchor.after(card);
      else settings.appendChild(card);
    };

    const tick = () => {
      try { ensureCard(); } catch (error) { console.warn('background settings preview skipped', error); }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
    else tick();
    window.setInterval(tick, 1000);
  } catch (error) {
    console.warn('background settings preview disabled', error);
  }
})();
