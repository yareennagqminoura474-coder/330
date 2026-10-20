const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), core = require("./life-market-core"), market = require("./market-orders"), identity = require("./player-identity"), wallet = require("./character-wallet-core");
const sumCents = (rows) => rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
(async () => {
  const db = new Dexie(`item-billing-${Date.now()}`);
  db.version(52).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", marketState: "&id", marketOrders: "&id,timestamp,status", userWallet: "&id", userTransactions: "++id,timestamp,type",
    characterWallets: "&key", characterTransactions: "&id,key,vts" });
  await db.open();
  await db.chats.put({ id: "owner", name: "甲", originalName: "甲", history: [], settings: { aiPersona: "普通成年人" } });
  await identity.save(db, "chat:owner");
  await db.userWallet.put({ id: "main", balance: 200 });
  const cart = [
    { item: { id: "pillow", name: "纯棉枕头", price: 19.99, kind: "goods", merchant: "家居店" }, quantity: 2 },
    { item: { id: "bookmark", name: "书签", price: 0.01, kind: "goods", merchant: "文具店" }, quantity: 3 },
    { item: { id: "rice", name: "牛肉饭", price: 12.5, kind: "food", merchant: "饭店A", deliveryFee: 1.5 }, quantity: 2 },
    { item: { id: "side", name: "凉菜", price: 7.2, kind: "food", merchant: "饭店A", deliveryFee: 2.5 }, quantity: 1 },
    { item: { id: "tea", name: "奶茶", price: 6.8, kind: "food", merchant: "茶饮店B", deliveryFee: 1.2 }, quantity: 3 },
  ];
  const totals = core.quote(cart); assert.deepEqual(totals, { subtotal: 92.61, delivery: 3.7, total: 96.31 });
  await db.marketState.put({ ...core.blank(), cart });
  const store = new core.Store(db), owner = await identity.load(db), service = new market.Service(db);
  const options = { orderId: "itemized", expectedCart: cart, owner, target: { chatId: "owner", recipientName: "甲", forSelf: true }, vts: 1770000000000, spaceId: "default", now: 100 };
  const results = await Promise.all([store.checkout(options), store.checkout(options)]);
  assert.equal(results.filter((result) => !result.alreadyPaid).length, 1);
  assert.equal((await db.userWallet.get("main")).balance, 103.69);
  const rows = await db.userTransactions.toArray(), order = await db.marketOrders.get("itemized");
  assert.equal(rows.length, 7); assert.equal(sumCents(rows), 9631);
  assert.equal(rows.filter((row) => row.entryKind === "item").length, 5);
  assert.equal(rows.filter((row) => row.entryKind === "delivery").length, 2);
  assert.equal(rows.find((row) => row.itemId === "pillow").amount, 39.98);
  assert.equal(rows.find((row) => row.itemId === "pillow").unitPrice, 19.99);
  assert.equal(rows.find((row) => row.itemId === "pillow").quantity, 2);
  assert.equal(rows.find((row) => row.itemId === "bookmark").amount, 0.03);
  assert.equal(rows.filter((row) => row.entryKind === "delivery" && row.merchant === "饭店A")[0].amount, 2.5, "same merchant charges once regardless of quantity");
  assert.equal(new Set(rows.map((row) => row.orderLineId)).size, 7);
  assert.ok(rows.every((row) => row.orderId === "itemized"));
  const notice = (await db.chats.get("owner")).history[0];
  assert.equal(notice.orderSnapshot.lineItems.length, 5); assert.equal(notice.orderSnapshot.lineItems[0].amount, 39.98);
  assert.equal(notice.orderSnapshot.deliveryFees.length, 2);
  const roleLedger = await new wallet.Service(db).ledger("chat:owner", Infinity);
  assert.equal(roleLedger.length, 7); assert.equal(sumCents(roleLedger), 9631);
  // The second insert failing must undo the first line, balance deduction,
  // order creation and cart clear together, not leave a half-paid purchase.
  await db.marketState.put({ ...core.blank(), cart });
  const originalAdd = store.bills.add; let inserts = 0;
  store.bills.add = async function (row) { if (++inserts === 2) throw Error("second line failed"); return originalAdd.call(this, row); };
  await assert.rejects(store.checkout({ ...options, orderId: "failed-purchase" }), /second line failed/);
  store.bills.add = originalAdd;
  assert.equal((await db.userWallet.get("main")).balance, 103.69); assert.equal(await db.userTransactions.count(), 7);
  assert.equal(await db.marketOrders.get("failed-purchase"), undefined); assert.deepEqual((await db.marketState.get("main")).cart, cart);
  // Cancelling a group is still one credit, with the exact reverse item/fee rows.
  const cancel = { type: "cancel_market_order", name: "甲", order_id: "itemized", reason: "取消这次购买" };
  const originalRefundAdd = service.bills.add; let refundInserts = 0;
  service.bills.add = async function (row) { if (++refundInserts === 2) throw Error("second refund line failed"); return originalRefundAdd.call(this, row); };
  await assert.rejects(service.act(cancel, { chatId: "owner", vts: 1770000000100 }), /second refund line failed/);
  service.bills.add = originalRefundAdd;
  assert.equal((await db.userWallet.get("main")).balance, 103.69); assert.equal(await db.userTransactions.count(), 7);
  assert.equal((await db.marketOrders.get("itemized")).status, "paid", "partial refund persistence failure rolls back the entire credit and all lines");
  const refunds = await Promise.all([service.act(cancel, { chatId: "owner", vts: 1770000000100 }), service.act(cancel, { chatId: "owner", vts: 1770000000100 })]);
  assert.equal(refunds.filter((result) => !result.alreadyApplied).length, 1);
  assert.equal((await db.userWallet.get("main")).balance, 200);
  const refunded = await db.userTransactions.where("type").equals("income").toArray();
  assert.equal(refunded.length, 7); assert.equal(sumCents(refunded), 9631);
  assert.deepEqual(refunded.map((row) => row.refundOfLineId), rows.map((row) => row.orderLineId));
  // Legacy aggregate rows expand only for display. Never rewrite financial data
  // or count the old aggregate in addition to its virtual detailed view.
  await db.marketOrders.put({ ...order, id: "legacy" });
  const legacy = { id: 999, orderId: "legacy", type: "expense", amount: 96.31, description: "旧合并账单", timestamp: 50, vts: 1770000000000 };
  const legacyCopy = structuredClone(legacy), balanceBefore = (await db.userWallet.get("main")).balance;
  const expanded = await core.expandOrderBills([legacy], db);
  assert.equal(expanded.length, 7); assert.equal(sumCents(expanded), 9631);
  assert.equal(new Set(expanded.map((row) => row.id)).size, 7); assert.ok(expanded.every((row) => row.legacyParentId === 999));
  assert.deepEqual(legacy, legacyCopy); assert.deepEqual(await core.expandOrderBills(expanded, db), expanded);
  assert.equal((await db.userWallet.get("main")).balance, balanceBefore); assert.equal(await db.userTransactions.count(), 14);
  await db.userTransactions.add(legacy);
  const allLedger = await new wallet.Service(db).ledger("chat:owner", Infinity);
  assert.equal(allLedger.length, 21, "bound character sees legacy per-item lines too");
  assert.equal(sumCents(allLedger.filter((row) => row.direction === "expense")), 19262);
  assert.equal(await db.userTransactions.count(), 15, "legacy display expansion cannot mutate persisted transaction count");
  const mismatch = await core.expandOrderBills([{ ...legacy, amount: 90 }], db);
  assert.equal(mismatch.length, 1, "unknown historical discounts are not invented or allocated as new charges");
  const incomplete = { id: "incomplete", items: [{ item: { name: "旧商品" }, quantity: 1 }], total: 8 };
  assert.equal(core.orderBreakdown(incomplete), null); assert.equal(core.orderBills(incomplete, "income")[0].amount, 8);
  await db.delete();
  console.log("PASS: single atomic settlement with per-item/merchant-fee ledger, exact cents/quantities, snapshots, bound wallet, idempotent refund, partial insert rollback, read-only legacy expansion without double-count or balance changes");
})().catch((error) => { console.error(error); process.exitCode = 1; });
