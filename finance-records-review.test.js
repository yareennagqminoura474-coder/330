const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity.js");
const market = require("./life-market-core.js"), finance = require("./finance-records-core.js"), wallets = require("./character-wallet-core.js");
const schema = { chats: "&id", npcs: "++id", spaceProfiles: "&id", marketState: "&id", marketOrders: "&id,timestamp,status", userWallet: "&id", userTransactions: "++id,timestamp,type", characterWallets: "&key", characterTransactions: "&id,key,vts,category" };
(async () => {
  const db = new Dexie("finance-records-review-" + Date.now()); db.version(1).stores(schema); await db.open();
  try {
    await db.chats.put({ id: "a", originalName: "甲", name: "甲", history: [], settings: {} });
    await db.userWallet.put({ id: "main", balance: 1000 });
    await identity.save(db, "chat:a");
    const cart = [
      { item: { id: "a-food", name: "A商家午餐", price: 10, kind: "food", merchant: "A商家", deliveryFee: 2 }, quantity: 1 },
      { item: { id: "b-food", name: "B商家午餐", price: 10, kind: "food", merchant: "B商家", deliveryFee: 5 }, quantity: 1 },
    ];
    await db.marketState.put({ ...market.blank(), cart });
    const store = new market.Store(db), service = new finance.Service(db), wallet = new wallets.Service(db, identity);
    let order = (await store.checkout({ orderId: "fee-shift", expectedCart: cart, owner: { key: "chat:a", name: "甲" }, target: { recipientName: "甲" }, vts: 1770000000000, spaceId: "default", cardChatId: null })).order;
    assert.equal((await db.userWallet.get("main")).balance, 973);
    const feeA = (await wallet.ledger("chat:a", Infinity)).find((row) => row.entryKind === "delivery" && row.merchant === "A商家");
    order = (await service.deleteLedger("chat:a", feeA)).order;
    assert.equal((await db.userWallet.get("main")).balance, 975);
    const draft = structuredClone(order); draft.items[0].item.deliveryFee = 0;
    const edited = await service.editOrder(order.id, draft, { expected: order });
    assert.equal(edited.order.total, 25);
    assert.equal((await db.userWallet.get("main")).balance, 975,
      "removing an already-reversed A merchant fee must not reverse the live B merchant fee when delivery array indices shift");
    assert.equal(edited.order.paidAmount, 25);
    const remaining = (await wallet.ledger("chat:a", Infinity)).filter((row) => row.status === "posted" && row.entryKind === "delivery");
    assert.equal(remaining.filter((row) => row.merchant === "B商家" && row.amount === 5).length, 1);
    console.log("PASS: delivery fee identity survives removal of another merchant's already-reversed fee");
  } finally { await db.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
