// superNumberHeading.js — JS Driver Version (with () syntax)
// (1)제목(/1) → <div class="superheading"><span class="sh-num">1.</span><span class="sh-text">제목</span></div>

(function () {

  // (1) ... (/1)
  const blockRegex = /\((\d+)\)([\s\S]*?)\(\s*\/\1\s*\)/g;

  function parseIntoParts(textStream) {
    const parts = [];
    let last = 0;

    textStream.replace(blockRegex, (full, num, content, offset) => {
      if (offset > last) {
        parts.push({ type: "text", value: textStream.slice(last, offset) });
      }

      parts.push({
        type: "block",
        num,
        content: content.trim()
      });

      last = offset + full.length;
    });

    if (last < textStream.length) {
      parts.push({ type: "text", value: textStream.slice(last) });
    }

    return parts;
  }

  function rebuildDOM(root, parts, textNodes) {
    const frag = document.createDocumentFragment();

    for (const p of parts) {
      if (p.type === "text") {
        frag.appendChild(document.createTextNode(p.value));
        continue;
      }

      const wrap = document.createElement("div");
      wrap.className = "superheading";

      const numEl = document.createElement("span");
      numEl.className = "sh-num";
      numEl.textContent = `${p.num}.`;

      const textEl = document.createElement("span");
      textEl.className = "sh-text";
      textEl.textContent = p.content;

      wrap.appendChild(numEl);
      wrap.appendChild(textEl);
      frag.appendChild(wrap);
    }

    // 기존 텍스트 노드 제거
    for (const n of textNodes) {
      n.parentNode && n.parentNode.removeChild(n);
    }

    // 새 DOM 삽입
    root.appendChild(frag);
  }

  function process(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let textStream = "";
    const textNodes = [];

    while (walker.nextNode()) {
      const n = walker.currentNode;
      textNodes.push(n);
      textStream += n.textContent;
    }

    const parts = parseIntoParts(textStream);
    rebuildDOM(root, parts, textNodes);
  }

  window.SuperNumberHeadingDriver = {
    init(root = document.body) {
      process(root);
    }
  };

})();
