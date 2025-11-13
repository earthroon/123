// superNumberHeading.js
// {1}제목{/1}  →  <div class="superheading"><span class="sh-num">1.</span><span class="sh-text">제목</span></div>

(() => {
  const pattern = /\{(\d+)\}(.*?)\{\/\1\}/g;

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      let match, lastIndex = 0;
      const frag = document.createDocumentFragment();

      while ((match = pattern.exec(text)) !== null) {
        const [full, num, content] = match;

        // 앞부분
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        // 치환 블록 생성
        const wrap = document.createElement("div");
        wrap.className = "superheading";

        const numEl = document.createElement("span");
        numEl.className = "sh-num";
        numEl.textContent = num + ".";

        const textEl = document.createElement("span");
        textEl.className = "sh-text";
        textEl.textContent = content;

        wrap.appendChild(numEl);
        wrap.appendChild(textEl);

        frag.appendChild(wrap);

        lastIndex = pattern.lastIndex;
      }

      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      if (frag.childNodes.length) {
        node.replaceWith(frag);
      }
    } else {
      node.childNodes && [...node.childNodes].forEach(walk);
    }
  }

  document.addEventListener("DOMContentLoaded", () => walk(document.body));
})();
