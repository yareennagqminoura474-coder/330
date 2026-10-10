const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), core = require("./life-market-core"), groupContext = require("./group-context");
function batch(prefix) {
  const make = (kind, count) => Array.from({ length: count }, (_, i) => ({ name: `${prefix}${kind}${i}`, category: `类别${i % 4}`,
    merchant: `店${i % 3}`, description: "日常所需", reason: "符合人物性格与喜好", price: 10.15 + i,
    deliveryFee: 2.35, deliveryMinutes: 30, emoji: kind === "餐" ? "🍱" : "🛍" }));
  return { headline: "新的生活", goods: make("物", 12), food: make("餐", 8) };
}
(async () => {
  const name = `market-tests-${Date.now()}`;
  const db = new Dexie(name);
  // Upgrade an existing user DB with real data; schema changes must preserve it.
  db.version(49).stores({ chats: "&id", npcs: "++id", userWallet: "&id", userTransactions: "++id,timestamp,type", globalSettings: "&id" });
  await db.open(); await db.userWallet.put({ id: "main", balance: 200, kinshipCards: [{ id: "old" }] });
  await db.chats.put({ id: "role", name: "林", originalName: "林", settings: { aiPersona: "喜欢书法" }, history: [{ role: "user", content: "我想买文具", timestamp: 1 }] });
  db.close();
  const upgraded = new Dexie(name);
  upgraded.version(50).stores({ chats: "&id", npcs: "++id", userWallet: "&id", userTransactions: "++id,timestamp,type", globalSettings: "&id", marketState: "&id", marketOrders: "&id,timestamp,status" });
  await upgraded.open();
  const store = new core.Store(upgraded); let calls = 0;
  const context = core.buildContext({ chats: await upgraded.chats.toArray(), wallet: await upgraded.userWallet.get("main"), groupContext });
  assert.match(JSON.stringify(context), /喜欢书法/); assert.doesNotMatch(JSON.stringify(context), /我想买文具/); assert.equal(context.walletBalance, undefined);
  const privateRole = { id: "source", name: "甲", settings: { aiPersona: "最新人设喜欢摄影", myPersona: "喜欢园艺" },
    get history() { throw new Error("不得读取聊天记录"); }, get longTermMemory() { throw new Error("不得读取总结记忆"); } };
  const spectator = { id: "spectator", isSpectatorGroup: true, members: [{ id: "source", originalName: "甲", persona: "旧人设", ephonePersonaOverride: false }],
    get history() { throw new Error("不得读取群历史"); }, get longTermMemory() { throw new Error("不得读取群总结"); } };
  const onlyPersonas = core.buildContext({ chats: [privateRole, spectator], npcs: [{ id: 1, name: "乙", persona: "喜欢运动" }],
    groupContext: { memberProfile: groupContext.memberProfile, buildContext() { throw new Error("不得读取联动记忆"); } } });
  assert.match(JSON.stringify(onlyPersonas), /最新人设喜欢摄影/); assert.match(JSON.stringify(onlyPersonas), /喜欢园艺/);
  assert.doesNotMatch(JSON.stringify(onlyPersonas), /旧人设/); assert.match(JSON.stringify(onlyPersonas), /喜欢运动/);
  assert.equal(core.prompt({ ...context, walletBalance: 100, memories: "聊天秘密", worldbooks: "世界书秘密" }, { seenNames: [] }, 1),
    core.prompt({ ...context, walletBalance: 999, memories: "另一段聊天", worldbooks: "另一世界书" }, { seenNames: [] }, 999999));
  assert.doesNotMatch(core.prompt({ ...context, history: "聊天秘密", walletBalance: 123456 }, { seenNames: [] }), /聊天秘密|123456/);
  assert.equal((await store.load()).items.length, 0); assert.equal(await upgraded.marketState.count(), 0);
  const generate = async () => { calls++; return batch("第一批"); };
  const first = await store.refresh({ generate, context, vts: 1770000000000, batchId: "one" });
  assert.equal(calls, 1); assert.equal(first.items.length, 20);
  await store.changeCart(first.items[0].id, 1);
  await store.changeCart(first.items[12].id, 2);
  const savedCart = (await store.load()).cart;
  const second = await store.refresh({ generate: async () => batch("第二批"), context, vts: 1770000000010, batchId: "two" });
  assert.ok(second.items.every((item) => item.name.startsWith("第二批")));
  assert.deepEqual(second.cart, savedCart);
  await assert.rejects(() => store.refresh({ generate, context, batchId: "bad" }), /重复/);
  assert.deepEqual(await store.load(), second);
  await assert.rejects(() => store.refresh({ generate: async () => { throw new Error("网络错误"); }, context, batchId: "bad" }), /网络错误/);
  assert.deepEqual(await store.load(), second);
  const controller = new AbortController();
  await assert.rejects(() => store.refresh({ generate: async () => { controller.abort(); return batch("中止"); }, context, signal: controller.signal, batchId: "stop" }), { name: "AbortError" });
  assert.deepEqual(await store.load(), second);
  assert.throws(() => core.parseBatch({ ...batch("两类同名"), food: batch("两类同名").food.map((item, i) => ({ ...item, name: i ? item.name : "两类同名物0" })) }, undefined, "bad"), /重复/);
  assert.throws(() => core.parseBatch(batch("第一批"), first, "bad"), /重复/);
  const quote = core.quote(savedCart); assert.equal(quote.total, 32.8); // 10.15 + 20.30 + 2.35
  await upgraded.userWallet.put({ id: "main", balance: 1 });
  await assert.rejects(() => store.checkout({ orderId: "poor", expectedCart: savedCart }), /余额不足/);
  assert.equal(await upgraded.marketOrders.count(), 0); assert.equal(await upgraded.userTransactions.count(), 0);
  await upgraded.userWallet.put({ id: "main", balance: 200, kinshipCards: [{ id: "old" }] });
  await assert.rejects(() => store.checkout({ orderId: "gone", expectedCart: savedCart, target: { chatId: "missing", recipientName: "林" } }), /角色/);
  const billAdd = store.bills.add;
  store.bills.add = async () => { throw new Error("模拟写入失败"); };
  await assert.rejects(() => store.checkout({ orderId: "abort", expectedCart: savedCart }), /模拟写入失败/);
  store.bills.add = billAdd;
  assert.equal((await upgraded.userWallet.get("main")).balance, 200);
  assert.deepEqual((await store.load()).cart, savedCart);
  assert.equal(await upgraded.marketOrders.count(), 0);
  const params = { orderId: "paid", expectedCart: savedCart, target: { chatId: "role", recipientName: "林" }, vts: 1770000000000, spaceId: "default" };
  const [paid, repeated] = await Promise.all([store.checkout(params), store.checkout(params)]);
  assert.equal(paid.balance, 167.2); assert.equal(repeated.alreadyPaid, true);
  assert.equal(await upgraded.marketOrders.count(), 1); assert.equal(await upgraded.userTransactions.count(), 1);
  assert.equal((await store.load()).cart.length, 0);
  assert.deepEqual((await upgraded.userWallet.get("main")).kinshipCards, [{ id: "old" }]);
  assert.match((await upgraded.chats.get("role")).history.at(-1).content, /已为林下单/);
  upgraded.close(); await upgraded.open(); assert.equal((await new core.Store(upgraded).load()).items[0].name, second.items[0].name);
  const storage = new Map([['ephone-persona-spaces-v1', JSON.stringify([{ id: "default", name: "默认" }, { id: "other", name: "其他" }])]]);
  const window = { Dexie, EPHONE_DB_BASE_NAME: name, refreshPersonaSpaceData: async () => {} };
  vm.runInNewContext(fs.readFileSync("persona-spaces.js", "utf8"), { window, document: { addEventListener() {} }, console, structuredClone,
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } });
  const facade = window.EPhoneSpaces.bindDatabases(upgraded, upgraded, "default");
  await window.EPhoneSpaces.switchSpace("other");
  assert.equal((await new core.Store(facade).load()).items.length, 0); assert.equal(await facade.marketOrders.count(), 0);
  assert.equal(await facade.userWallet.count(), 0); assert.equal(facade.marketState.db, facade.chats.db);
  await window.EPhoneSpaces.switchSpace("default");
  assert.equal((await new core.Store(facade).load()).items.length, 20); assert.equal(await facade.marketOrders.count(), 1);
  await Dexie.delete(name + "__space_other"); await upgraded.delete();
  console.log("PASS: persistence, manual-only full refresh, non-repeating catalogs, abort/failure preservation, cart snapshots, atomic/idempotent wallet checkout, character awareness, DB upgrade, space isolation");
})().catch((error) => { console.error(error); process.exitCode = 1; });
