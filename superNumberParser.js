// filename: superNumberParser.js
(() => {
  const parseSuperNumbers = () => {
    const blocks = document.querySelectorAll(
      ".notion-text, .notion-callout, .notion-page-content, .super-content"
    );
    const pattern = /\[(\d+)\](.*?)\[\/\1\]/g;

    blocks.forEach(block => {
      // 이미 변환된 경우 중복 방지
      if (block.dataset.superParsed) return;
      block.dataset.superParsed = "true";

      block.innerHTML = block.innerHTML.replace(pattern, (m, num, text) => {
        return `
          <span style="
            display:inline-block;
            font-weight:700;
            font-size:clamp(1.4rem, 3vw, 2.8rem);
            line-height:1.2;
            vertical-align:middle;
            margin-right:0.15em;
          ">${num}</span>
          <span style="
            font-weight:700;
            font-size:clamp(1.2rem, 2.6vw, 2.2rem);
            line-height:1.2;
          ">${text}</span>
        `;
      });
    });
  };

  // DOM 완전히 로드 후 실행
  if (document.readyState !== "loading") parseSuperNumbers();
  else document.addEventListener("DOMContentLoaded", parseSuperNumbers);

  // 슈퍼가 동적으로 로드될 때도 재실행 (SPA 대응)
  const observer = new MutationObserver(() => parseSuperNumbers());
  observer.observe(document.body, { childList: true, subtree: true });
})();
