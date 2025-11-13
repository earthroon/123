// [ΔK] NumberParser — Super/Notion-compatible block parser
(() => {

  const BLOCK_SELECTOR = ".notion-text, .notion-callout, .notion-page-content, .super-content";
  const REGEX = /\[(\d+)\]([\s\S]*?)\[\/\1\]/gs;

  function parseBlock(block) {
    // 1. 블록 내 텍스트를 “연결된 하나의 스트림”으로 추출
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let raw = "";

    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
      raw += walker.currentNode.textContent;
    }

    if (!REGEX.test(raw)) return;  // 패턴 없으면 skip
    REGEX.lastIndex = 0;

    // 2. 블록 전체 내용 제거
    while (block.firstChild) block.removeChild(block.firstChild);

    // 3. 패턴 기반으로 노드 재구성
    let last = 0;
    let match;

    while ((match = REGEX.exec(raw)) !== null) {
      const [full, num, text] = match;

      // 앞부분
      if (match.index > last) {
        block.appendChild(document.createTextNode(raw.slice(last, match.index)));
      }

      // <span class="supernum">200</span>
      const numEl = document.createElement("span");
      numEl.className = "supernum";
      numEl.textContent = num;

      // <span class="supernum-text">내용</span>
      const txtEl = document.createElement("span");
      txtEl.className = "supernum-text";
      txtEl.textContent = text;

      block.append(numEl, txtEl);
      last = match.index + full.length;
    }

    // 4. 마지막 남은 텍스트
    if (last < raw.length) {
      block.appendChild(document.createTextNode(raw.slice(last)));
    }
  }

  function runParser() {
    document.querySelectorAll(BLOCK_SELECTOR).forEach(parseBlock);
  }

  // DOM 준비되면 1회 실행
  if (document.readyState !== "loading") runParser();
  else document.addEventListener("DOMContentLoaded", runParser);

  // Super 특성: 페이지 변화 시도 감지
  const obs = new MutationObserver(() => runParser());
  obs.observe(document.body, { childList: true, subtree: true });

})();
