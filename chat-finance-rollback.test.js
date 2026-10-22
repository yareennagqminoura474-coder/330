const assert = require("node:assert/strict"); require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity.js"), finance = require("./character-wallet-core.js"), { Service } = require("./chat-finance-rollback.js");
const at = (minute) => new Date(2026, 2, 5, 10, minute).getTime();
(async () => {
  const db = new Dexie("chat-rollback-" + Date.now()); db.version(1).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", userWallet: "&id", userTransactions: "++id", characterWallets: "&key", characterTransactions: "&id,key,vts,category", spaceClock: "&id", marketOrders: "&id" }); await db.open();
  try {
    await db.chats.bulkPut([{ id: "a", name: "甲", settings: {}, history: [] }, { id: "b", name: "乙", settings: {}, history: [] }]);
    await db.userWallet.put({ id: "main", balance: 500, preserved: true }); await db.spaceProfiles.put({ id: "player", key: "chat:b" });
    await db.characterWallets.bulkPut([{ key: "chat:a", balance: 500, configured: true, revision: 0 }, { key: "chat:b", balance: 90, configured: true, revision: 0 }]);
    const f = new finance.Service(db, identity), service = new Service(db), members = [{ id: "a", originalName: "甲" }, { id: "b", originalName: "乙" }];
    await db.spaceClock.put({ id: "main", mode: "custom", flow: "frozen", anchorVirtualMs: at(20), revision: 2 });
    let chat = { id: "g", isGroup: true, members, settings: {}, history: [{ role: "user", content: "保留的前文", timestamp: 1, vts: at(0) }, { type: "narration", content: "甲买了本书，花了35元。", timestamp: 2, vts: at(10) }] };
    await db.chats.put(chat); const captured = await f.captureExpenses(chat, [chat.history[1]], at(10));
    assert.equal((await db.characterWallets.get("chat:a")).balance, 465);
    // Same date and amount in another chat are NEVER selected by a time range.
    await f.book("chat:a", 35, "expense", { id: "other-chat", chatId: "other", sourceTimestamp: 2, source: "story", vts: at(10) });
    await db.userTransactions.add({ orderId: "independent-order", chatId: "g", sourceTimestamp: 2, type: "expense", amount: 10, vts: at(10) });
    let result = await service.remove("g", [2]); assert.equal(result.chat.history.length, 1); assert.equal(result.removedEntries, 1);
    assert.equal((await db.characterWallets.get("chat:a")).balance, 465, "only selected expense is refunded"); assert.ok(await db.characterTransactions.get("other-chat"));
    assert.equal((await db.userTransactions.toArray()).filter((b) => b.orderId).length, 1); assert.equal(result.clock.anchorVirtualMs, at(0)); assert.equal(result.clock.holdNextReply, true);
    result = await service.remove("g", [2]); assert.equal(result.removedEntries, 0, "repeated delete cannot refund again");
    // Funded transfer: deletion removes debit + receipts, balances return to exact originals.
    const card = { type: "transfer", senderName: "甲", receiverName: "乙", amount: 100, timestamp: 10, vts: at(10), status: "accepted", acceptedBy: "乙", walletFunded: true };
    const receipt = { type: "pat_message", moneyReceipt: true, forTimestamp: 10, recipientName: "乙", walletDestination: "chat:b", timestamp: 11, amount: 100, vts: at(11) };
    chat = { ...result.chat, history: [...result.chat.history, card, receipt] }; await db.chats.put(chat);
    await f.book("chat:a", 100, "expense", { id: "card:g:10", source: "card", chatId: "g", sourceTimestamp: 10, vts: at(10) });
    await f.book("chat:b", 100, "income", { id: "receipt:g:10:chat:b", source: "card", chatId: "g", sourceTimestamp: 10, noticeTimestamp: 11, vts: at(11) });
    const beforeSender = (await db.characterWallets.get("chat:a")).balance;
    result = await service.remove("g", [11]); assert.equal(result.chat.history.at(-1).status, "pending"); assert.equal((await db.userWallet.get("main")).balance, 500); assert.equal((await db.characterWallets.get("chat:a")).balance, beforeSender);
    // Re-receive, then erase original card. New receipt is also erased/refunded.
    chat = await db.chats.get("g"); chat.history[1].status = "accepted"; chat.history.push({ ...receipt, timestamp: 12 }); await db.chats.put(chat);
    await f.book("chat:b", 100, "income", { id: "receipt:g:10:chat:b", source: "card", chatId: "g", sourceTimestamp: 10, noticeTimestamp: 12, vts: at(12) });
    result = await service.remove("g", [10]); assert.equal(result.chat.history.length, 1); assert.equal((await db.userWallet.get("main")).balance, 500); assert.equal((await db.characterWallets.get("chat:a")).balance, beforeSender + 100);
    // Destination is the ORIGINAL wallet, not whichever character is currently bound.
    await db.chats.put({ ...chat, history: [{ timestamp: 20, vts: at(20), content: "收入" }] });
    await f.book("chat:b", 40, "income", { id: "bound-before-switch", source: "story", chatId: "g", noticeTimestamp: 20, vts: at(20) });
    await db.spaceProfiles.put({ id: "player", key: "chat:a" });
    result = await service.remove("g", [20]); assert.equal((await db.userWallet.get("main")).balance, 500); assert.equal((await db.characterWallets.get("chat:b")).balance, 90);
    // Atomic rollback when the final chat write fails, including the clock.
    await db.chats.put({ id: "g", isGroup: true, members, history: [{ timestamp: 30, vts: at(20), content: "付款" }, { timestamp: 31, vts: at(21), content: "其他" }] });
    await f.book("chat:b", 20, "expense", { id: "atomic", source: "story", chatId: "g", sourceTimestamp: 30, vts: at(20) });
    const walletBefore = await db.characterWallets.get("chat:b"), clockBefore = await db.spaceClock.get("main");
    const hook = () => { throw new Error("fixture final chat write failed"); }; db.chats.hook("updating", hook);
    await assert.rejects(service.remove("g", [30]), /fixture/); db.chats.hook("updating").unsubscribe(hook);
    assert.deepEqual(await db.characterWallets.get("chat:b"), walletBefore); assert.deepEqual(await db.spaceClock.get("main"), clockBefore); assert.ok(await db.characterTransactions.get("atomic"));
    // Spent income cannot be silently clamped, converted to debt or removed halfway.
    await db.chats.put({ id: "g", history: [{ timestamp: 40, vts: at(20), content: "已收到" }] });
    await db.userWallet.update("main", { balance: 0 });
    await db.userTransactions.add({ chatId: "g", forTimestamp: 40, timestamp: 41, moneyReceipt: true, amount: 30, type: "income" });
    await assert.rejects(service.remove("g", [40]), /余额会不足/); assert.equal((await db.chats.get("g")).history.length, 1);
    // A bill deleted in the ledger keeps a tombstone: removing its original
    // chat later cannot apply its already-reversed money for a second time.
    await db.chats.put({ id: "revoked", history: [{ type: "transfer", timestamp: 50, status: "declined", walletVoided: true, financialReversed: true, vts: at(20) }, { type: "pat_message", timestamp: 51, forTimestamp: 50, moneyReceipt: true, recipientName: "乙", amount: 30, vts: at(21) }] });
    await db.userTransactions.add({ chatId: "revoked", forTimestamp: 50, timestamp: 51, moneyReceipt: true, amount: 30, type: "income", status: "voided", financialReversed: true });
    await service.remove("revoked", [51]);
    assert.equal((await db.userWallet.get("main")).balance, 0, "already reversed user receipt cannot debit again");
    assert.equal((await db.chats.get("revoked")).history[0].status, "declined", "a revoked funding card never becomes claimable again");
    await db.chats.put({ id: "revoked-expense", history: [{ type: "text", timestamp: 52, vts: at(21) }] });
    await db.userTransactions.add({ chatId: "revoked-expense", sourceTimestamp: 52, amount: 40, type: "expense", status: "voided", financialReversed: true, ledgerHidden: true });
    await service.remove("revoked-expense", [52]);
    assert.equal((await db.userWallet.get("main")).balance, 0, "a hidden reversed expense cannot be refunded again by chat deletion");
    console.log("PASS: chat-scoped actual balance/ledger undo, unrelated chat/order preservation, notices, card and receipt-only rollback/reclaim, original wallet after binding changes, idempotency, clock/first-round hold, complete atomic failure, spent-income safety and no double reversal of ledger-deleted money");
  } finally { db.close(); await Dexie.delete(db.name); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
