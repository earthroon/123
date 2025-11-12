// filename: superNumberParser.js
// [ΔK] Super Notion Number Parser — responsive & true inline-safe
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
        return `<span style="display:inline;font-weight:700;font-size:clamp(1.4rem,3vw,2.8rem);line-height:1.2;vertical-align:middle;margin-right:0.15em;white-space:nowrap;">${num}</span><span style="display:inline;font-weight:700;font-size:clamp(1.2rem,2.6vw,2.2rem);line-height:1.2;white-space:nowrap;">${text}</span>`;
      });
    });
  };

  if (document.readyState !== "loading") parseSuperNumbers();
  else document.addEventListener("DOMContentLoaded", parseSuperNumbers);

  const observer = new MutationObserver(() => parseSuperNumbers());
  observer.observe(document.body, { childList: true, subtree: true });
})();
