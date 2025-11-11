/* =====================================================
   NotePulse.js — 감응 주석 렌더러 (Super 전용 / 심플 기호판)
   ===================================================== */
(() => {
  const TYPE_MAP = {
    '!': { icon: '!', color: '#D95D5D', bg: '#FFF0F0' },
    '?': { icon: '?', color: '#A2603C', bg: '#FFF8EE' },
    '#': { icon: '#', color: '#4470C4', bg: '#EEF3FF' },
    default: { icon: '·', color: '#444', bg: '#F8F8F8' }
  };
  const REGEX = /(\S+?)\{([!?#])?([^{}]+)\}/g;

  /** 🔹 메인 렌더 함수 */
  window.NotePulseRender = () => {
    const root = document.querySelector('.super-content') || document.body;
    if (!root) return;

    const t0 = performance.now();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const text = node.textContent;
      if (!REGEX.test(text)) continue;

      const span = document.createElement('span');
      span.innerHTML = text.replace(REGEX, (_, word, type, note) => {
        const t = TYPE_MAP[type] || TYPE_MAP.default;
        return `${word}<span class="note-pulse"
          data-note="${note.trim()}"
          data-type="${type || ''}"
          style="--note-color:${t.color};--note-bg:${t.bg}">${t.icon}</span>`;
      });
      node.replaceWith(...span.childNodes);
    }
    console.info(`[NotePulse] rendered in ${(performance.now()-t0).toFixed(1)}ms`);
  };

  /** 🔹 초기 렌더 */
  window.NotePulseRender();

  /** 🔹 MutationObserver 감지 */
  const observer = new MutationObserver(() => {
    clearTimeout(observer._t);
    observer._t = setTimeout(() => window.NotePulseRender(), 150);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  /** 🔹 SPA 전환 감지 */
  (function(){
    const _push = history.pushState, _replace = history.replaceState;
    const trigger = () => requestAnimationFrame(() => window.NotePulseRender());
    history.pushState = function(){ _push.apply(this, arguments); trigger(); };
    history.replaceState = function(){ _replace.apply(this, arguments); trigger(); };
    window.addEventListener('popstate', trigger);
  })();
})();
