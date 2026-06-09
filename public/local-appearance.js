(() => {
  const ICON_URL = 'https://i.postimg.cc/bN9B2NCy/IMG-8526.png';
  const keys = {
    eliorName: 'nenei-yomiai-elior-name',
    eliorAvatar: 'nenei-yomiai-elior-avatar',
    neneiName: 'nenei-yomiai-nenei-name',
    neneiAvatar: 'nenei-yomiai-nenei-avatar',
    homeBg: 'nenei-yomiai-home-bg',
    readerBg: 'nenei-yomiai-reader-bg',
  };
  const defaults = { eliorName: 'Elior', neneiName: 'Nenei' };
  const wired = new WeakSet();

  const get = (key, fallback = '') => localStorage.getItem(key) ?? fallback;
  const set = (key, value) => {
    const next = String(value || '').trim();
    if (next) localStorage.setItem(key, next);
    else localStorage.removeItem(key);
  };

  const setReactInputValue = (input, value) => {
    if (!input || input.value === value) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const paintAvatar = (node, name, avatar) => {
    if (!node) return;
    const letter = (name || '?').trim().slice(0, 1).toUpperCase() || '?';
    node.style.backgroundImage = avatar ? `url("${avatar}")` : '';
    node.style.backgroundSize = avatar ? 'cover' : '';
    node.style.backgroundPosition = avatar ? 'center' : '';
    node.style.color = avatar ? 'transparent' : '';
    node.textContent = avatar ? '' : letter;
    if (node.tagName === 'IMG') {
      node.src = avatar || ICON_URL;
      node.alt = name;
    }
  };

  const applyIdentity = () => {
    const eliorName = get(keys.eliorName, defaults.eliorName);
    const neneiName = get(keys.neneiName, defaults.neneiName);
    const eliorAvatar = get(keys.eliorAvatar);
    const neneiAvatar = get(keys.neneiAvatar);

    document.querySelectorAll('.identity-mini .avatar').forEach((node, index) => {
      paintAvatar(node, index === 0 ? eliorName : neneiName, index === 0 ? eliorAvatar : neneiAvatar);
    });

    document.querySelectorAll('.pair-card .avatar').forEach((node, index) => {
      paintAvatar(node, index === 0 ? eliorName : neneiName, index === 0 ? eliorAvatar : neneiAvatar);
    });

    const editors = Array.from(document.querySelectorAll('.person-editor'));
    editors.forEach((editor) => {
      const title = editor.querySelector('h2')?.textContent?.trim().toLowerCase() || '';
      const inputs = editor.querySelectorAll('input');
      const isElior = title.includes('elior');
      const nameKey = isElior ? keys.eliorName : keys.neneiName;
      const avatarKey = isElior ? keys.eliorAvatar : keys.neneiAvatar;
      const defaultName = isElior ? defaults.eliorName : defaults.neneiName;

      setReactInputValue(inputs[0], get(nameKey, defaultName));
      setReactInputValue(inputs[1], get(avatarKey));

      if (!wired.has(editor)) {
        wired.add(editor);
        inputs[0]?.addEventListener('input', () => {
          set(nameKey, inputs[0].value || defaultName);
          applyIdentity();
        });
        inputs[1]?.addEventListener('input', () => {
          set(avatarKey, inputs[1].value);
          applyIdentity();
        });
      }
    });
  };

  const applyBackgrounds = () => {
    const root = document.documentElement;
    const homeBg = get(keys.homeBg);
    const readerBg = get(keys.readerBg);
    root.style.setProperty('--yomiai-home-bg', homeBg ? `url("${homeBg}")` : 'none');
    root.style.setProperty('--yomiai-reader-bg', readerBg ? `url("${readerBg}")` : 'none');
    root.classList.toggle('has-yomiai-home-bg', Boolean(homeBg));
    root.classList.toggle('has-yomiai-reader-bg', Boolean(readerBg));
  };

  const buildAppearanceCard = () => {
    const settings = document.querySelector('.settings-screen');
    if (!settings || settings.querySelector('#local-appearance-card')) return;

    const card = document.createElement('section');
    card.className = 'settings-card local-appearance-card';
    card.id = 'local-appearance-card';
    card.innerHTML = `
      <div class="settings-head"><h2>本地外观</h2><button class="text-button" type="button" data-reset-bg>恢复默认</button></div>
      <label class="field"><span>主页背景图 URL</span><input data-home-bg placeholder="https://..." /></label>
      <label class="field"><span>阅读器背景图 URL</span><input data-reader-bg placeholder="https://..." /></label>
      <small>头像、背景都只保存在当前设备。阅读器背景会自动加米白遮罩，不抢正文。</small>
    `;

    const insertAfter = settings.querySelectorAll('.settings-card')[1] || settings.querySelector('.pair-card');
    insertAfter?.after(card);

    const homeInput = card.querySelector('[data-home-bg]');
    const readerInput = card.querySelector('[data-reader-bg]');
    homeInput.value = get(keys.homeBg);
    readerInput.value = get(keys.readerBg);

    homeInput.addEventListener('input', () => {
      set(keys.homeBg, homeInput.value);
      applyBackgrounds();
    });
    readerInput.addEventListener('input', () => {
      set(keys.readerBg, readerInput.value);
      applyBackgrounds();
    });
    card.querySelector('[data-reset-bg]')?.addEventListener('click', () => {
      localStorage.removeItem(keys.homeBg);
      localStorage.removeItem(keys.readerBg);
      homeInput.value = '';
      readerInput.value = '';
      applyBackgrounds();
    });
  };

  const applyIconLinks = () => {
    const selectors = ['link[rel="icon"]', 'link[rel="apple-touch-icon"]'];
    selectors.forEach((selector) => document.querySelectorAll(selector).forEach((link) => link.setAttribute('href', ICON_URL)));
  };

  const refresh = () => {
    applyIconLinks();
    applyBackgrounds();
    applyIdentity();
    buildAppearanceCard();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
  else refresh();

  new MutationObserver(refresh).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(refresh, 900);
})();
