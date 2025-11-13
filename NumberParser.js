// [ΔK] NumberParser — true DOM-safe parser (Super-safe, weak authority)
(() => {
  function parseNode(node) {
    if (node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent;
    // 핵심 수정 → 개행·다중라인 대응
    const regex = /\[(\d+)\]([\s\S]*?)\[\/\1\]/g;

    let match;
    const fragments = [];
    let lastIndex = 0;

    while ((match = regex.exec(text)) !== null) {
      const [full, num, content] = match;

      if (match.index > lastIndex) {
        fragments.push(
          document.createTextNode(text.slice(lastIndex, match.index))
        );
      }

      const numEl = document.createElement("span");
      numEl.className = "supernum";
      numEl.textContent = num;

      const textEl = document.createElement("span");
      textEl.className = "supernum-text";
      textEl.textContent = content;

      fragments.push(numEl, textEl);

      lastIndex = match.index + full.length;
    }

    if (fragments.length) {
      if (lastIndex < text.length) {
        fragments.push(document.createTextNode(text.slice(lastIndex)));
      }

      const parent = node.parentNode;
      fragments.forEach(f => parent.insertBefore(f, node));
      parent.removeChild(node);
    }
  }

  function traverse(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(parseNode);
  }

  function runParser() {
    const targets = document.querySelectorAll(
      ".notion-text, .notion-callout, .notion-page-content, .super-content"
    );
    targets.forEach(traverse);
  }

  // 초기 실행
  if (document.readyState !== "loading") runParser();
  else document.addEventListener("DOMContentLoaded", runParser);

  // MutationObserver — 약한 버전 그대로 유지
  const observer = new MutationObserver(() => runParser());
  observer.observe(document.body, { childList: true, subtree: true });
})();
