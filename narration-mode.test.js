const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const window = {};
vm.runInNewContext(fs.readFileSync(require.resolve("./narration-mode.js"), "utf8"), {
  window, document: { readyState: "loading", addEventListener() {} },
});
const normalize = (items) => JSON.parse(JSON.stringify(window.normalizeEPhoneNarrationOutput(items)));
for (const content of [
  "龙井茶叶一盒（180）、吐司一袋、黄油一盒", "龙井茶叶一盒(180元)、吐司一袋",
  "龙井茶叶一盒*180*、吐司一袋", "龙井茶叶一盒**180**、吐司一袋",
  "**180元**", "(¥180.50/盒)", "（单价：180元）", "（数量：两盒）", "（规格：500ml×2）",
  "*180-200元*", "（08:30）", "（2026-03-05）", "（2×3=6）", "（M码180厘米）",
  "三文鱼*1、排骨*1、虾仁*1、鸡翅*1", "2*3*4=24", "三文鱼×1、排骨×1、茶叶180元",
  "（180）", "*180*", "三文鱼*1、排骨*1，**总价180元**", "**请看这份清单**",
]) {
  const item = { type: "text", name: "林", content };
  assert.deepEqual(normalize([item]), [item], content + " stays a single dialogue, never numeric narration");
}
for (const content of ["（伸手拿起手机）", "(站起身)", "*拿起杯子*", "（等了10分钟，拿起手机）"]) {
  assert.equal(normalize([{ type: "text", name: "林", content }])[0].type, "narration", content);
}
assert.equal(normalize([{ type: "text", content: "（拿起**180元**的茶叶）" }])[0].content, "拿起**180元**的茶叶");
for (const content of ["茶叶（180元），*拿起手机*好了", "三文鱼*1、排骨*1，*拿起手机*好了"]) {
  const items = normalize([{ t: "text", n: "林", c: content }]);
  assert.equal(items.length, 3);
  assert.equal(items[0].type, "text"); assert.match(items[0].content, /180元|排骨\*1/);
  assert.equal(items[1].type, "narration"); assert.equal(items[1].content, "拿起手机");
  assert.equal(items[2].type, "text"); assert.equal(items[2].content, "好了");
  assert.ok(items.every((item) => item.c === item.content));
}
assert.deepEqual(normalize([{ type: "wallet_expense", content: "茶叶（180元）", amount: 180 }]),
  [{ type: "wallet_expense", content: "茶叶（180元）", amount: 180 }]);
assert.equal(normalize([{ type: "narration", content: "他数了180元。" }])[0].type, "narration");
const quoted = normalize([{ type: "text", name: "林", content: "林拿起手机，说：“茶叶180元。”" }]);
assert.deepEqual(quoted.map((item) => item.type), ["narration", "text"]);
console.log("PASS: amounts/quantities/dates/arithmetic/bold/multiplication remain dialogue; real actions, quoted speech, aliases and finance events preserved");
