const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity"), core = require("./character-wallet-core");
(async () => {
  const db = new Dexie("wallet-balance-context-" + Date.now());
  db.version(1).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", userWallet: "&id", userTransactions: "++id,timestamp,type", characterWallets: "&key", characterTransactions: "&id,key,vts,category" });
  try {
    await db.open();
    const role = { id: "copied-role", name: "备注名", originalName: "甲", settings: { aiPersona: "初始只有3000元" }, history: [] };
    await db.chats.put(role);
    await db.npcs.put({ id: 1, name: "乙", ephonePersonKey: "stable-npc" });
    const members = [{ id: role.id, ephonePersonKey: "source-space-role", originalName: "甲", groupNickname: "师兄" }, { id: "npc_1", isNpc: true, ephonePersonKey: "source-space-npc", originalName: "乙" }];
    await db.characterWallets.bulkPut([
      { key: "chat:copied-role", balance: 345678.90, configured: true, automatic: false, rules: [] },
      { key: "source-space-role", balance: 3000, configured: true, rules: [] },
      { key: "stable-npc", balance: 80, configured: false, rules: [] }
    ]);
    const service = new core.Service(db, identity), vts = Date.now();
    for (const chat of [role, { isGroup: true, members }, { isGroup: true, isSpectatorGroup: true, members }]) {
      const context = await service.replyContext(chat, vts);
      assert.equal(context.records[0].balance, 345678.90);
      assert.equal(context.records[0].key, "chat:copied-role");
      assert.match(context.reminder, /"availableCNY":"345678.90"/);
      assert.match(context.prompt, /覆盖人设中的初始金额、历史台词、旧总结/);
      assert.doesNotMatch(context.reminder, /source-space|3000/);
      if (chat.members) {
        assert.ok(context.records[0].aliases.includes("师兄"));
        assert.equal(context.records[1].key, "stable-npc");
        assert.equal(context.records[1].balanceKnown, true, "actual received money remains known before a spending plan is configured");
        assert.equal(context.records[1].configured, false);
      }
    }
    const stored = [{ role: "user", content: "旧记录：只剩三千元。" }], before = structuredClone(stored);
    const first = await service.replyContext(role, vts), outgoing = core.withBalanceReminder(stored, first.reminder);
    assert.deepEqual(stored, before); assert.notEqual(outgoing, stored);
    assert.ok(outgoing[0].content.indexOf("345678.90") > outgoing[0].content.indexOf("三千"));
    await db.characterWallets.update("chat:copied-role", { balance: 222222.22 });
    const second = await service.replyContext(role, vts);
    assert.match(second.reminder, /222222.22/); assert.doesNotMatch(second.reminder, /345678.90/);
    await db.spaceProfiles.put({ id: "player", key: "chat:copied-role" });
    await db.userWallet.put({ id: "main", balance: 456789 });
    assert.equal((await service.replyContext(role, vts)).records[0].balance, 456789);
    await db.userWallet.update("main", { balance: 0 });
    const zero = (await service.replyContext(role, vts)).records[0]; assert.equal(zero.balanceKnown, true); assert.equal(zero.balance, 0);
    assert.equal((await service.replyContext({ id: "unset", name: "丙" }, vts)).records[0].balanceKnown, false);
    const imageMessages = [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,test" } }] }], imageBefore = structuredClone(imageMessages);
    const withImage = core.withBalanceReminder(imageMessages, second.reminder);
    assert.deepEqual(imageMessages, imageBefore); assert.deepEqual(withImage[0].content[0], imageMessages[0].content[0]);
    assert.equal(withImage[0].content[1].type, "text");
    assert.equal(core.withBalanceReminder([{ role: "assistant", content: "旧余额" }], second.reminder).at(-1).role, "user");
    assert.equal(core.withBalanceReminder(stored, ""), stored);
    assert.equal(await db.characterTransactions.count(), 0, "context preparation must not book or modify money");
    assert.equal((await db.characterWallets.get("chat:copied-role")).balance, 222222.22);
    console.log("PASS: latest authoritative balances, copied stale role/NPC keys, aliases, known received/zero funds, unknown accounts, bound wallet, fresh snapshots, immutable history/images, no money writes");
  } finally { await db.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
