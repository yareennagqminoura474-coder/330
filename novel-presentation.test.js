const assert = require("node:assert/strict"), core = require("./novel-presentation.js");
assert.equal(core.displayText("属于关系（$\\in$ 与 $\\notin$），接着上课。"), "属于关系（∈ 与 ∉），接着上课。");
assert.equal(core.displayText("$x \\in A$；\\(A \\subseteq B\\)；$$A\\cup B$$"), "x ∈ A；A ⊆ B；A∪ B");
for (const s of ["价格 $20 和 $30", "\\$20", "$\\unknown{x}$", "$\\frac{1}{2}$", '<img src=x onerror="bad()">', "第一段\n\n正文与引号\"保留\""]) assert.equal(core.displayText(s), s);
const long = "正文".repeat(12000) + "$\\notin$";
assert.equal(core.displayText(long), "正文".repeat(12000) + "∉");
console.log("PASS: readable math symbols, inline/display delimiters, literal prices/unknown notation/markup and full prose preserved");
