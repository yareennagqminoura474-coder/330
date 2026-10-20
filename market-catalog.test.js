const assert = require("node:assert/strict"), core = require("./life-market-core"), { marketBatch } = require("./market-test-fixtures");
const clone = (value) => structuredClone(value);
const previous = { ...core.blank(), ...core.parseBatch(marketBatch("老批"), undefined, "old") };
const good = marketBatch("新批");
assert.equal(core.parseBatch(good, previous, "new").items.length, 40);
for (const [a, b] of [
  ["精选原味燕麦片500g", "原味燕麦片家庭装1000g"],
  ["抽纸200抽×3包", "超值抽纸100抽*6包"],
  ["番茄牛腩饭（大份）", "人气番茄牛腩饭（小份）"],
  ["洗衣液2L", "洗衣液便携装500ml"],
]) assert.equal(core.productKey(a), core.productKey(b), `${a} / ${b}`);
for (const [a, b] of [["西装", "西裤"], ["苹果手机16", "苹果手机17"], ["草莓酸奶", "原味酸奶"], ["蒜香鸡翅", "可乐鸡翅"]])
  assert.notEqual(core.productKey(a), core.productKey(b), "keep meaningful model/flavour differences");
function replaceFirst(name, identity = name) {
  const batch = clone(good); batch.goods[0].name = name; batch.goods[0].productIdentity = identity; return batch;
}
assert.throws(() => core.parseBatch(replaceFirst("老批物0"), previous, "bad"), /重复/);
assert.throws(() => core.parseBatch(replaceFirst("精选老批物0家庭装500g"), previous, "bad"), /重复/);
assert.throws(() => core.parseBatch(replaceFirst("彻底改名的新包装", "老批物0"), previous, "bad"), /重复/);
const legacy = { ...core.blank(), seenNames: ["原味燕麦片500g"], items: [] };
assert.throws(() => core.parseBatch(replaceFirst("超值原味燕麦片家庭装1000g"), legacy, "bad"), /重复/);
const oldHistory = { ...core.blank(), seenNames: ["原味燕麦片500g", ...Array.from({ length: 900 }, (_, i) => `旧名称${i}`)] };
assert.throws(() => core.parseBatch(replaceFirst("原味燕麦片1000g"), oldHistory, "bad"), /重复/, "all local history is checked, not just recent prompt exclusions");
const retainedIdentity = { ...core.blank(), seenProductKeys: [core.productKey("番茄牛腩饭")] };
const dish = clone(good); dish.food[0].name = "另一餐厅番茄牛腩盖饭"; dish.food[0].productIdentity = "番茄牛腩饭";
assert.throws(() => core.parseBatch(dish, retainedIdentity, "bad"), /重复/);
const within = clone(good); within.goods[1].name = "精选新批物0家庭装";
assert.throws(() => core.parseBatch(within, previous, "bad"), /重复/);
const missing = clone(good); missing.goods[0].department = "文具图书";
assert.throws(() => core.parseBatch(missing, previous, "bad"), /品类不全/);
const tooPersonal = clone(good); tooPersonal.goods.forEach((item) => item.selection = "personal");
assert.throws(() => core.parseBatch(tooPersonal, previous, "bad"), /选品结构/);
const noDiscovery = clone(good); noDiscovery.food.forEach((item) => item.selection = "everyday");
assert.throws(() => core.parseBatch(noDiscovery, previous, "bad"), /选品结构/);
const noIdentity = clone(good); delete noIdentity.goods[0].productIdentity;
assert.throws(() => core.parseBatch(noIdentity, previous, "bad"), /productIdentity/);
const prompt = core.prompt({ player: "林", characters: [], get history() { throw Error("never read chat"); } }, previous, new Date(2026, 9, 20, 12).getTime());
assert.match(prompt, /日常基础、通用需求/); assert.match(prompt, /最多30%/); assert.match(prompt, /至少20%/);
assert.match(prompt, /生鲜食材/); assert.match(prompt, /粮油调味/); assert.match(prompt, /productIdentity/);
assert.match(prompt, /"month":10,"period":"午间"/);
assert.deepEqual(core.calendarContext(NaN), null);
assert.notEqual(prompt, core.prompt({ player: "林", characters: [] }, previous, new Date(2026, 0, 20, 8).getTime()));
console.log("PASS: full 12+8 department coverage, balanced recommendations, virtual month/daypart, exact/packaging/stable identity/in-batch/history dedup; distinct models/flavours kept");
