/* ==========================
   NotePulse.js — 감응 주석 렌더러
   by VARUN & ChatGPT
   ========================== */
(() => {
  const root = document.querySelector('.super-content') || document.body;
  if (!root) return;

  const REGEX = /(\S+?)\{([!?#])?([^{}]+)\}/g;
  const TYPE_MAP = {
    '!': { icon: '❣', color: '#D95D5D', bg: '#FFF0F0' },
    '?': { icon: '？', color: '#A2603C', bg: '#FFF8EE' },
    '#': { icon: '※', color: '#4470C4', bg: '#EEF3FF' },
    default: { icon: '·', color: '#444', bg: '#F8F8F8' }
  };

  const t0 = performance.now();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    const txt = node.textContent;
    if (!REGEX.test(txt)) continue;
    const span = document.createElement('span');
    span.innerHTML = txt.replace(REGEX, (_, word, type, note) => {
      const t = TYPE_MAP[type] || TYPE_MAP.default;
      return `${word}<span class="note-pulse" 
        data-note="${note.trim()}" 
        data-type="${type || ''}" 
        style="--note-color:${t.color};--note-bg:${t.bg}">${t.icon}</span>`;
    });
    node.replaceWith(...span.childNodes);
  }
  console.info(`[NotePulse] rendered ${(performance.now()-t0).toFixed(1)}ms`);
})();
