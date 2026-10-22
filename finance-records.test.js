const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie");
const identity = require("./player-identity"), walletCore = require("./character-wallet-core"), marketCore = require("./life-market-core"), ordersCore = require("./market-orders"), financeCore = require("./finance-records-core");
const schema = { chats: "&id", npcs: "++id", spaceProfiles: "&id", marketState: "&id", marketOrders: "&id,timestamp,status",
  userWallet: "&id", userTransactions: "++id,timestamp,type", characterWallets: "&key", characterTransactions: "&id,key,vts,category" };
let serial = 0;
async function fixture() {
  const db = new Dexie("finance-record-test-" + Date.now() + "-" + serial++); db.version(53).stores(schema); await db.open();
  await db.chats.bulkPut([{ id: "a", name: "甲", originalName: "甲", history: [], settings: {} }, { id: "b", name: "乙", originalName: "乙", history: [], settings: {} },
    { id: "g", isGroup: true, isSpectatorGroup: true, name: "群", members: [{ id: "a", originalName: "甲" }, { id: "b", originalName: "乙" }], history: [], settings: {} }]);
  await db.userWallet.put({ id: "main", balance: 1000, fundHoldings: [{ id: "preserve" }] });
  for (const key of ["chat:a", "chat:b"]) await db.characterWallets.put({ key, configured: true, balance: 100, revision: 1, rules: [], automatic: true, otherAssets: 987 });
  await identity.save(db, "chat:a");
  return { db, finance: new financeCore.Service(db), wallet: new walletCore.Service(db, identity), store: new marketCore.Store(db), orders: new ordersCore.Service(db, identity) };
}
async function buy(f, id, lines = [{ item: { id: "x", name: "饭", merchant: "商家", price: 10, kind: "food", deliveryFee: 2 }, quantity: 1 }]) {
  const state = marketCore.blank(); state.cart = lines; await f.db.marketState.put(state);
  const owner = await identity.load(f.db), target = await f.orders.target(owner, "g");
  return (await f.store.checkout({ orderId: id, expectedCart: state.cart, owner, target, vts: 1770000000000, spaceId: "space", now: 100 + serial })).order;
}
const first = async (f, key, predicate = () => true) => (await f.wallet.ledger(key, Infinity)).find(predicate);
const balance = async (f) => (await f.db.userWallet.get("main")).balance;
async function run(name, test) {
  const f = await fixture();
  try { await test(f); console.log("PASS", name); } finally { await f.db.delete(); }
}
(async () => {
  await run("free ledger changes use the original account and preserve other wallet fields", async (f) => {
    const row = await f.wallet.book("chat:b", 20, "expense", { id: "manual1", vts: 1000, description: "午饭" });
    assert.equal((await f.wallet.account("chat:b")).balance, 80);
    let result = await f.finance.editLedger("chat:b", row, { amount: 30, description: "晚饭", category: "food", vts: 2000 });
    assert.equal(result.balance, 1000); assert.equal(result.characterBalance, 70); assert.equal(result.entry.vts, 2000);
    await assert.rejects(f.finance.editLedger("chat:b", row, { amount: 40 }), /已经变化/);
    result = await f.finance.editLedger("chat:b", result.entry, { amount: 10, direction: "income" });
    assert.equal(result.characterBalance, 110); assert.equal(await balance(f), 1000);
    await f.finance.deleteLedger("chat:b", result.entry); assert.equal((await f.wallet.account("chat:b")).balance, 100);
    assert.equal((await f.wallet.ledger("chat:b")).some((entry) => entry.id === row.id), false);
    assert.equal((await f.db.characterTransactions.get(row.id)).status, "voided");
    await f.finance.deleteLedger("chat:b", result.entry); assert.equal((await f.wallet.account("chat:b")).balance, 100);
    await f.wallet.book("chat:b", 20, "expense", { id: "manual1", vts: 1000 }); assert.equal((await f.wallet.account("chat:b")).balance, 100, "tombstone prevents replay");
    assert.equal((await f.db.characterWallets.get("chat:b")).otherAssets, 987);
    assert.deepEqual((await f.db.userWallet.get("main")).fundHoldings, [{ id: "preserve" }]);
  });
  await run("bound mirrors are reversed once even after changing the binding", async (f) => {
    const row = await f.wallet.book("chat:a", 25, "expense", { id: "bound", vts: 1 });
    assert.equal(await balance(f), 975); await identity.save(f.db, "chat:b");
    await f.finance.deleteLedger("chat:a", row);
    assert.equal(await balance(f), 1000); assert.equal((await f.db.characterWallets.get("chat:a")).balance, 100);
    const mirrors = (await f.db.userTransactions.toArray()).filter((bill) => bill.characterEntryId === "bound");
    assert.equal(mirrors.length, 1); assert.equal(mirrors[0].status, "voided"); assert.equal(mirrors[0].ledgerHidden, undefined);
    await f.finance.deleteLedger("chat:a", row); assert.equal(await balance(f), 1000);
  });
  await run("income undo and internal transfers fail atomically on insufficient funds", async (f) => {
    const row = await f.wallet.book("chat:b", 30, "income", { id: "income", vts: 1 });
    await f.wallet.book("chat:b", 120, "expense", { id: "spend", vts: 2 });
    await assert.rejects(f.finance.deleteLedger("chat:b", row), /余额不足/);
    assert.equal((await f.db.characterTransactions.get("income")).status, "posted");
    assert.equal((await f.wallet.account("chat:b")).balance, 10);
    await f.db.characterTransactions.bulkPut([{ id: "pair-exp", key: "chat:a", direction: "expense", amount: 40, status: "posted", vts: 3, source: "scheduled", transferId: "pair", walletDestination: "space" },
      { id: "pair-inc", key: "chat:b", direction: "income", amount: 40, status: "posted", vts: 3, source: "scheduled", transferId: "pair", walletDestination: "character" }]);
    await f.db.userTransactions.add({ type: "expense", amount: 40, characterEntryId: "pair-exp" });
    const payer = await f.db.characterTransactions.get("pair-exp");
    await assert.rejects(f.finance.deleteLedger("chat:a", payer), /余额不足/); assert.equal(await balance(f), 1000);
    assert.equal((await f.db.characterTransactions.get("pair-exp")).status, "posted");
    await f.db.characterWallets.update("chat:b", { balance: 70 });
    await f.finance.editLedger("chat:a", payer, { amount: 50 });
    assert.equal(await balance(f), 990); assert.equal((await f.wallet.account("chat:b")).balance, 80);
    await f.finance.deleteLedger("chat:a", await f.db.characterTransactions.get("pair-exp"));
    assert.equal(await balance(f), 1040); assert.equal((await f.wallet.account("chat:b")).balance, 30);
    const receiver = await f.db.characterTransactions.get("pair-inc"); assert.equal(receiver.ledgerHidden, undefined); assert.equal(receiver.status, "voided");
    await f.finance.deleteLedger("chat:b", receiver); assert.equal(await balance(f), 1040); assert.equal((await f.wallet.account("chat:b")).balance, 30);
  });
  await run("order edit changes only the difference and deletion keeps visible bills and cards", async (f) => {
    const original = await buy(f, "order-edit"); assert.equal(await balance(f), 988);
    const draft = structuredClone(original); draft.items[0].quantity = 2; draft.items[0].item.price = 13; draft.items[0].item.deliveryFee = 3; draft.address = "新地址";
    let result = await f.finance.editOrder(original.id, draft, { expected: original });
    assert.equal(result.order.total, 29); assert.equal(await balance(f), 971); assert.equal(result.order.paidAmount, 29);
    assert.equal(result.order.ownerKey, original.ownerKey); assert.deepEqual(result.order.knownBy, original.knownBy);
    await assert.rejects(f.finance.editOrder(original.id, draft, { expected: original }), /订单已经变化/);
    await f.finance.deleteOrder(original.id, { expected: result.order }); assert.equal(await balance(f), 1000);
    const order = await f.db.marketOrders.get(original.id); assert.equal(order.marketHidden, true); assert.equal(order.items[0].quantity, 2); assert.equal(order.paidAmount, 0);
    const bills = await f.wallet.ledger("chat:a"); assert.equal(bills.length, 2); assert.ok(bills.every((bill) => bill.status === "voided" && !bill.ledgerHidden));
    for (const bill of bills) await f.finance.deleteLedger("chat:a", bill);
    assert.equal(await balance(f), 1000); assert.equal((await f.wallet.ledger("chat:a")).length, 0);
    const chat = await f.db.chats.get("g"); assert.equal(chat.history.length, 1); assert.equal(chat.history[0].orderSnapshot.financialReversed, true);
    await f.finance.deleteOrder(original.id, { expected: original }); assert.equal(await balance(f), 1000);
  });
  await run("removing one purchase bill keeps goods and can never recharge it via order editing", async (f) => {
    let order = await buy(f, "item-delete", [{ item: { id: "a", name: "甲物", merchant: "商家", kind: "goods", price: 10 }, quantity: 1 }, { item: { id: "b", name: "乙物", kind: "goods", price: 20 }, quantity: 1 }]);
    const bill = await first(f, "chat:a", (entry) => entry.name === "甲物");
    let result = await f.finance.deleteLedger("chat:a", bill); assert.equal(await balance(f), 980);
    order = result.order; assert.equal(order.marketHidden, undefined); assert.equal(order.items.length, 2); assert.equal(order.paidAmount, 20);
    const draft = structuredClone(order); draft.items[0].item.price = 100; draft.items[1].item.price = 30;
    order = (await f.finance.editOrder(order.id, draft, { expected: order })).order;
    assert.equal(order.total, 130); assert.equal(order.paidAmount, 30); assert.equal(await balance(f), 970);
    await f.finance.deleteOrder(order.id, { expected: order }); assert.equal(await balance(f), 1000);
    const kept = await first(f, "chat:a"); assert.equal(kept.name, "乙物"); assert.equal(kept.status, "voided");
    assert.equal((await f.db.userTransactions.get(Number(bill.id.slice(5)))).ledgerHidden, true);
  });
  await run("cancellation refunds only actual payment remaining after a bill was revoked", async (f) => {
    const order = await buy(f, "cancel-partial");
    await f.finance.deleteLedger("chat:a", await first(f, "chat:a", (entry) => entry.entryKind === "item"));
    assert.equal(await balance(f), 998);
    const result = await f.orders.act({ type: "cancel_market_order", name: "甲", order_id: order.id }, { chatId: "g", vts: 3 });
    assert.equal(result.order.refundedAmount, 2); assert.equal(await balance(f), 1000);
    assert.equal((await f.db.userTransactions.where("type").equals("income").toArray())[0].amount, 2);
    await f.finance.deleteOrder(order.id, { expected: result.order }); assert.equal(await balance(f), 1000);
    const refunds = (await f.wallet.ledger("chat:a")).filter((row) => row.type === "income"); assert.equal(refunds[0].status, "voided"); assert.equal(refunds[0].ledgerHidden, undefined);
  });
  await run("already-refunded order edits and deleting either refund or charge cannot create money", async (f) => {
    let order = await buy(f, "cancelled-edit");
    order = (await f.orders.act({ type: "cancel_market_order", name: "甲", order_id: order.id }, { chatId: "g", vts: 3 })).order;
    const draft = structuredClone(order); draft.items[0].item.price = 30; draft.items[0].item.deliveryFee = 5;
    order = (await f.finance.editOrder(order.id, draft, { expected: order })).order;
    assert.equal(await balance(f), 1000); assert.equal(order.total, 35);
    const charge = await first(f, "chat:a", (row) => row.entryKind === "item" && row.direction === "expense");
    const adjusted = await f.finance.editLedger("chat:a", charge, { amount: 31 }); assert.equal(await balance(f), 1000);
    let refund = await first(f, "chat:a", (row) => row.entryKind === "item" && row.direction === "income"); assert.equal(refund.amount, 31);
    await f.finance.deleteLedger("chat:a", adjusted.entry); assert.equal(await balance(f), 1000);
    refund = await first(f, "chat:a", (row) => row.entryKind === "item" && row.direction === "income"); assert.equal(refund.status, "voided"); assert.equal(refund.ledgerHidden, undefined);
    await f.finance.deleteLedger("chat:a", refund); assert.equal(await balance(f), 1000);
    order = await f.db.marketOrders.get(order.id); await f.finance.deleteOrder(order.id, { expected: order }); assert.equal(await balance(f), 1000);
  });
  await run("legacy aggregate bills expand to independently reversible item rows", async (f) => {
    const order = await buy(f, "legacy");
    await f.db.userTransactions.clear(); await f.db.userTransactions.add({ type: "expense", amount: 12, orderId: order.id, source: "market", timestamp: 123, vts: order.vts, description: "旧订单" });
    const entries = await f.wallet.ledger("chat:a"); assert.equal(entries.length, 2); assert.match(entries[0].id, /legacy-order/);
    const item = entries.find((entry) => entry.entryKind === "item");
    const result = await f.finance.deleteLedger("chat:a", item); assert.equal(await balance(f), 998); assert.equal(result.order.paidAmount, 2);
    assert.equal((await f.wallet.ledger("chat:a")).length, 1);
    assert.equal((await f.db.userTransactions.toArray()).filter((row) => row.status === "superseded").length, 1);
    await f.finance.deleteOrder(order.id, { expected: result.order }); assert.equal(await balance(f), 1000);
  });
  await run("metadata editing an unposted entry never credits or debits money", async (f) => {
    const row = { id: "failed", key: "chat:b", amount: 0, plannedAmount: 500, direction: "expense", status: "insufficient", vts: 12, description: "没有付成" };
    await f.db.characterTransactions.put(row);
    const result = await f.finance.editLedger("chat:b", row, { description: "只改备注", vts: 13 });
    assert.equal(result.characterBalance, 100); assert.equal(result.entry.status, "insufficient");
    await assert.rejects(f.finance.editLedger("chat:b", result.entry, { amount: 50 }), /未入账/);
    assert.equal(walletCore.dailyBills([{ ...row, ledgerHidden: true }, { ...row, id: "visible", status: "voided", amount: 500 }], 20)[0].expense, 0);
  });
  await run("tracked card deletion reverses payer and receiver but retains the other visible entry", async (f) => {
    const card = { type: "transfer", senderName: "甲", receiverName: "乙", amount: 40, timestamp: 77, vts: 10, status: "pending" };
    let chat = await f.db.chats.get("g"); await f.wallet.reserveCard(chat, card);
    chat = await f.db.chats.get("g");
    const receipt = { type: "pat_message", moneyReceipt: true, forTimestamp: 77, recipientName: "乙", amount: 40, timestamp: 78, vts: 11, content: "乙已领取" };
    await f.db.transaction("rw", f.db.characterWallets, f.db.characterTransactions, f.db.userWallet, f.db.userTransactions, f.db.spaceProfiles, f.db.chats, async () => f.wallet.creditReceived(chat, card, receipt));
    chat.history.push(receipt); await f.db.chats.put(chat);
    assert.equal(await balance(f), 960); assert.equal((await f.wallet.account("chat:b")).balance, 140);
    const funding = await first(f, "chat:a", (row) => row.source === "card");
    await assert.rejects(f.finance.editLedger("chat:a", funding, { amount: 50 }), /转账和红包金额/);
    await f.finance.deleteLedger("chat:a", funding);
    assert.equal(await balance(f), 1000); assert.equal((await f.wallet.account("chat:b")).balance, 100);
    const receiver = await first(f, "chat:b", (row) => row.source === "card"); assert.equal(receiver.status, "voided"); assert.equal(receiver.ledgerHidden, undefined);
    const history = (await f.db.chats.get("g")).history; assert.equal(history[0].isRefund, true); assert.match(history.find((row) => row.moneyReceipt).content, /款项已撤销/);
    await assert.rejects(f.wallet.creditReceived(await f.db.chats.get("g"), card, receipt), /未进行入账/);
    await f.finance.deleteLedger("chat:b", receiver); assert.equal(await balance(f), 1000);
  });
  await run("all debits roll back if one new order amount cannot be funded", async (f) => {
    const order = await buy(f, "too-high"); const draft = structuredClone(order); draft.items[0].item.price = 2000;
    await assert.rejects(f.finance.editOrder(order.id, draft, { expected: order }), /余额不足/);
    assert.equal(await balance(f), 988); assert.deepEqual(await f.db.marketOrders.get(order.id), order);
    assert.deepEqual((await f.db.userTransactions.toArray()).map((row) => row.amount), [10, 2]);
    await assert.rejects(f.finance.deleteLedger("chat:b", await first(f, "chat:a")), /不属于/);
  });
  await run("legacy timestamp-only bills, concurrent edits and independent repeated deletion", async (f) => {
    const id = await f.db.userTransactions.add({ type: "income", amount: 10, timestamp: 100, description: "历史收入" });
    let row = await first(f, "chat:a", (entry) => entry.id === "user:" + id);
    assert.equal(row.vts, 100);
    row = (await f.finance.editLedger("chat:a", row, { description: "旧账修正" })).entry;
    const results = await Promise.allSettled([f.finance.editLedger("chat:a", row, { amount: 11 }), f.finance.editLedger("chat:a", row, { amount: 12 })]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(await balance(f), 1001);
    row = await first(f, "chat:a", (entry) => entry.id === "user:" + id);
    await Promise.all([f.finance.deleteLedger("chat:a", row), f.finance.deleteLedger("chat:a", row)]);
    assert.equal(await balance(f), 990);
  });
  await run("partial refunds retain their net amount and cannot be flattened by a ledger edit", async (f) => {
    let order = await buy(f, "partial");
    const charge = await first(f, "chat:a", (entry) => entry.entryKind === "item");
    const raw = await f.db.userTransactions.get(Number(charge.id.slice(5))); delete raw.id;
    await f.db.userTransactions.add({ ...raw, type: "income", amount: 3, refundOfLineId: raw.orderLineId });
    await f.db.userWallet.update("main", { balance: 991 });
    await assert.rejects(f.finance.editLedger("chat:a", charge, { amount: 20 }), /部分退款/);
    const draft = structuredClone(order); draft.items[0].item.price = 15;
    order = (await f.finance.editOrder(order.id, draft, { expected: order })).order;
    assert.equal(await balance(f), 991, "editing matching purchase/refund by equal delta preserves original net");
    assert.equal(order.paidAmount, 9);
    const result = await f.finance.deleteLedger("chat:a", await first(f, "chat:a", (entry) => entry.entryKind === "item" && entry.direction === "expense"));
    assert.equal(await balance(f), 998); assert.equal(result.order.paidAmount, 2);
    await f.finance.deleteOrder(order.id, { expected: result.order }); assert.equal(await balance(f), 1000);
  });
  await run("a fully revoked order can still be cancelled with zero additional refund", async (f) => {
    let order = await buy(f, "zero-refund");
    order = (await f.finance.deleteOrder(order.id, { expected: order })).order;
    assert.equal(await balance(f), 1000);
    const result = await f.orders.act({ type: "cancel_market_order", name: "甲", order_id: order.id }, { chatId: "g", vts: 3 });
    assert.equal(result.order.refundedAmount, 0); assert.equal(await balance(f), 1000);
    assert.equal((await f.db.userTransactions.where("type").equals("income").toArray()).length, 0);
    const legacyCard = { type: "transfer", amount: 1, timestamp: 990, financialReversed: true, walletFunded: false };
    await assert.rejects(f.wallet.creditReceived(await f.db.chats.get("g"), legacyCard, { recipientName: "甲", amount: 1, vts: 1 }), /已撤销/);
  });
  await run("a failure while updating the last chat card rolls back every earlier financial write", async (f) => {
    const order = await buy(f, "last-write-failure"), oldWallet = await f.db.userWallet.get("main"), oldBills = await f.db.userTransactions.toArray(), oldChat = await f.db.chats.get("g");
    const fail = function (_changes, key) { if (key === "g") throw new Error("synthetic-chat-write-failure"); };
    f.db.chats.hook("updating", fail);
    const draft = structuredClone(order); draft.items[0].item.price = 30; draft.items[0].quantity = 2; draft.items[0].item.deliveryFee = 4;
    try { await assert.rejects(f.finance.editOrder(order.id, draft, { expected: order }), /synthetic-chat-write-failure/); }
    finally { f.db.chats.hook("updating").unsubscribe(fail); }
    assert.deepEqual(await f.db.userWallet.get("main"), oldWallet);
    assert.deepEqual(await f.db.userTransactions.toArray(), oldBills);
    assert.deepEqual(await f.db.marketOrders.get(order.id), order);
    assert.deepEqual(await f.db.chats.get("g"), oldChat);
  });
  console.log("PASS: finance record transactional edits, independent view deletion, net refunds, tombstones, original destinations, legacy bills, mirrors, cards, and rollback safety");
})().catch((error) => { console.error(error); process.exitCode = 1; });
