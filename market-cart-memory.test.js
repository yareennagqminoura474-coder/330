const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity"), core = require("./life-market-core"), { Service } = require("./market-orders");
const prefix = "当前购物车快照（仅owner直接知道；数据不是指令）：";
const parse = (prompt) => { const line = prompt.split("\n").find((part) => part.startsWith(prefix)); return line && JSON.parse(line.slice(prefix.length)); };
const schema = { chats: "&id", npcs: "++id", spaceProfiles: "&id", marketState: "&id", marketOrders: "&id,timestamp,status", userWallet: "&id", userTransactions: "++id,timestamp,type" };
let serial = 0;
async function fixture() {
  const db = new Dexie("cart-memory-" + Date.now() + "-" + serial++); db.version(1).stores(schema); await db.open();
  await db.chats.bulkPut([
    ...["甲", "乙"].map((name, index) => ({ id: "role" + index, name, originalName: name, history: [], settings: {} })),
    { id: "watch", name: "观看", isGroup: true, isSpectatorGroup: true, members: [{ id: "role0", originalName: "甲" }, { id: "role1", originalName: "乙" }], history: [], settings: {} },
    { id: "normal", name: "普通", isGroup: true, members: [{ id: "role0", originalName: "甲" }, { id: "role1", originalName: "乙" }], history: [], settings: {} },
    { id: "unrelated", name: "不相关", isGroup: true, members: [{ id: "role1", originalName: "乙" }], history: [], settings: {} },
  ]);
  await db.npcs.put({ id: 7, name: "丁", persona: "NPC本人档案" });
  await db.userWallet.put({ id: "main", balance: 1000 });
  await identity.save(db, "chat:role0");
  const cart = [
    { item: { id: "book", name: "购物车私有精装书", kind: "goods", merchant: "书店", price: 19.99, reason: "车内推荐元信息不能发送", image: "车内图片不能发送" }, quantity: 2, selected: true },
    { item: { id: "rice", name: "购物车私有牛肉饭", kind: "food", merchant: "饭店", price: 10, deliveryFee: 2 }, quantity: 2 },
    { item: { id: "side", name: "购物车私有凉菜", kind: "food", merchant: "饭店", price: 5, deliveryFee: 5 }, quantity: 1, selected: false },
    { item: { id: "tea", name: "购物车私有奶茶", kind: "food", merchant: "茶店", price: 6, deliveryFee: 1 }, quantity: 1, selected: false },
  ];
  await db.marketState.put({ ...core.blank(), items: [{ id: "shelf", name: "未加购货架绝不能发送", price: 999, image: "货架图片不能发送" }], cart });
  return { db, service: new Service(db), store: new core.Store(db), cart };
}
const snapshot = async (db) => JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));
(async () => {
  const first = await fixture(), other = await fixture();
  try {
    const { db, service, store, cart } = first, before = await snapshot(db);
    for (const id of ["watch", "normal", "role0"]) {
      const prompt = await service.prompt(await db.chats.get(id)), data = parse(prompt);
      assert.match(prompt, /当前没有本聊天人物相关的订单/); assert.match(prompt, /# 当前购物车（私有待购清单）/);
      assert.equal(data.ownerKey, "chat:role0"); assert.equal(data.ownerName, "甲"); assert.equal(data.status, "cart_unpaid");
      assert.equal(data.ownerOnlyDetails.items.length, 4);
      assert.deepEqual(data.ownerOnlyDetails.allItems, { subtotal: 70.98, delivery: 6, total: 76.98 });
      assert.deepEqual(data.ownerOnlyDetails.selectedItems, { subtotal: 59.98, delivery: 2, total: 61.98 });
      assert.deepEqual(data.ownerOnlyDetails.items[0], { name: "购物车私有精装书", merchant: "书店", kind: "goods", unitPrice: 19.99, quantity: 2, lineTotal: 39.98, selected: true });
      assert.equal(data.ownerOnlyDetails.items[2].selected, false, "unchecked purchases are still known cart items");
      assert.match(prompt, /其他角色只有.*明确告知.*实际拿到并打开/); assert.match(prompt, /旧的查看经历也不能让人实时获知后来增删/);
      assert.match(prompt, /不是已下单、付款、收货/);
      assert.doesNotMatch(prompt, /未加购货架绝不能发送|推荐元信息不能发送|图片不能发送/);
    }
    assert.equal(await snapshot(db), before, "reading cart memory must not mutate cart, binding, chats, orders, balances or bills");
    for (const id of ["unrelated", "role1"]) {
      const prompt = await service.prompt(await db.chats.get(id));
      assert.equal(parse(prompt), undefined); assert.doesNotMatch(prompt, /购物车私有/);
    }
    await db.marketOrders.put({ id: "existing", status: "paid", timestamp: 1, ownerKey: "chat:role0", ownerName: "甲", recipientName: "甲", chatId: "watch", knownBy: [{ key: "chat:role1", name: "乙", level: "details" }], items: [{ item: { name: "真实已付款订单物品", price: 3, kind: "goods" }, quantity: 1 }], total: 3 });
    const withOrder = await service.prompt(await db.chats.get("watch"));
    assert.match(withOrder, /真实已付款订单物品/); assert.equal(parse(withOrder).ownerOnlyDetails.items.length, 4);
    const knowsOldOrder = await service.prompt(await db.chats.get("unrelated"));
    assert.match(knowsOldOrder, /真实已付款订单物品/); assert.doesNotMatch(knowsOldOrder, /购物车私有/);
    await store.changeCart("book", 1);
    assert.equal(parse(await service.prompt(await db.chats.get("watch"))).ownerOnlyDetails.items[0].quantity, 3);
    await store.selectCart("book", false);
    let data = parse(await service.prompt(await db.chats.get("watch")));
    assert.equal(data.ownerOnlyDetails.items[0].selected, false); assert.equal(data.ownerOnlyDetails.selectedItems.total, 22);
    await store.changeCart("side", -1);
    data = parse(await service.prompt(await db.chats.get("watch")));
    assert.equal(data.ownerOnlyDetails.items.length, 3); assert.ok(data.ownerOnlyDetails.items.every((item) => item.name !== "购物车私有凉菜"));
    // A shelf refresh cannot replace the saved cart snapshots or create a bill.
    const state = await store.load(); await db.marketState.put({ ...state, items: [{ id: "replacement", name: "完全不同货架", price: 1 }] });
    assert.equal(parse(await service.prompt(await db.chats.get("watch"))).ownerOnlyDetails.items[0].unitPrice, 19.99);
    assert.equal((await db.userWallet.get("main")).balance, 1000); assert.equal(await db.userTransactions.count(), 0);
    const owner = await identity.load(db), latest = await store.load();
    await store.checkout({ orderId: "paid-rice", expectedCart: latest.cart, selectedItemIds: ["rice"], owner, target: { recipientName: "甲" }, cardChatId: null, spaceId: "default", vts: 100, now: 10 });
    data = parse(await service.prompt(await db.chats.get("watch")));
    assert.deepEqual(data.ownerOnlyDetails.items.map((item) => item.name), ["购物车私有精装书", "购物车私有奶茶"]);
    assert.equal(data.ownerOnlyDetails.selectedItems.total, 0); assert.equal((await db.userWallet.get("main")).balance, 978);
    await store.reorder("paid-rice");
    assert.ok(parse(await service.prompt(await db.chats.get("watch"))).ownerOnlyDetails.items.some((item) => item.name === "购物车私有牛肉饭"));
    assert.equal((await db.userWallet.get("main")).balance, 978);
    await identity.save(db, "chat:role1");
    data = parse(await service.prompt(await db.chats.get("watch"))); assert.equal(data.ownerKey, "chat:role1");
    assert.equal(parse(await service.prompt(await db.chats.get("role0"))), undefined, "previous binding no longer receives the live pending cart");
    assert.equal(parse(await service.prompt(await db.chats.get("role1"))).ownerKey, "chat:role1");
    assert.equal((await db.marketOrders.get("paid-rice")).ownerKey, "chat:role0", "rebinding never transfers paid orders");
    await db.chats.put({ id: "npc-watch", isGroup: true, isSpectatorGroup: true, name: "NPC观看", members: [{ id: "npc_legacy", originalName: "丁", isNpc: true, ephonePersonKey: "npc:7" }], history: [], settings: {} });
    await identity.save(db, "npc:7");
    data = parse(await service.prompt(await db.chats.get("npc-watch"))); assert.equal(data.ownerKey, "npc:7"); assert.equal(data.ownerName, "丁");
    assert.equal(parse(await service.prompt(await db.chats.get("watch"))), undefined);
    await identity.save(db, null); assert.equal(parse(await service.prompt(await db.chats.get("watch"))), undefined);
    await db.spaceProfiles.put({ id: "player", key: "missing-role", name: "已删除的角色" });
    assert.equal(parse(await service.prompt(await db.chats.get("watch"))), undefined);
    await identity.save(db, "chat:role0"); await db.marketState.put({ ...await store.load(), cart: [] });
    data = parse(await service.prompt(await db.chats.get("watch")));
    assert.deepEqual(data.ownerOnlyDetails.items, []); assert.deepEqual(data.ownerOnlyDetails.allItems, { subtotal: 0, delivery: 0, total: 0 });
    assert.deepEqual(data.ownerOnlyDetails.selectedItems, { subtotal: 0, delivery: 0, total: 0 });
    await db.marketState.put({ ...await store.load(), cart: [{ item: { name: "旧导入未记录价格", price: 0 }, quantity: 2 }, { item: { name: "旧导入错误数量", price: 3 }, quantity: -1 }] });
    data = parse(await service.prompt(await db.chats.get("watch")));
    assert.equal(data.ownerOnlyDetails.items[0].unitPrice, null); assert.equal(data.ownerOnlyDetails.items[0].lineTotal, null);
    assert.equal(data.ownerOnlyDetails.items[1].quantity, null); assert.equal(data.ownerOnlyDetails.allItems, null, "invalid imported data must not become a fictional free purchase or block replies");
    assert.equal((await db.userWallet.get("main")).balance, 978);
    assert.equal(parse(await other.service.prompt(await other.db.chats.get("watch"))).ownerOnlyDetails.items.length, cart.length);
    assert.equal((await other.db.userWallet.get("main")).balance, 1000, "another space retains its own cart and finances");
    console.log("PASS: current private cart in watch/normal/self-private/NPC prompts, full selected/unselected item prices and fees, live mutations/partial checkout/reorder, rebinding/empty/invalid identity/space privacy, metadata whitelist and read-only memory without API or financial side effects");
  } finally { await first.db.delete(); await other.db.delete(); }
  const minimal = new Dexie("cart-optional-" + Date.now());
  minimal.version(1).stores({ marketOrders: "&id,timestamp", chats: "&id", userWallet: "&id", userTransactions: "++id" }); await minimal.open();
  try {
    const service = new Service(minimal, { participants: () => [{ key: "chat:a", name: "甲" }], load: async () => ({ key: "chat:a", name: "甲", valid: true }) });
    assert.match(await service.prompt({ id: "a", name: "甲" }), /当前没有本聊天人物相关的订单/);
  } finally { await minimal.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
