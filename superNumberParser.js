// filename: superNumberParser.js
// [ΔK] Super Notion Number Parser — responsive & whitespace-safe
(() => {
  const parseSuperNumbers = () => {
    const blocks = document.querySelectorAll(
      ".notion-text, .notion-callout, .notion-page-content, .super-content"
    );
    const pattern = /\[(\d+)\](.*?)\[\/\1\]/g;

    blocks.forEach(block => {
      // 중복 파싱 방지
      if (block.dataset.superParsed) return;
      block.dataset.superParsed = "true";

      block.innerHTML = block.innerHTML.replace(pattern, (m, num, text) => {
        // inline-block 줄바꿈 버그 방지 → 한 줄로 붙여서 반환
        return `<span style="font-weight:700;font-size:clamp(1.4rem,3vw,2.8rem);line-height:1.2;vertical-align:middle;margin-right:0.15em;white-space:nowrap;">${num}</span><span style="font-weight:700;font-size:clamp(1.2rem,2.6vw,2.2rem);line-height:1.2;white-space:nowrap;">${text}</span>`;
      });
    });
  };

  // DOM 로드 이후 실행
  if (document.readyState !== "loading") parseSuperNumbers();
  else document.addEventListener("DOMContentLoaded", parseSuperNumbers);

  // SPA 환경 대응 — Super의 동적 로드 감지
  const observer = new MutationObserver(() => parseSuperNumbers());
  observer.observe(document.body, { childList: true, subtree: true });
})();
