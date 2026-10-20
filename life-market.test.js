const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), core = require("./life-market-core"), groupContext = require("./group-context");
const { marketBatch: batch } = require("./market-test-fixtures");
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
  // Financial circumstances are grounded in profiles, never cash-on-hand or
  // recent chat. Preserve the exact source, negations, and person ownership.
  const economics = core.buildContext({ chats: [{ id: "economics", name: "摄影朋友", settings: {
    aiPersona: "喜欢摄影。" + "完整人物经历，".repeat(600) + "并非富裕家庭，父母有房贷。月薪6000元，消费节俭。",
    myPersona: "喜欢园艺。" + "个人爱好介绍，".repeat(160) + "家庭条件普通，每月零花钱800元，不买奢侈品。",
  }, get history() { throw Error("不读经济状况的聊天推断"); } }],
    npcs: [{ name: "富裕邻居", persona: "家境优渥，家庭资产丰厚，喜欢高品质咖啡。" }], groupContext });
  const profile = economics.characters.find((item) => item.name === "摄影朋友");
  assert.doesNotMatch(profile.persona, /月薪6000/); // Beyond the preview, still retained below.
  assert.match(profile.familyConditions, /并非富裕家庭.*父母有房贷.*月薪6000元.*消费节俭/s);
  assert.match(profile.playerFamilyConditions, /家庭条件普通.*每月零花钱800元.*不买奢侈品/s);
  assert.doesNotMatch(profile.playerFamilyConditions, /家庭资产丰厚/);
  const economicsPrompt = core.prompt(economics, { seenNames: [] });
  assert.match(economicsPrompt, /月薪6000元/); assert.match(economicsPrompt, /每月零花钱800元/);
  assert.match(economicsPrompt, /不能只把家境写进推荐理由/);
  assert.match(economicsPrompt, /明确的购买者家庭条件优先/);
  assert.match(economicsPrompt, /不能因为同空间某个NPC或角色有钱/);
  assert.match(economicsPrompt, /同款同规格商品凭空加价/);
  assert.match(economicsPrompt, /逐项检查price、deliveryFee/);
  assert.match(economicsPrompt, /家庭资产丰厚但每月可支配零花钱少/);
  assert.match(economicsPrompt, /不得给所有人物生成同一批同档次商品后只替换理由/);
  assert.match(economicsPrompt, /家庭条件未设置或档案相互矛盾/);
  const grounded = core.buildContext({ chats: [{ id: "plain", name: "普通朋友", settings: { aiPersona: "喜欢摄影。" } }], groupContext });
  assert.equal(grounded.characters[0].familyConditions, "");
  const poor = core.buildContext({ chats: [{ id: "plain", name: "普通朋友", settings: { aiPersona: "喜欢摄影。家境拮据，月生活费600元。" } }], groupContext });
  const rich = core.buildContext({ chats: [{ id: "plain", name: "普通朋友", settings: { aiPersona: "喜欢摄影。家境富裕，但消费节俭。" } }], groupContext });
  assert.notEqual(core.prompt(poor, { seenNames: [] }), core.prompt(rich, { seenNames: [] }));
  const watchConditions = core.buildContext({ chats: [{ id: "source", name: "甲", settings: { aiPersona: "家境普通，爱读书。", myPersona: "每月生活费1200元。" } },
    { id: "watch", isSpectatorGroup: true, members: [{ id: "source", originalName: "甲", persona: "家境优渥，但零花钱有限。", ephonePersonaOverride: true }] }], groupContext });
  assert.ok(watchConditions.characters.some((item) => /家境优渥/.test(item.familyConditions) && /零花钱有限/.test(item.familyConditions)));
  assert.ok(watchConditions.characters.every((item) => /每月生活费1200元/.test(item.playerFamilyConditions)));
  const groupPlayer = core.buildContext({ chats: [{ id: "group-only", name: "家庭群", isGroup: true,
    settings: { myNickname: "小林", myPersona: "喜欢读书，家庭经济拮据，每月零用钱300元。" }, members: [] }], groupContext });
  assert.equal(groupPlayer.playerProfiles[0].name, "小林");
  assert.match(groupPlayer.playerProfiles[0].familyConditions, /家庭经济拮据.*每月零用钱300元/);
  assert.match(core.prompt(groupPlayer, { seenNames: [] }), /每月零用钱300元/);
  assert.equal((await store.load()).items.length, 0); assert.equal(await upgraded.marketState.count(), 0);
  const generate = async () => { calls++; return batch("第一批"); };
  const first = await store.refresh({ generate, context, vts: 1770000000000, batchId: "one" });
  assert.equal(calls, 1); assert.equal(first.items.length, 40);
  await store.changeCart(first.items[0].id, 1);
  await store.changeCart(first.items[24].id, 2);
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
  assert.equal(core.parseBatch({ ...batch("两类同名"), food: batch("两类同名").food.map((item, i) => ({ ...item, name: i ? item.name : "两类同名物0" })) }, undefined, "filtered").skipped.duplicates, 1);
  assert.equal(core.parseBatch(batch("第一批"), first, "filtered").items.length, 0);
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
  assert.equal(await upgraded.marketOrders.count(), 1); assert.equal(await upgraded.userTransactions.count(), 3);
  assert.deepEqual((await upgraded.userTransactions.toArray()).map((bill) => bill.amount), [10.15, 20.3, 2.35]);
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
  assert.equal((await new core.Store(facade).load()).items.length, 40); assert.equal(await facade.marketOrders.count(), 1);
  await Dexie.delete(name + "__space_other"); await upgraded.delete();
  console.log("PASS: personality plus family/allowance grounding, long-profile preservation, economic ownership/negations/group overrides, wallet/history exclusion, persistence, manual-only refresh, non-repeating catalogs, abort/failure preservation, atomic checkout, space isolation");
})().catch((error) => { console.error(error); process.exitCode = 1; });
