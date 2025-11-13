// superNumberHeading_v2.js
// 블록 안전형 파서: {1} ... {/1} 내부의 정규식 패턴은 전부 raw로 보존.
// Super의 텍스트 파편화 문제를 우회하기 위해 전체 텍스트 스트림 기반.

(() => {

  // 블록 캡처용 정규식: 내부는 어떤 문자든 포용 (non-greedy)
  const blockRegex = /\{(\d+)\}([\s\S]*?)\{\/\1\}/g;

  function process(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let fullText = "";
    const nodes = [];

    // 1) 텍스트 노드를 전부 수집해 하나의 스트림으로 결합
    while (walker.nextNode()) {
      const n = walker.currentNode;
      nodes.push(n);
      fullText += n.textContent;
    }

    // 2) 이제 fullText에서 블록만 치환하고, 내부 패턴은 그대로 둔다.
    const parts = [];
    let lastIndex = 0;

    fullText.replace(blockRegex, (match, num, content, offset) => {
      // 블록 이전 텍스트
      if (offset > lastIndex) parts.push({ type: 'text', value: fullText.slice(lastIndex, offset) });

      // 치환된 블록
      parts.push({
        type: 'block',
        num,
        content: content.trim()   // 내용 정리
      });

      lastIndex = offset + match.length;
    });

    // 마지막 텍스트 조각
    if (lastIndex < fullText.length) {
      parts.push({ type: 'text', value: fullText.slice(lastIndex) });
    }

    // 3) 스트림을 기반으로 새 DOM 조립
    const frag = document.createDocumentFragment();

    for (const p of parts) {
      if (p.type === 'text') {
        frag.appendChild(document.createTextNode(p.value));
      } else {
        // 블록 렌더링
        const wrap = document.createElement("div");
        wrap.className = "superheading";

        const numEl = document.createElement("span");
        numEl.className = "sh-num";
        numEl.textContent = p.num + ".";

        const txtEl = document.createElement("span");
        txtEl.className = "sh-text";
        txtEl.textContent = p.content;

        wrap.appendChild(numEl);
        wrap.appendChild(txtEl);
        frag.appendChild(wrap);
      }
    }

    // 4) 모든 기존 텍스트 노드 제거 후, 새 DOM 삽입
    for (const n of nodes) {
      n.parentNode && n.parentNode.removeChild(n);
    }
    root.appendChild(frag);
  }

  document.addEventListener("DOMContentLoaded", () => process(document.body));

})();
