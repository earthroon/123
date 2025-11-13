// [ΔK] NumberParser — Super-safe hydration parser
(() => {

  const SELECTOR = ".notion-text, .notion-callout, .notion-page-content, .super-content";
  const REGEX = /\[(\d+)\]([\s\S]*?)\[\/\1\]/gs;

  function parseBlock(block) {
    // 이미 파싱된 블록은 재파싱 금지
    if (block.dataset._supernumParsed === "1") return;

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let raw = "";

    while (walker.nextNode()) {
      raw += walker.currentNode.textContent;
    }

    if (!REGEX.test(raw)) return;
    REGEX.lastIndex = 0;

    // 기존 내용 제거
    while (block.firstChild) block.removeChild(block.firstChild);

    let last = 0;
    let match;

    while ((match = REGEX.exec(raw)) !== null) {
      const [full, num, text] = match;

      if (match.index > last) {
        block.appendChild(document.createTextNode(raw.slice(last, match.index)));
      }

      const group = document.createElement("span");
      group.className = "supernum-group";

      const n = document.createElement("span");
      n.className = "supernum";
      n.textContent = num;

      const t = document.createElement("span");
      t.className = "supernum-text";
      t.textContent = text;

      group.append(n, t);
      block.appendChild(group);

      last = match.index + full.length;
    }

    if (last < raw.length) {
      block.appendChild(document.createTextNode(raw.slice(last)));
    }

    block.dataset._supernumParsed = "1";
  }

  function runOnce() {
    document.querySelectorAll(SELECTOR).forEach(block => {
      parseBlock(block);

      // 블록 단위로 최소 감시: Super의 재렌더 트리거 시만 재파싱
      observeBlock(block, parseBlock);
    });
  }

  function observeBlock(block, cb) {
    const obs = new MutationObserver(() => cb(block));
    obs.observe(block, { childList: true, subtree: true });
  }

  // Super hydration 완료 시점까지만 대기
  function waitForHydration(cb) {
    const check = () => {
      const root = document.querySelector(".notion-page-content[data-reactroot]");
      if (root) cb();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  waitForHydration(runOnce);

})();
