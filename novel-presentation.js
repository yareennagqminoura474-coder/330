(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EPhoneNovelPresentation = api;
})(typeof window === "undefined" ? null : window, function (root) {
  "use strict";
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
  function render(element, value) {
    if (!element) return;
    if (value !== undefined) element.textContent = String(value ?? "");
    if (!root?.renderMathInElement || !root?.katex) return;
    root.renderMathInElement(element, {
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
  }
  const previews = new WeakMap();
  function renderStream(element, value) {
    if (!element) return;
    value = String(value ?? "");
    const previous = previews.get(element), hasMath = /(?<!\\)\$|\\(?:\(|\[|begin\{)/u.test(value);
    if (!hasMath && previous?.node?.parentNode === element && value.startsWith(previous.source)) {
      previous.node.appendData(value.slice(previous.source.length)); previous.source = value;
    } else {
      render(element, value);
      previews.set(element, { source: value, node: !hasMath && element.childNodes.length === 1 && element.firstChild.nodeType === 3 ? element.firstChild : null });
    }
  }
  return Object.freeze({ displayText, render, renderStream });
});
