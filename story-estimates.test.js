const assert = require("node:assert/strict"); require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity.js"), expenses = require("./story-expenses.js"), { Service } = require("./character-wallet-core.js");
(async () => {
  const db = new Dexie("estimate-" + Date.now()); db.version(1).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", userWallet: "&id", userTransactions: "++id", characterWallets: "&key", characterTransactions: "&id,key,vts,category", marketOrders: "&id" }); await db.open();
  try {
    await db.chats.bulkPut([{ id: "a", name: "甲", settings: { aiPersona: "普通家庭，节俭" }, history: [] }, { id: "b", name: "乙", settings: { aiPersona: "家庭富裕，收入优渥" }, history: [] }]);
    const chat = { id: "g", isGroup: true, members: [{ id: "a", originalName: "甲" }, { id: "b", originalName: "乙" }], settings: {}, history: [] };
    await db.chats.put(chat); const service = new Service(db), people = identity.participants(chat, await db.chats.toArray());
    await service.save("chat:a", { balance: 1000, automatic: false, rules: [] }, 100, 0); await service.save("chat:b", { balance: 1000, automatic: false, rules: [] }, 100, 0);
    const msg = (content, timestamp, senderName = "甲", type = "text") => ({ type, role: "assistant", senderName, timestamp, vts: 1000 + timestamp, content });
    const options = { infer: true, history: [msg("奶茶每杯18元。", 1)], personas: { "chat:b": "家庭富裕" } };
    let claims = expenses.extract(msg("我买了两杯奶茶。", 2), people, identity.resolve, options); assert.equal(claims[0].amount, 36); assert.equal(claims[0].estimated, true); assert.equal(claims[0].estimate.items[0].quantity, 2);
    assert.equal(expenses.extract(msg("我买好了两杯奶茶。", 2), people, identity.resolve, options)[0].amount, 36);
    assert.deepEqual(expenses.extract(msg("我买了免费赠送的书。", 2), people, identity.resolve, options), []);
    claims = expenses.extract(msg("我买了两杯奶茶。", 2, "乙"), people, identity.resolve, { infer: true, personas: { "chat:b": "家庭富裕" } }); assert.equal(claims[0].amount, 56);
    claims = expenses.extract(msg("甲选了两杯奶茶。甲结账了。", 3, "旁白", "narration"), people, identity.resolve, options); assert.equal(claims[0].amount, 36);
    claims = expenses.extract(msg("甲付完钱。", 4, "旁白", "narration"), people, identity.resolve, { ...options, history: [...options.history, msg("甲拿了两杯奶茶。", 3, "旁白", "narration")] }); assert.equal(claims[0].amount, 36);
    for (const content of ["我打算买两杯奶茶。", "我还没付完钱。", "我用手机付款成功。", "我去书店付了钱。", "他买了奶茶。", "乙说我买了奶茶。", "我买了奶茶吗？"])
      assert.deepEqual(expenses.extract(msg(content, 5), people, identity.resolve, options), [], content);
    async function capture(message) { const saved = await db.chats.get("g"); saved.history.push(message); await db.chats.put(saved); return service.captureExpenses(saved, [message], message.vts); }
    await capture(msg("奶茶每杯18元。", 1)); let result = await capture(msg("我买了两杯奶茶。", 2));
    assert.equal(result.entries[0].amount, 36); assert.match(result.notices[0].content, /估算支出|前文单价/); assert.equal((await service.account("chat:a")).balance, 964);
    await service.correctEstimate(result.entries[0].id, 30); assert.equal((await service.account("chat:a")).balance, 970); assert.equal((await db.characterTransactions.get(result.entries[0].id)).amount, 30); assert.match((await db.chats.get("g")).history.at(-1).content, /已校正支出 ¥30/);
    await assert.rejects(service.correctEstimate(result.entries[0].id, 5000), /余额不足/); assert.equal((await service.account("chat:a")).balance, 970);
    await service.book("chat:a", 25, "expense", { id: "scheduled", source: "scheduled", category: "food", vts: 1000, description: "午饭" });
    result = await capture(msg("我又买了一杯奶茶。", 6)); assert.equal(result.entries.length, 1);
    await db.userWallet.put({ id: "main", balance: 300 }); await db.spaceProfiles.put({ id: "player", key: "chat:b" });
    await db.marketOrders.put({ id: "o", ownerKey: "chat:b", status: "paid", vts: 1000, total: 23, items: [{ item: { name: "奶茶", price: 20 }, quantity: 1 }] });
    result = await capture(msg("我买了一杯奶茶。", 7, "乙")); assert.equal(result.entries.length, 0); assert.equal((await db.userWallet.get("main")).balance, 300);
    console.log("PASS: no-amount paid purchases, context prices/quantities and same-payer checkout context, marked household-based references, correction of original debit/notice, insufficient correction rollback, no tools/locations/plans/ambiguous payer charges, scheduled and market duplicate protection");
  } finally { db.close(); await Dexie.delete(db.name); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
