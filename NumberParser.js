// [ΔK] NumberParser — true DOM-safe parser (no innerHTML rewrite)
(() => {
  function parseNode(node) {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent;
    const regex = /\[(\d+)\](.*?)\[\/\1\]/g;

    let match;
    const fragments = [];
    let lastIndex = 0;

    while ((match = regex.exec(text)) !== null) {
      const [full, num, content] = match;

      // 앞부분 텍스트 유지
      if (match.index > lastIndex) {
        fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      // 숫자 span 생성
      const numEl = document.createElement("span");
      numEl.className = "supernum";
      numEl.textContent = num;

      // 내용 span 생성
      const textEl = document.createElement("span");
      textEl.className = "supernum-text";
      textEl.textContent = content;

      fragments.push(numEl, textEl);
      lastIndex = match.index + full.length;
    }

    if (fragments.length) {
      // 마지막 남은 텍스트
      if (lastIndex < text.length) {
        fragments.push(document.createTextNode(text.slice(lastIndex)));
      }

      // 원래 텍스트노드 교체
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
    const targets = document.querySelectorAll(".notion-text, .notion-callout, .notion-page-content, .super-content");
    targets.forEach(traverse);
  }

  if (document.readyState !== "loading") runParser();
  else document.addEventListener("DOMContentLoaded", runParser);

  const observer = new MutationObserver(() => runParser());
  observer.observe(document.body, { childList: true, subtree: true });
})();
