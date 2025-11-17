// SuperBoxParser.js
// [box]텍스트[/box] → 카드형 단락으로 변환

(() => {
  const BOX_REGEX = /\[box\]([\s\S]*?)\[\/box\]/g;

  function parseTextNode(node) {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent;
    if (!BOX_REGEX.test(text)) return;

    // regex 다시 초기화
    BOX_REGEX.lastIndex = 0;

    const parent = node.parentNode;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = BOX_REGEX.exec(text)) !== null) {
      const full = match[0];
      const content = match[1];

      // 앞부분 텍스트 유지
      if (match.index > lastIndex) {
        const before = text.slice(lastIndex, match.index);
        if (before.trim().length > 0) {
          frag.appendChild(document.createTextNode(before));
        }
      }

      // 카드 블록 생성
      const block = document.createElement("div");
      block.className = "dk-box-block";

      const inner = document.createElement("div");
      inner.className = "dk-box-inner";
      inner.textContent = content.trim();

      block.appendChild(inner);
      frag.appendChild(block);

      lastIndex = BOX_REGEX.lastIndex;
    }

    // 뒷부분 텍스트 유지
    const after = text.slice(lastIndex);
    if (after.trim().length > 0) {
      frag.appendChild(document.createTextNode(after));
    }

    parent.replaceChild(frag, node);
  }

  function walk(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    // 자식 먼저 스캔
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        parseTextNode(child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  }

  function runParser() {
    const roots = document.querySelectorAll(".super-content, .notion-page-content");
    roots.forEach(root => walk(root));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runParser);
  } else {
    runParser();
  }
})();
