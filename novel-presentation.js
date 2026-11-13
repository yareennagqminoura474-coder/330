(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EPhoneNovelPresentation = api;
})(typeof window === "undefined" ? null : window, function (root) {
  "use strict";
  const previews = new WeakMap();
  const closingQuotes = { "“": "”", "‘": "’", "「": "」", "『": "』", '"': '"' };
  const symbols = { in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇", cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅", forall: "∀", exists: "∃", nexists: "∄", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", times: "×", div: "÷", cdot: "·", pm: "±", mp: "∓", infinity: "∞", infty: "∞", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", leftrightarrow: "↔", land: "∧", lor: "∨", neg: "¬", angle: "∠", perpendicular: "⊥", perp: "⊥", parallel: "∥", alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω" };
  function displayText(value) {
    return String(value ?? "").replace(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|(?<!\\)\$\$([\s\S]*?)\$\$|(?<!\\)\$([^$\n]+)\$/g, (whole, a, b, c, d) => {
      const body = a ?? b ?? c ?? d;
      const commands = [...body.matchAll(/\\([a-zA-Z]+)/g)];
      // Convert supported notation as text, never HTML. Leave unknown formulas
      // intact instead of silently removing their syntax or guessing meaning.
      if (!commands.length || commands.some((m) => !Object.hasOwn(symbols, m[1]))) return whole;
      return body.replace(/\\([a-zA-Z]+)/g, (_, name) => symbols[name]).replace(/\\[,;:]/g, " ").replace(/\\!/g, "");
    });
  }
  function highlightDialogue(element) {
    for (const span of element.querySelectorAll(".gr-dialogue")) span.replaceWith(...span.childNodes);
    const walker = element.ownerDocument.createTreeWalker(element, 4);
    const nodes = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.parentElement.closest(".katex, script, style")) nodes.push(walker.currentNode);
    }
    const stack = [];
    for (const node of nodes) {
      const fragment = element.ownerDocument.createDocumentFragment();
      let buffer = "", dialogue = stack.length > 0;
      const flush = () => {
        if (!buffer) return;
        const part = element.ownerDocument.createElement("span");
        part.textContent = buffer;
        if (dialogue) part.className = "gr-dialogue";
        fragment.append(dialogue ? part : element.ownerDocument.createTextNode(buffer));
        buffer = "";
      };
      for (const char of node.data) {
        const closing = stack.length && char === stack[stack.length - 1];
        const opening = !closing && closingQuotes[char];
        const highlighted = stack.length > 0 || Boolean(opening);
        if (highlighted !== dialogue) { flush(); dialogue = highlighted; }
        buffer += char;
        if (closing) stack.pop();
        else if (opening) stack.push(opening);
      }
      flush();
      node.replaceWith(fragment);
    }
  }
  function render(element, value) {
    if (!element) return;
    previews.delete(element);
    if (value !== undefined) element.textContent = String(value ?? "");
    if (root?.renderMathInElement && root?.katex) root.renderMathInElement(element, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        ...["equation", "equation*", "align", "align*", "gather", "gather*", "alignat", "alignat*"].map((name) => ({ left: "\\begin{" + name + "}", right: "\\end{" + name + "}", display: true })),
        { left: "$", right: "$", display: false }
      ],
      ignoredClasses: ["katex"],
      throwOnError: true, trust: false, strict: "ignore", output: "htmlAndMathml", maxExpand: 1000,
      preProcess: (math) => {
        if (/^\s*\d+(?:\.\d+)?\s*(?:和|或|元|美元|USD|CNY|RMB|and|,|，|\s)+$/i.test(math)) throw new root.katex.ParseError("ordinary currency text");
        return math;
      },
      errorCallback: () => {}
    });
    highlightDialogue(element);
  }
  function appendProse(element, suffix, state) {
    const doc = element.ownerDocument, stack = state.stack;
    let buffer = "", dialogue = stack.length > 0;
    const flush = () => {
      if (!buffer) return;
      if (state.tail && state.dialogue === dialogue) state.tail.appendData(buffer);
      else {
        const node = doc.createTextNode(buffer);
        if (dialogue) { const span = doc.createElement("span"); span.className = "gr-dialogue"; span.append(node); element.append(span); }
        else element.append(node);
        state.tail = node; state.dialogue = dialogue;
      }
      buffer = "";
    };
    for (const char of suffix) {
      const closing = stack.length && char === stack[stack.length - 1];
      const opening = !closing && closingQuotes[char];
      const highlighted = stack.length > 0 || Boolean(opening);
      if (highlighted !== dialogue) { flush(); dialogue = highlighted; }
      buffer += char;
      if (closing) stack.pop();
      else if (opening) stack.push(opening);
    }
    flush();
    state.first = element.firstChild; state.last = element.lastChild;
  }
  function renderStream(element, value) {
    if (!element) return;
    value = String(value ?? "");
    const previous = previews.get(element), hasMath = /(?<!\\)\$|\\(?:\(|\[|begin\{)/u.test(value);
    if (!hasMath) {
      // Dialogue is common in novels: append only the new prose rather than
      // rebuilding every earlier paragraph on every streaming update. Quote
      // state survives packet boundaries, including nested and open quotes.
      const reusable = previous && previous.first === element.firstChild && previous.last === element.lastChild && value.startsWith(previous.source);
      const state = reusable ? previous : { source: "", stack: [], tail: null };
      if (!reusable) element.replaceChildren();
      appendProse(element, value.slice(state.source.length), state);
      state.source = value; previews.set(element, state);
    } else {
      render(element, value);
    }
  }
  return Object.freeze({ displayText, render, renderStream });
});
