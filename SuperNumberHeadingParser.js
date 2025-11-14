// SuperNumberHeadingParser.js
(() => {

  const REGEX = /\[(\d+)\](.*?)\[\/\1\]/g;

  function replaceInTextNode(node) {
    const text = node.textContent;
    let match, last = 0;
    const frags = [];

    while ((match = REGEX.exec(text)) !== null) {
      const [full, num, content] = match;

      if (match.index > last) {
        frags.push(document.createTextNode(text.slice(last, match.index)));
      }

      const wrap = document.createElement("span");
      wrap.className = "super-num-heading";

      const numEl = document.createElement("span");
      numEl.className = "super-num-heading-number";
      numEl.textContent = num;

      const contentEl = document.createElement("span");
      contentEl.className = "super-num-heading-content";
      contentEl.textContent = content;

      wrap.appendChild(numEl);
      wrap.appendChild(contentEl);
      frags.push(wrap);

      last = match.index + full.length;
    }

    if (last < text.length) {
      frags.push(document.createTextNode(text.slice(last)));
    }

    if (frags.length > 0) {
      const parent = node.parentNode;
      frags.forEach(f => parent.insertBefore(f, node));
      parent.removeChild(node);
    }
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (REGEX.test(node.textContent)) replaceInTextNode(node);
      return;
    }
    node.childNodes.forEach(walk);
  }

  document.addEventListener("DOMContentLoaded", () => {
    walk(document.body);
  });

})();
