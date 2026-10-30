(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EPhoneNovelPresentation = api;
})(typeof window === "undefined" ? null : window, function () {
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
  return Object.freeze({ displayText });
});
