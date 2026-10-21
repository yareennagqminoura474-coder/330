const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), { Store, blank } = require("./life-market-core");
(async () => {
  const db = new Dexie("market-selection-" + Date.now());
  db.version(1).stores({ marketState: "&id", marketOrders: "&id,timestamp", userWallet: "&id", userTransactions: "++id,type", chats: "&id" });
  await db.open();
  try {
    const store = new Store(db), cart = [
      { item: { id: "tea", name: "奶茶", price: 10, kind: "food", merchant: "茶店", deliveryFee: 2 }, quantity: 2 },
      { item: { id: "snack", name: "点心", price: 5, kind: "food", merchant: "茶店", deliveryFee: 8 }, quantity: 1 },
      { item: { id: "book", name: "书", price: 30, kind: "goods" }, quantity: 1 },
    ];
    await db.marketState.put({ ...blank(), cart }); await db.userWallet.put({ id: "main", balance: 100 });
    await db.chats.put({ id: "buyer", name: "甲", history: [] });
    await store.selectCart("snack", false); const state = await store.selectCart("book", false);
    assert.deepEqual((await new Store(db).load()).cart.map((line) => line.selected), [undefined, false, false]);
    const args = { orderId: "first", expectedCart: state.cart, selectedItemIds: ["tea"], target: { chatId: "buyer", recipientName: "甲" } };
    const results = await Promise.all([store.checkout(args), store.checkout(args)]);
    assert.equal(results.filter((r) => r.alreadyPaid).length, 1);
    assert.equal(results[0].order.total, 22); assert.equal(results[0].order.delivery, 2, "unchecked food doesn't raise the delivery fee");
    assert.equal((await db.userWallet.get("main")).balance, 78);
    assert.deepEqual((await store.load()).cart, state.cart.slice(1));
    assert.deepEqual((await db.userTransactions.toArray()).map((r) => r.amount), [20, 2]);
    const notice = (await db.chats.get("buyer")).history[0].content;
    assert.match(notice, /奶茶×2/); assert.doesNotMatch(notice, /点心|书/);
    const remaining = (await store.load()).cart;
    for (const ids of [[], ["missing"], ["snack", "snack"], null]) {
      await assert.rejects(store.checkout({ orderId: "bad", expectedCart: remaining, selectedItemIds: ids }), /请选择/);
    }
    await store.selectCart(null, true);
    await assert.rejects(store.checkout({ orderId: "stale", expectedCart: remaining, selectedItemIds: ["snack"] }), /变化/);
    const second = await store.checkout({ orderId: "second", expectedCart: (await store.load()).cart, selectedItemIds: ["book"] });
    assert.equal(second.order.total, 30); assert.equal(second.balance, 48);
    assert.deepEqual((await store.load()).cart.map((l) => l.item.id), ["snack"]);
    const final = await store.checkout({ orderId: "third", expectedCart: (await store.load()).cart });
    assert.equal(final.order.total, 13); assert.equal(final.balance, 35);
    assert.equal((await store.load()).cart.length, 0);
    console.log("PASS: persisted cart selection, selected-only fees/bills/notices, remaining snapshots, stale/invalid checks, idempotent and separate checkout, all-cart compatibility");
  } finally { await db.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
