const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), core = require("./life-market-core"), { marketBatch } = require("./market-test-fixtures");
const clone = (v) => structuredClone(v);
const rename = (item, name) => ({ ...item, name, productIdentity: name });
(async () => {
  const db = new Dexie("market-search-" + Date.now());
  db.version(1).stores({ chats: "&id", marketState: "&id", marketOrders: "&id,timestamp,status", userWallet: "&id", userTransactions: "++id" });
  try {
    await db.open(); const store = new core.Store(db), vts = Date.now(), context = { player: "我", characters: [] };
    const old = marketBatch("原货架"); old.goods[0] = rename(old.goods[0], "现有燕麦");
    const state = { ...core.blank(), ...core.parseBatch(old, undefined, "old"), seenNames: ["草莓酸奶180g"], cart: [] };
    state.cart = [{ item: clone(state.items[3]), quantity: 2 }];
    await db.marketState.put(state); await db.userWallet.put({ id: "main", balance: 456.12 });
    await db.marketOrders.put({ id: "paid", status: "paid", total: 10 });
    assert.deepEqual(core.searchQueries("现有燕麦，草莓酸奶、牛肉面\n草莓酸奶; iPhone 17；"), ["现有燕麦", "草莓酸奶", "牛肉面", "iPhone 17"]);
    assert.equal(core.searchItems([{ name: "甲".repeat(80), productIdentity: "甲".repeat(80), category: "洗发水", department: "个护护理" }], "洗发水").length, 1, "a long name/identity cannot hide the existing category and trigger a paid search");
    let count = 0;
    const local = await store.search({ query: "现有燕麦", generate: async () => { count++; throw Error("must not generate"); } });
    assert.equal(local.generated, false); assert.equal(count, 0);
    let result = await store.search({ query: "现有燕麦，草莓酸奶\n牛肉面", kind: "goods", context, vts, batchId: "search", generate: async (prompt) => {
      count++; assert.match(prompt, /批量搜索补货/); assert.match(prompt, /"missingQueries":\["草莓酸奶","牛肉面"\]/);
      const next = marketBatch("全新货架"); next.goods[0] = rename(next.goods[0], "草莓酸奶180g"); next.goods[1] = rename(next.goods[1], "现有燕麦"); next.food[0] = rename(next.food[0], "牛肉面"); return next;
    } });
    assert.equal(count, 1, "all missing terms are sent together, not one API call per item");
    assert.equal(result.generated, true); assert.deepEqual(result.missing, []); assert.equal(result.matches.length, 3);
    assert.equal(result.state.headline, "全新货架 · 新生活", "mixed search also adopts the new generated batch theme");
    assert.deepEqual(result.state.items.find((i) => i.name === "现有燕麦"), state.items[0], "keep the existing explicitly searched item without regenerating it");
    assert.ok(result.state.items.some((i) => i.name === "草莓酸奶180g"), "explicit search may restock a historical item");
    assert.ok(!result.state.items.some((i) => i.name === "原货架物2"));
    assert.equal(result.state.items.filter((i) => i.name === "现有燕麦").length, 1);
    assert.deepEqual(result.state.cart, state.cart); assert.equal((await db.userWallet.get("main")).balance, 456.12); assert.equal(await db.userTransactions.count(), 0); assert.equal(await db.marketOrders.count(), 1);
    const persisted = clone(await store.load());
    result = await new core.Store(db).search({ query: ["草莓酸奶", "牛肉面", "现有燕麦"], generate: async () => { throw Error("all already found"); } });
    assert.equal(result.generated, false); assert.deepEqual(await store.load(), persisted);
    let calls = 0;
    await assert.rejects(store.search({ query: "不存在的量子杯", context, vts, batchId: "unmatched", generate: async () => { calls++; return marketBatch("没有目标"); } }), /未生成缺少搜索项/);
    assert.equal(calls, 2); assert.deepEqual(await store.load(), persisted, "no false success or old-list loss when the model ignores a query");
    calls = 0;
    result = await store.search({ query: "显示器、咖啡机", context, vts, batchId: "partial", generate: async (prompt) => {
      calls++; if (calls === 2) { assert.match(prompt, /missingSearchQueries.*咖啡机/); return { goods: [], food: [] }; }
      const next = marketBatch("部分结果"); next.goods[0] = rename(next.goods[0], "显示器"); return next;
    } });
    assert.equal(calls, 2); assert.deepEqual(result.missing, ["咖啡机"]); assert.ok(result.matches.some((i) => i.name === "显示器"));
    const before = clone(await store.load()), controller = new AbortController();
    await assert.rejects(store.search({ query: "洗衣机", context, vts, batchId: "abort", signal: controller.signal, generate: async () => { controller.abort(); return marketBatch("取消"); } }), { name: "AbortError" });
    assert.deepEqual(await store.load(), before);
    await assert.rejects(store.search({ query: "\n，；", generate: async () => { throw Error("invalid must not generate"); } }), /输入/);
    const renamed = marketBatch("去重批次"); renamed.food[0] = rename(renamed.food[0], "西红柿牛腩盖浇饭"); renamed.food[1] = { ...rename(renamed.food[1], "招牌老王家番茄牛腩饭"), merchant: "老王家" };
    renamed.goods[0] = rename(renamed.goods[0], "无线蓝牙耳机"); renamed.goods[1] = rename(renamed.goods[1], "手机保护壳");
    const parsed = core.parseBatch(renamed, { ...core.blank(), seenNames: ["番茄牛腩饭", "蓝牙无线耳机", "手机壳"] }, "dedup");
    assert.equal(parsed.skipped.duplicates, 4, "synonyms, merchant wrappers, order and packaging cannot evade historical duplicate checks");
    assert.notEqual(core.noveltyKey("草莓酸奶", "goods"), core.noveltyKey("原味酸奶", "goods"));
    assert.notEqual(core.noveltyKey("iPhone16", "goods"), core.noveltyKey("iPhone17", "goods"));
    const flavour = marketBatch("真实口味"); flavour.food[0] = { ...rename(flavour.food[0], "可乐鸡翅饭"), merchant: "可乐" };
    assert.equal(core.parseBatch(flavour, { ...core.blank(), seenNames: ["鸡翅饭"] }, "flavour").skipped.duplicates, 0, "a merchant name that is also a real flavour must not erase the flavour");
    const within = marketBatch("本批重复"); within.food[0] = rename(within.food[0], "西红柿牛腩饭"); within.food[1] = rename(within.food[1], "番茄牛腩盖饭");
    assert.equal(core.parseBatch(within, core.blank(), "within", { searchQuery: ["牛腩"] }).skipped.duplicates, 1, "restocking never permits duplicate targets within one batch");
    const manyQueries = Array.from({ length: 120 }, (_, i) => `多项需求第${i}款`); let manyCalls = 0;
    const many = await store.search({ query: manyQueries, context, vts, batchId: "many", generate: async () => {
      manyCalls++; const batch = marketBatch("大批新品"); batch.goods = manyQueries.map((name, i) => ({ ...rename(batch.goods[i % 24], name), department: core.departments.goods[i % 12] })); return batch;
    } });
    assert.equal(manyCalls, 1); assert.equal(many.matches.length, 120); assert.deepEqual(many.missing, [], "a large explicit list is not silently capped to the ordinary catalog size");
    console.log("PASS: multi-term local search/no API, one batched missing-term generation, mixed goods/food, existing target snapshots, explicit historic restock, fresh background catalogs, missing-target/partial/cancel preservation, all cart/wallet/orders unchanged, semantic history and in-batch dedup with meaningful variants retained");
  } finally { await db.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
