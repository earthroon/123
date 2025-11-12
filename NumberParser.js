// [ΔK] Super Notion Number Parser — inline-safe + responsive + styled
(() => {
  const parseSuperNumbers = () => {
    const blocks = document.querySelectorAll(
      ".notion-text, .notion-callout, .notion-page-content, .super-content"
    );
    const pattern = /\[(\d+)\](.*?)\[\/\1\]/g;

    blocks.forEach(block => {
      if (block.dataset.superParsed) return;
      block.dataset.superParsed = "true";

      block.innerHTML = block.innerHTML.replace(pattern, (m, num, text) => {
        return `
          <span class="supernum">${num}</span>
          <span class="supernum-text">${text}</span>
        `;
      });
    });
  };

  // 최초 실행
  if (document.readyState !== "loading") parseSuperNumbers();
  else document.addEventListener("DOMContentLoaded", parseSuperNumbers);

  // SPA 환경 감시 (Super 전용)
  const observer = new MutationObserver(() => parseSuperNumbers());
  observer.observe(document.body, { childList: true, subtree: true });
})();
