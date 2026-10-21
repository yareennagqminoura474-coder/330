const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity"), wallet = require("./character-wallet-core");
(async () => {
  const db = new Dexie("binding-dedup-" + Date.now());
  db.version(1).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", characterWallets: "&key", userWallet: "&id", characterTransactions: "&id,key,vts", userTransactions: "++id" });
  try {
    await db.open();
    const role = { id: "r", originalName: "甲", name: "私聊备注", settings: { aiPersona: "最新私聊人设" }, history: [{ content: "私聊历史" }] };
    await db.chats.put(role);
    for (let i = 0; i < 3; i++) await db.chats.put({ id: "g" + i, name: "群" + i, isGroup: true, isSpectatorGroup: i === 0, history: [{ content: "历史" + i }],
      members: [{ id: "lost-" + i, originalName: i === 2 ? " 甲　" : "甲", groupNickname: "群昵称" + i, persona: "完全不同的群内人设" + i }] });
    await db.spaceProfiles.put({ id: "player", key: "member:lost-1", name: "甲" });
    await db.characterWallets.put({ key: "chat:r", balance: 345678.90 }); await db.userWallet.put({ id: "main", balance: 600 });
    const oldBill = { id: "legacy-paid", key: "member:lost-0", direction: "expense", amount: 18, category: "food", description: "旧群成员名下的早餐", source: "story", status: "posted", vts: Date.now() - 1000, evidence: { quote: "我付了18元早餐钱。" } };
    await db.characterTransactions.put(oldBill);
    let people = identity.choices(await db.chats.toArray(), []);
    assert.equal(people.length, 1); assert.equal(people[0].key, "chat:r");
    await identity.reconcile(db);
    assert.equal((await db.spaceProfiles.get("player")).key, "chat:r");
    const service = new wallet.Service(db, identity);
    assert.equal((await service.ledger("chat:r", Infinity))[0].description, oldBill.description);
    assert.equal((await service.expenseDuplicate("chat:r", 18, "food", oldBill.vts, oldBill.evidence.quote)).id, oldBill.id);
    assert.deepEqual(await db.characterTransactions.get(oldBill.id), oldBill, "alias history is read, not rewritten or booked again");
    const aliases = (await db.spaceProfiles.get("person-identity-aliases")).aliases;
    assert.equal(identity.canonicalKey("member:lost-0", aliases), "chat:r");
    assert.equal(identity.canonicalKey("a", { a: "b", b: "a" }), "a", "corrupt alias cycles fail closed");
    for (let i = 0; i < 3; i++) {
      const group = await db.chats.get("g" + i);
      assert.equal(group.members[0].id, "r"); assert.equal(group.members[0].persona, "完全不同的群内人设" + i);
      assert.equal(group.members[0].groupNickname, "群昵称" + i); assert.equal(group.history[0].content, "历史" + i);
    }
    // Even without a private archive, three groups are views of one person,
    // not three independently selectable wallet/binding identities.
    for (let i = 0; i < 3; i++) await db.chats.put({ id: "only" + i, isGroup: true, name: "仅群内" + i, members: [{ id: "group-person-" + i, originalName: "乙", persona: "分群设定" + i }], history: [] });
    await db.spaceProfiles.put({ id: "player", key: "member:group-person-2", name: "乙" });
    await identity.reconcile(db);
    people = identity.choices(await db.chats.toArray(), []);
    assert.equal(people.filter((p) => p.name === "乙").length, 1);
    const key = people.find((p) => p.name === "乙").key;
    assert.equal(key, "member:group-person-2", "already-bound identity wins instead of switching wallets");
    for (let i = 0; i < 3; i++) assert.equal(identity.participants(await db.chats.get("only" + i), await db.chats.toArray())[0].key, key);
    await db.chats.put({ id: "earlier-key", isGroup: true, members: [{ id: "000-new-group", originalName: "乙", persona: "又一种群内设定" }], history: [] });
    await identity.reconcile(db);
    assert.equal(identity.choices(await db.chats.toArray(), []).find((p) => p.name === "乙").key, key, "a later group cannot change the canonical identity");
    for (const id of ["a-empty", "z-funded"]) await db.chats.put({ id, isGroup: true, members: [{ id, originalName: "丁", persona: id }], history: [] });
    await db.characterWallets.put({ key: "member:z-funded", configured: true, balance: 200000 });
    await identity.reconcile(db);
    assert.equal(identity.choices(await db.chats.toArray(), []).find((p) => p.name === "丁").key, "member:z-funded", "prefer the existing funded identity over a fresh empty group copy");
    assert.equal((await db.characterWallets.get("member:z-funded")).balance, 200000);
    await db.chats.bulkPut([{ id: "c1", originalName: "同名", settings: { aiPersona: "医生" }, history: [] }, { id: "c2", originalName: "同名", settings: { aiPersona: "教师" }, history: [] }]);
    assert.equal(identity.choices(await db.chats.toArray(), []).filter((p) => p.name === "同名").length, 2, "separate real archives are not merged just by name");
    assert.equal(identity.memberKey({ id: "unknown", originalName: "同名" }, await db.chats.toArray()), "member:unknown");
    assert.equal(identity.memberKey({ id: "nickname-only", groupNickname: "甲", persona: "其他人物" }, await db.chats.toArray()), "member:nickname-only");
    assert.equal((await db.userWallet.get("main")).balance, 600); assert.equal((await db.characterWallets.get("chat:r")).balance, 345678.90);
    assert.deepEqual((await db.chats.get("r")).history, role.history);
    console.log("PASS: only-binding duplicates, 3 orphan group profiles with different/absent personas and normalized names, one archive/person identity, bound group-only stability across new groups, genuine namesakes/nicknames safe, all histories/personas/wallet amounts intact");
  } finally { await db.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
