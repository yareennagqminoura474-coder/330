const assert = require("node:assert/strict"), core = require("./life-market-core"), { marketBatch } = require("./market-test-fixtures");
require("fake-indexeddb/auto"); const Dexie = require("dexie");
const copy = (value) => structuredClone(value);
(async () => {
  const db = new Dexie(`market-recovery-${Date.now()}`);
  db.version(50).stores({ chats: "&id", marketState: "&id", marketOrders: "&id,timestamp,status", userWallet: "&id", userTransactions: "++id,timestamp,type" });
  await db.open(); const store = new core.Store(db), context = { player: "我", characters: [] }, vts = new Date(2026, 9, 20, 12).getTime();
  await db.userWallet.put({ id: "main", balance: 500 });
  let original = await store.refresh({ context, vts, batchId: "old", generate: async () => marketBatch("旧批") });
  await store.changeCart(original.items[0].id, 2); original = await store.load();
  const first = marketBatch("新批"); first.goods[0] = copy(marketBatch("旧批").goods[0]); first.food[0].price = "¥19.90";
  delete first.goods[1].productIdentity; delete first.goods[1].selection; first.goods[1].department = "日用百货";
  first.food[1].deliveryMinutes = "约20—35分钟";
  const prompts = [], progress = [];
  const refreshed = await store.refresh({ context, vts, batchId: "new", onProgress: (event) => progress.push(event), generate: async (prompt) => {
    prompts.push(prompt);
    if (prompts.length === 1) return first;
    assert.match(prompt, /本次只补缺项/); assert.match(prompt, /"goods":1,"food":0/);
    assert.match(prompt, /新批物1/);
    const missing = marketBatch("仅补充").goods[0];
    return { goods: [missing], food: [] };
  } });
  assert.equal(prompts.length, 2); assert.equal(progress[0].goods, 23); assert.equal(progress[0].food, 16);
  assert.equal(refreshed.items.length, 40); assert.equal(new Set(refreshed.items.map((item) => item.id)).size, 40);
  assert.equal(refreshed.items.filter((item) => item.name.startsWith("新批")).length, 39, "keep all valid initial goods rather than regenerate");
  assert.ok(refreshed.items.some((item) => item.name === "仅补充物0"));
  assert.ok(!refreshed.items.some((item) => item.name === "旧批物0"));
  assert.equal(refreshed.refreshInfo.skipped.duplicates, 1); assert.equal(refreshed.refreshInfo.partial, false);
  assert.equal(refreshed.items.find((item) => item.name === "新批餐0").price, 19.9);
  assert.equal(refreshed.items.find((item) => item.name === "新批餐1").deliveryMinutes, 35);
  assert.deepEqual(refreshed.cart, original.cart); assert.equal((await db.userWallet.get("main")).balance, 500);
  assert.equal(await db.marketOrders.count(), 0); assert.equal(await db.userTransactions.count(), 0);
  // A truncated second array cannot erase already complete objects in the first.
  const truncated = marketBatch("截断");
  const text = '这是本批商品：```json\n{"goods":' + JSON.stringify(truncated.goods) + ',"food":[' + JSON.stringify(truncated.food[0]) + ',{"name":"半条记录","price":';
  const recovered = core.parseBatch(text, refreshed, "partial");
  assert.equal(recovered.items.length, 25); assert.equal(recovered.recovered, true);
  assert.ok(!recovered.items.some((item) => item.name === "半条记录"), "unfinished prices are never reconstructed or guessed");
  let recoveryCalls = 0;
  const full = await store.refresh({ context, vts, batchId: "recovered", generate: async (prompt) => {
    recoveryCalls++; if (recoveryCalls === 1) return text;
    assert.match(prompt, /"goods":0,"food":15/);
    return { goods: [], food: truncated.food.slice(1) };
  } });
  assert.equal(full.items.length, 40); assert.equal(full.refreshInfo.skipped.recovered, true);
  assert.equal(full.items.filter((item) => item.kind === "food").length, 16);
  assert.deepEqual(full.cart, original.cart);
  // Slightly short output and a failed supplement are still usable, without
  // dropping valid items or retrying a paid network request a third time.
  const short = marketBatch("少量"); short.goods = short.goods.slice(0, 20); short.food = short.food.slice(0, 12);
  let shortCalls = 0;
  const usable = await store.refresh({ context, vts, batchId: "usable", generate: async () => {
    shortCalls++; if (shortCalls === 2) throw Error("isolated supplement 503"); return short;
  } });
  assert.equal(shortCalls, 2); assert.equal(usable.items.length, 32); assert.equal(usable.refreshInfo.partial, true);
  assert.equal(usable.refreshInfo.supplementFailed, true); assert.deepEqual(usable.cart, original.cart);
  const beforeFailure = copy(await store.load()); let failedCalls = 0;
  await assert.rejects(() => store.refresh({ context, vts, batchId: "network", generate: async () => { failedCalls++; throw Error("isolated network failure"); } }), /network failure/);
  assert.equal(failedCalls, 1); assert.deepEqual(await store.load(), beforeFailure);
  let allRepeatCalls = 0;
  await assert.rejects(() => store.refresh({ context, vts, batchId: "repeat", generate: async () => { allRepeatCalls++; return short; } }), /商品重复/);
  assert.equal(allRepeatCalls, 2); assert.deepEqual(await store.load(), beforeFailure);
  const controller = new AbortController(); let abortedCalls = 0;
  await assert.rejects(() => store.refresh({ context, vts, signal: controller.signal, batchId: "cancel", generate: async () => {
    abortedCalls++; if (abortedCalls === 2) controller.abort();
    const short = marketBatch("取消"); return { goods: short.goods.slice(0, 12), food: short.food.slice(0, 8) };
  } }), { name: "AbortError" });
  assert.equal(abortedCalls, 2); assert.deepEqual(await store.load(), beforeFailure);
  // Compatible providers may use Chinese field names or omit optional metadata.
  const minimal = core.parseBatch({ data: { 商品: [{ 名称: "牙刷", 价格: "￥12.50", 类别: "护理" }],
    外卖: [{ 菜名: "番茄牛腩饭", 售价: "25元", 配送费: "免费", 配送时间: "1小时" }] } }, undefined, "aliases");
  assert.equal(minimal.items.length, 2); assert.equal(minimal.items[0].department, "个护护理");
  assert.equal(minimal.items[1].deliveryMinutes, 60); assert.equal(minimal.items[1].deliveryFee, 0);
  const invalid = core.parseBatch({ goods: [{ name: "缺价商品" }, { name: "价格区间", price: "10—20元" }, { name: "负数", price: -5 }, { name: "有效商品", price: 5 }], food: [] }, undefined, "invalid");
  assert.equal(invalid.items.length, 1); assert.equal(invalid.skipped.invalid, 3);
  const generic = core.parseBatch({ goods: [{ name: "甲牌原味牛奶", productIdentity: "牛奶", price: 5 }, { name: "乙牌巧克力牛奶", productIdentity: "牛奶", price: 6 }], food: [] }, undefined, "generic");
  assert.equal(generic.items.length, 2, "an overly broad model identity doesn't blacklist a whole product category");
  assert.throws(() => core.parseBatch("只说已生成，没有商品JSON"), /未返回可读取/);
  const interleaved = [];
  const mixed = marketBatch("混排");
  for (let index = 0; index < 8; index++) {
    interleaved.push(...mixed.goods.slice(index * 3, index * 3 + 3).map((item) => ({ ...item, kind: "goods" })),
      ...mixed.food.slice(index * 2, index * 2 + 2).map((item) => ({ ...item, kind: "food" })));
  }
  assert.equal(core.parseBatch({ items: interleaved }, undefined, "mixed").items.length, 40);
  const mixedCutoff = '{"items":[' + interleaved.slice(0, 25).map((item) => JSON.stringify(item)).join(",") + ',{"kind":"food","name":"半个菜名';
  const mixedRecovered = core.parseBatch(mixedCutoff, undefined, "mixed-cutoff");
  assert.equal(mixedRecovered.items.length, 25);
  assert.equal(mixedRecovered.items.filter((item) => item.kind === "goods").length, 15);
  assert.equal(mixedRecovered.items.filter((item) => item.kind === "food").length, 10, "interleaving retains both catalog types even on output-length cutoff");
  const people = Array.from({ length: 40 }, (_, i) => ({ name: `人物${i}`, persona: "喜欢读书。".repeat(600), familyConditions: "家庭条件普通。" }));
  const bigPrompt = core.prompt({ player: "我", characters: people }, core.blank(), vts);
  assert.ok(bigPrompt.length < 15000); assert.ok(!bigPrompt.includes('"name":"人物6"'), "bounded persona sampling prevents huge catalog prompts");
  await db.delete();
  console.log("PASS: skip duplicates/invalid rows, optional metadata/field/currency compatibility, truncated JSON recovery, supplement missing only, unique IDs, usable partial success, network/cancel/failure preservation, no financial side effects and bounded prompts");
})().catch((error) => { console.error(error); process.exitCode = 1; });
