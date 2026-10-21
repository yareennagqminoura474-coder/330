const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), core = require("./life-market-core"), market = require("./market-orders"), identity = require("./player-identity");
global.ephoneLifeMarketCore = core; global.ephoneMarketOrders = market;
(async () => {
  const db = new Dexie("market-destination-reorder-" + Date.now());
  db.version(1).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", marketState: "&id", marketOrders: "&id,timestamp,status", userWallet: "&id", userTransactions: "++id,timestamp,type" });
  await db.open();
  try {
    const store = new core.Store(db), service = new market.Service(db, identity);
    await db.chats.bulkAdd([{ id: "buyer", name: "甲", originalName: "甲", history: [] }, { id: "other", name: "乙", originalName: "乙", history: [] },
      ...[["watch", true], ["normal", false], ["extra", false]].map(([id, watch]) => ({ id, name: id, isGroup: true, isSpectatorGroup: watch, members: [{ id: "buyer", originalName: "甲" }, { id: "other", originalName: "乙" }], history: [] })),
      { id: "unrelated", name: "无关群", isGroup: true, members: [{ id: "other", originalName: "乙" }], history: [] }]);
    await db.userWallet.put({ id: "main", balance: 100, funds: ["unchanged"] }); await identity.save(db, "chat:buyer");
    const owner = await identity.load(db), target = { chatId: "buyer", recipientName: "甲" };
    const cart = [{ item: { id: "book", name: "练习册", kind: "goods", price: 7.5, merchant: "书店" }, quantity: 2 }, { item: { id: "rice", name: "饭", kind: "food", price: 8, merchant: "饭店", deliveryFee: 2 }, quantity: 1 }];
    await db.marketState.put({ ...core.blank(), cart });
    const paid = await store.checkout({ orderId: "first", expectedCart: cart, target, cardChatId: "watch", owner, spaceId: "default", vts: 1000 });
    assert.equal(paid.order.total, 25); assert.equal(paid.balance, 75); assert.equal(paid.order.recipientChatId, "buyer"); assert.equal(paid.order.chatId, "watch");
    assert.equal((await db.chats.get("buyer")).history.length, 0); assert.equal((await db.chats.get("watch")).history.length, 1);
    assert.equal(await db.userTransactions.count(), 3); assert.deepEqual(paid.order.knownBy.map((p) => p.key), [owner.key]);
    const forwarded = await Promise.all([service.postCard("first", "normal", { vts: 2000 }), service.postCard("first", "normal", { vts: 2000 })]);
    assert.equal(forwarded.filter((r) => r.alreadyPosted).length, 1); assert.equal((await db.chats.get("normal")).history.length, 1);
    await service.postCard("first", "unrelated", { vts: 2000 });
    assert.equal((await db.userWallet.get("main")).balance, 75); assert.equal(await db.userTransactions.count(), 3);
    assert.deepEqual((await db.marketOrders.get("first")).knownBy, paid.order.knownBy); assert.deepEqual((await db.marketOrders.get("first")).phoneAccess, [owner.key]);
    assert.doesNotMatch(await service.prompt(await db.chats.get("unrelated")), /first|练习册/, "placing a private card doesn't grant unrelated members order knowledge");
    await assert.rejects(service.act({ type: "cancel_market_order", order_id: "first", name: "乙" }, { chatId: "unrelated", vts: 2000 }), /尚不知情/);
    for (const destination of ["missing", "buyer"]) await assert.rejects(service.postCard("first", destination, { vts: 2000 }), /群聊/);
    await assert.rejects(service.postCard("not-here", "normal", { vts: 2000 }), /不属于当前空间/);
    const beforeOrder = await db.marketOrders.get("first"), beforeChat = await db.chats.get("extra");
    const hook = () => { throw Error("post write failure"); }; db.chats.hook("updating", hook);
    await assert.rejects(service.postCard("first", "extra", { vts: 2000 }), /post write failure/); db.chats.hook("updating").unsubscribe(hook);
    assert.deepEqual(await db.marketOrders.get("first"), beforeOrder); assert.deepEqual(await db.chats.get("extra"), beforeChat);
    await service.act({ type: "cancel_market_order", order_id: "first", name: "甲", reason: "取消" }, { chatId: "watch", vts: 3000 });
    assert.equal((await db.userWallet.get("main")).balance, 100); assert.equal(await db.userTransactions.count(), 6);
    assert.equal((await db.chats.get("normal")).history[0].orderSnapshot.status, "cancelled");
    await service.postCard("first", "extra", { vts: 3000 });
    const card = (await db.chats.get("extra")).history[0]; assert.match(card.content, /已取消/); assert.doesNotMatch(card.content, /尚未到货/);
    const oldOrder = await db.marketOrders.get("first");
    // A different price already in the cart must not be overwritten or merged.
    const otherPrice = { item: { ...cart[0].item, price: 99 }, quantity: 1, selected: false };
    await db.marketState.put({ ...core.blank(), cart: [otherPrice] });
    const again = await store.reorder("first"); assert.equal(again.cart.length, 3); assert.deepEqual(again.cart[0], otherPrice);
    assert.equal(again.cart[1].item.price, 7.5); assert.notEqual(again.cart[1].item.id, "book"); assert.equal(again.cart[1].quantity, 2); assert.equal(again.cart[1].selected, true);
    assert.equal((await db.userWallet.get("main")).balance, 100); assert.equal(await db.userTransactions.count(), 6); assert.deepEqual(await db.marketOrders.get("first"), oldOrder);
    const second = await store.checkout({ orderId: "second", expectedCart: again.cart, selectedItemIds: again.cart.slice(1).map((r) => r.item.id), target, cardChatId: null, owner, vts: 4000 });
    assert.equal(second.balance, 75); assert.equal(second.order.total, 25); assert.equal(second.chat, null); assert.equal(second.order.chatId, null);
    assert.equal((await db.marketOrders.get("first")).status, "cancelled"); assert.equal((await store.load()).cart.length, 1);
    const preserved = await store.load();
    const affordable = { ...preserved, cart: [cart[1]] }; await db.marketState.put(affordable);
    for (const destination of ["missing", "buyer"]) await assert.rejects(store.checkout({ orderId: "bad", expectedCart: affordable.cart, cardChatId: destination, target, owner, vts: 4000 }), /目标群/);
    assert.deepEqual(await store.load(), affordable); assert.equal((await db.userWallet.get("main")).balance, 75); await db.marketState.put(preserved);
    await store.reorder("first"); const merged = await store.reorder("first");
    assert.equal(merged.cart.find((r) => r.item.price === 7.5).quantity, 4); assert.equal(merged.cart.find((r) => r.item.kind === "food").quantity, 2);
    const capped = { ...core.blank(), cart: [{ item: cart[0].item, quantity: 98 }] }; await db.marketState.put(capped);
    await assert.rejects(store.reorder("first"), /数量/); assert.deepEqual(await store.load(), capped);
    await db.marketOrders.put({ id: "legacy-no-price", items: [{ item: { name: "旧商品" }, quantity: 1 }], total: 10 });
    await assert.rejects(store.reorder("legacy-no-price"), /单价或数量/); assert.deepEqual(await store.load(), capped);
    assert.deepEqual((await db.userWallet.get("main")).funds, ["unchanged"]);
    console.log("PASS: independent recipient/group routing, watch/normal/no-card options, existing-order posting without payment, concurrent dedupe/privacy/permissions/status/rollback, reorder snapshots/ID collision/selection/quantity limits, new checkout and unchanged old order, invalid-group atomic safety");
  } finally { await db.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
