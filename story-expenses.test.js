const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity.js"), expenses = require("./story-expenses.js"), { Service } = require("./character-wallet-core.js");
const at = (day = 5, minute = 0) => new Date(2026, 2, day, 10, minute).getTime();
(async () => {
  const db = new Dexie("story-expense-test-" + Date.now());
  db.version(54).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", userWallet: "&id", userTransactions: "++id", characterWallets: "&key", characterTransactions: "&id,key,vts,category", marketOrders: "&id" });
  try {
    await db.open();
    const members = ["甲", "乙", "丙"].map((originalName, i) => ({ id: "r" + i, originalName }));
    await db.chats.bulkPut(members.map((m) => ({ id: m.id, name: m.originalName, history: [], settings: {} })));
    let chat = { id: "g", isGroup: true, members, history: [] }; await db.chats.put(chat);
    const s = new Service(db), people = identity.participants(chat, await db.chats.toArray());
    const msg = (content, timestamp = 100, type = "text", senderName = "甲") => ({ role: "assistant", senderName, type, content, timestamp, vts: at() });
    assert.equal(expenses.extract(msg("我买了本书，花了35元。"), people, identity.resolve)[0].amount, 35);
    assert.equal(expenses.extract(msg("我刚才买了本书，花了35元。"), people, identity.resolve)[0].amount, 35);
    for (const content of ["我付了20元吗？", "不是我付了20元。", "我说我付了20元。", "我付了-20元。", "我付了20元？我打算买书花30元。"])
      assert.deepEqual(expenses.extract(msg(content), people, identity.resolve), [], content);
    assert.equal(expenses.extract(msg("乙付了三十二元车费。", 1, "narration", "旁白"), people, identity.resolve)[0].key, "chat:r1");
    assert.equal(expenses.cash("1,234.56"), 1234.56); assert.equal(expenses.cash("两百三十"), 230); assert.equal(expenses.cash("2万"), 20000);
    for (const content of ["我打算买一本书花35元。", "我没有付了35元。", "我昨天买了书，花了35元。", "如果买了书，会花35元。", "书标价35元。", "乙说甲买了书花了35元。", "甲帮乙买了书花了35元。", "我付过35元了。", "我给你转账付了35元。", "我花了35美元。", "我花了30元买书，又花了5元买笔。"])
      assert.deepEqual(expenses.extract(msg(content), people, identity.resolve), [], content);
    assert.deepEqual(expenses.extract({ ...msg("我付了35元。"), walletEntry: true }, people, identity.resolve), []);
    const config = (balance) => ({ balance, rules: [], automatic: false });
    await s.save("chat:r0", config(500), at(), 0); await s.save("chat:r1", config(10), at(), 0);
    await db.userWallet.put({ id: "main", balance: 100, preserved: true });
    async function capture(m, vts = at()) { chat = await db.chats.get("g"); chat.history.push(m); await db.chats.put(chat); return s.captureExpenses(chat, [m], vts); }
    let result = await capture(msg("我买了本书，花了35元。"));
    assert.equal(result.entries[0].amount, 35); assert.equal((await s.account("chat:r0")).balance, 465); assert.equal((await db.userWallet.get("main")).balance, 100);
    assert.equal(result.notices.length, 1); assert.equal(result.entries[0].evidence.timestamp, 100);
    result = await s.captureExpenses(result.chat, [msg("我买了本书，花了35元。")], at()); assert.equal(result.entries.length, 0);
    result = await capture(msg("我买了本书，花了35元。", 101), at(5, 5)); assert.equal(result.entries.length, 0, "repeating the same payment is not another purchase");
    result = await capture(msg("我又买了本书，花了35元。", 102)); assert.equal(result.entries.length, 1); assert.equal((await s.account("chat:r0")).balance, 430);
    assert.ok(await s.expenseDuplicate("chat:r0", 35, "shopping", at(), "我又买了本书，花了35元。"));
    result = await capture(msg("我买了本书，花了35元。", 103), at(6)); assert.equal(result.entries.length, 1);
    // Named narration charges the actual payer; insufficient funds are visible and never negative.
    result = await capture(msg("乙付了20元车费。", 104, "narration", "旁白"));
    assert.equal(result.entries[0].status, "insufficient"); assert.equal((await s.account("chat:r1")).balance, 10); assert.match(result.notices[0].content, /余额不足/);
    result = await capture(msg("丙花了20元买午饭。", 105, "narration", "旁白")); assert.equal(result.entries[0].status, "unconfigured");
    assert.equal((await s.account("chat:r2")).balance, 0);
    // A bound role always uses the existing space wallet, even before setting a recurring plan.
    await db.spaceProfiles.put({ id: "player", key: "chat:r2" });
    result = await capture(msg("我已支付25元早餐。", 106, "text", "丙"));
    assert.equal(result.entries[0].status, "posted"); assert.equal((await db.userWallet.get("main")).balance, 75); assert.equal((await db.userWallet.get("main")).preserved, true);
    await db.marketOrders.put({ id: "paid-order", ownerKey: "chat:r2", vts: at(), status: "paid", total: 18 });
    result = await capture(msg("我已支付18元外卖。", 107, "text", "丙")); assert.equal(result.entries.length, 0, "paid market order is not charged again from chat");
    // Scheduled cost already in the ledger and explicit API commands must not produce another debit.
    await s.book("chat:r0", 12, "expense", { id: "explicit", vts: at(), category: "transport", source: "story" });
    result = await capture(msg("我付了12元车费。", 108)); assert.equal(result.entries.length, 0);
    await s.book("chat:r0", 20, "expense", { id: "scheduled", vts: at(), category: "food", source: "scheduled" });
    result = await capture(msg("我花了20元买午饭。", 109)); assert.equal(result.entries.length, 0);
    result = await capture(msg("我额外花了8元买咖啡。", 110)); assert.equal(result.entries.length, 1);
    const balance = (await s.account("chat:r0")).balance, newMessage = msg("我买了衣服，花了50元。", 111);
    chat = await db.chats.get("g"); chat.history.push(newMessage); await db.chats.put(chat);
    const hook = db.chats.hook("updating", () => { throw new Error("fixture chat write failure"); });
    await assert.rejects(s.captureExpenses(chat, [newMessage], at()), /fixture/); db.chats.hook("updating").unsubscribe(hook);
    assert.equal((await s.account("chat:r0")).balance, balance, "payment and chat notice roll back together");
    assert.equal((await db.characterTransactions.toArray()).filter((r) => r.evidence?.timestamp === 111).length, 0);
    console.log("PASS: actual text/narration expenses, Chinese amounts, correct payer, bound wallet, no planned/past/quoted costs, source proof, duplicate explicit/market/scheduled protection, insufficient/unconfigured visibility and atomic rollback");
  } finally { db.close(); await Dexie.delete(db.name); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
