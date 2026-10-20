const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity"), market = require("./market-orders"), core = require("./life-market-core");
const schema = { chats: "&id", npcs: "++id", spaceProfiles: "&id", marketState: "&id", marketOrders: "&id,timestamp,status", userWallet: "&id", userTransactions: "++id,timestamp,type" };
async function fixture(suffix) {
  const db = new Dexie("order-private-test-" + Date.now() + suffix); db.version(52).stores(schema); await db.open();
  const members = ["甲", "乙", "丙"].map((name, i) => ({ id: "role" + i, originalName: name, groupNickname: name }));
  await db.chats.bulkPut([...members.map((m) => ({ id: m.id, name: m.originalName, originalName: m.originalName, history: [], settings: { aiPersona: m.originalName + "爱好书法。家庭条件普通。" } })),
    { id: "watch", name: "观看", isGroup: true, isSpectatorGroup: true, members, history: [], settings: {} },
    { id: "normal", name: "普通群", isGroup: true, members, history: [], settings: {} },
    { id: "unrelated", name: "无关群", isGroup: true, members: [members[1]], history: [], settings: {} }]);
  await db.npcs.put({ id: 7, name: "丁", persona: "喜欢园艺。" });
  await db.userWallet.put({ id: "main", balance: 100, kinshipCards: [{ id: "keep" }] });
  await identity.save(db, "chat:role0");
  return { db, service: new market.Service(db), store: new core.Store(db) };
}
async function buy(f, id = "order1") {
  const state = core.blank(); state.cart = [{ item: { id: id + "item", name: "蛋炒饭", kind: "food", price: 10, deliveryFee: 2, deliveryMinutes: 30 }, quantity: 1 }];
  await f.db.marketState.put(state);
  const owner = await identity.load(f.db), target = await f.service.target(owner, "watch");
  return f.store.checkout({ orderId: id, expectedCart: state.cart, owner, target, vts: 1770000000000, spaceId: "test", now: 100 });
}
(async () => {
  const a = await fixture("a"), b = await fixture("b");
  try {
    const { db, service } = a;
    assert.equal((await identity.load(db)).key, "chat:role0");
    await identity.save(b.db, "npc:7"); assert.equal((await identity.load(b.db)).name, "丁");
    assert.equal((await identity.load(db)).name, "甲");
    assert.equal(identity.resolve([{ name: "甲", key: "1" }, { name: "甲", key: "2" }], "甲"), null);
    await db.chats.update("role0", { name: "备注", originalName: "甲改名" });
    assert.equal((await identity.load(db)).name, "甲改名");
    await db.chats.update("role0", { name: "甲", originalName: "甲" });
    const paid = await buy(a); assert.equal(paid.balance, 88);
    assert.equal(paid.order.ownerKey, "chat:role0"); assert.equal(paid.order.recipientName, "甲"); assert.equal(paid.chat.id, "watch");
    assert.deepEqual(paid.order.knownBy.map((p) => p.name), ["甲"]);
    assert.equal(paid.chat.history[0].type, "market_order"); assert.equal(paid.chat.history[0].privateOrder, true);
    let prompt = await service.prompt(await db.chats.get("watch"));
    assert.match(prompt, /不是全群公告|不是每个角色/); assert.match(prompt, /订单主人本名/); assert.match(prompt, /order1/);
    assert.doesNotMatch(await service.prompt(await db.chats.get("unrelated")), /order1|蛋炒饭/);
    await assert.rejects(service.act({ type: "cancel_market_order", name: "乙", order_id: "order1" }, { chatId: "watch", vts: 1 }), /操作权限/);
    assert.equal((await db.userWallet.get("main")).balance, 88);
    await assert.rejects(b.service.act({ type: "cancel_market_order", name: "甲", order_id: "order1" }, { chatId: "watch", vts: 1 }), /不存在|当前空间/);
    await assert.rejects(service.act({ type: "market_order_share", name: "甲", order_id: "order1", audience: ["丁"], content: "我买了蛋炒饭" }, { chatId: "watch", vts: 1 }), /名单/);
    await service.act({ type: "market_order_share", name: "甲", order_id: "order1", audience: ["乙"], content: "我买了蛋炒饭" }, { chatId: "watch", vts: 1 });
    let order = await db.marketOrders.get("order1"); assert.equal(order.knownBy.find((p) => p.name === "乙").level, "summary"); assert.equal(order.knownBy.some((p) => p.name === "丙"), false);
    await assert.rejects(service.act({ type: "cancel_market_order", name: "乙", order_id: "order1" }, { chatId: "watch", vts: 1 }), /操作权限/);
    await service.act({ type: "market_phone_check", name: "乙", order_id: "order1", content: "拿到甲的手机，打开订单页查看详情。" }, { chatId: "watch", vts: 2 });
    order = await db.marketOrders.get("order1"); assert.equal(order.knownBy.find((p) => p.name === "乙").level, "details"); assert.ok(order.phoneAccess.includes("chat:role1"));
    const cancelled = await Promise.all([1, 2].map(() => service.act({ type: "cancel_market_order", name: "乙", order_id: "order1", reason: "不吃外卖" }, { chatId: "watch", vts: 3 })));
    assert.equal(cancelled.filter((r) => !r.alreadyApplied).length, 1);
    assert.equal((await db.userWallet.get("main")).balance, 100); assert.deepEqual((await db.userWallet.get("main")).kinshipCards, [{ id: "keep" }]);
    assert.equal(await db.userTransactions.where("type").equals("income").count(), 2);
    assert.deepEqual((await db.userTransactions.where("type").equals("income").toArray()).map((row) => row.amount), [10, 2]);
    order = await db.marketOrders.get("order1"); assert.equal(order.cancelledBy, "乙"); assert.equal(order.refundedAmount, 12);
    assert.equal(order.knownBy.some((p) => p.name === "丙"), false);
    const history = (await db.chats.get("watch")).history;
    assert.equal(history.filter((m) => m.orderEvent === "cancelled").length, 1); assert.ok(history.every((m) => m.orderSnapshot.status === "cancelled"));
    await assert.rejects(service.act({ type: "market_order_arrived", name: "甲", order_id: "order1", content: "到了" }, { chatId: "watch", vts: 3 }), /已取消/);
    await identity.save(db, "chat:role2"); await service.adopt(await identity.load(db));
    assert.equal((await db.marketOrders.get("order1")).ownerKey, "chat:role0", "Rebinding cannot steal previous owners' orders");
    await identity.save(db, "chat:role0"); await buy(a, "order2");
    const watch = await db.chats.get("watch");
    watch.history.push({ role: "user", type: "text", senderName: "甲", content: "我点了蛋炒饭。", timestamp: 199 });
    assert.equal((await service.captureDisclosures(watch)).length, 0, "Watch group membership doesn't prove hearing a scene");
    const chat = await db.chats.get("normal");
    chat.history.push({ role: "assistant", type: "text", senderName: "甲", content: "如果我买了蛋炒饭，会告诉你们。", timestamp: 200 });
    assert.equal((await service.captureDisclosures(chat)).length, 0);
    chat.history.push({ role: "assistant", type: "narration", senderName: "甲", content: "我买了蛋炒饭", timestamp: 201 });
    assert.equal((await service.captureDisclosures(chat)).length, 0);
    chat.history.push({ role: "user", type: "text", senderName: "甲", sentAsCharacter: true, content: "我刚点了蛋炒饭。", timestamp: 202 });
    await db.chats.put(chat); await service.captureDisclosures(chat);
    assert.equal((await db.marketOrders.get("order2")).knownBy.length, 3);
    assert.equal((await service.captureDisclosures(await db.chats.get("normal"))).length, 0, "Disclosure is not re-emitted on every reply");
    await service.act({ type: "market_order_arrived", name: "乙", order_id: "order2", audience: ["甲"], content: "送到门口，两人接过外卖。" }, { chatId: "watch", vts: 4 });
    await assert.rejects(service.act({ type: "cancel_market_order", name: "甲", order_id: "order2" }, { chatId: "watch", vts: 4 }), /到货/);
    await db.chats.update("watch", { history: [] });
    assert.match(await service.prompt(await db.chats.get("watch")), /order2|蛋炒饭/, "Order memory survives chat history trimming");
    await buy(a, "order3");
    db.userTransactions.hook("creating", function () { throw new Error("simulated persistence failure"); });
    const beforeBalance = (await db.userWallet.get("main")).balance;
    await assert.rejects(service.act({ type: "cancel_market_order", name: "甲", order_id: "order3" }, { chatId: "watch", vts: 5 }), /persistence/);
    assert.equal((await db.userWallet.get("main")).balance, beforeBalance); assert.equal((await db.marketOrders.get("order3")).status, "paid");
    await db.chats.delete("role0"); await db.chats.update("watch", { members: [] }); await db.chats.update("normal", { members: [] });
    assert.equal((await identity.load(db)).valid, false); await assert.rejects(service.target(await identity.load(db)), /绑定/);
    console.log("PASS: per-space binding, stale identity, private order memory, explicit disclosure, phone permissions, atomic/idempotent refund, delivery, rollback, no cross-space leakage");
  } finally { await a.db.delete(); await b.db.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
