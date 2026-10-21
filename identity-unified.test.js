const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity");
(async () => {
  const db = new Dexie("identity-unified-" + Date.now());
  db.version(1).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", characterWallets: "&key", userWallet: "&id" });
  try {
    await db.open();
    const role = { id: "copy-new", name: "私聊备注", originalName: "甲", settings: { aiPersona: "修改后的人设" }, history: ["私聊记录"],
      ephoneCopyOrigin: { database: "original", table: "chats", id: "before-copy" } };
    const lost = { id: "before-copy", originalName: "甲", groupNickname: "师兄", persona: "群内专用设定", ephoneSourcePersona: "修改前的人设", ephonePersonaOverride: true };
    const normal = { id: "g", name: "普通群", isGroup: true, members: [structuredClone(lost)], history: ["普通群历史"] };
    const watch = { id: "w", name: "观看群", isGroup: true, isSpectatorGroup: true, members: [{ ...lost, ephonePersonKey: "old-snapshot" }], history: ["观看群历史"] };
    const npc = { id: 7, name: "乙", persona: "乙人设", ephoneCopyOrigin: { database: "original", table: "npcs", id: "2" } };
    const npcGroup = { id: "n", isGroup: true, members: [{ id: "npc_2", isNpc: true, originalName: "乙", persona: "乙人设" }], history: [] };
    await db.chats.bulkPut([role, normal, watch, npcGroup]); await db.npcs.put(npc);
    await db.characterWallets.put({ key: "chat:copy-new", balance: 300000 }); await db.userWallet.put({ id: "main", balance: 900 });
    await db.spaceProfiles.put({ id: "player", key: "member:before-copy", name: "甲" });
    const chats = await db.chats.toArray(), npcs = await db.npcs.toArray();
    assert.equal(identity.choices(chats, npcs).length, 2, "one entry per person across private/watch/normal groups");
    assert.equal(identity.memberKey(lost, chats, npcs), "chat:copy-new");
    assert.equal(identity.memberKey(watch.members[0], chats, npcs), "chat:copy-new");
    assert.equal(identity.memberKey(npcGroup.members[0], chats, npcs), "npc:7");
    await identity.reconcile(db);
    for (const id of ["g", "w"]) {
      const group = await db.chats.get(id);
      assert.equal(group.members[0].id, role.id); assert.equal(group.members[0].ephonePersonKey, "chat:copy-new");
      assert.equal(group.members[0].persona, lost.persona); assert.equal(group.members[0].groupNickname, "师兄");
      assert.deepEqual(group.history, id === "g" ? normal.history : watch.history);
    }
    assert.equal((await db.chats.get("n")).members[0].id, "npc_7");
    assert.equal((await db.spaceProfiles.get("player")).key, "chat:copy-new");
    assert.equal((await identity.load(db)).valid, true);
    assert.equal((await db.userWallet.get("main")).balance, 900); assert.equal((await db.characterWallets.get("chat:copy-new")).balance, 300000);
    assert.deepEqual((await db.chats.get(role.id)).history, role.history);
    const settled = await db.chats.toArray(); await identity.reconcile(db); assert.deepEqual(await db.chats.toArray(), settled, "idempotent reconciliation");
    // Group-specific profiles do not create a second identity when the real
    // name identifies exactly one archive. Explicit independent people and
    // ambiguous duplicate archives must remain separate.
    const base = [{ id: "r", originalName: "丙", settings: { aiPersona: "医生" } }];
    assert.equal(identity.memberKey({ id: "orphan", originalName: "丙", persona: "医生" }, base), "chat:r");
    assert.equal(identity.memberKey({ id: "orphan", originalName: "丙", persona: "群里的不同设定" }, base), "chat:r");
    assert.equal(identity.memberKey({ id: "orphan", originalName: "丙" }, base), "chat:r");
    assert.equal(identity.memberKey({ id: "orphan", originalName: "丙", ephoneIndependentIdentity: true }, base), "member:orphan");
    assert.equal(identity.memberKey({ id: "orphan", originalName: "丙", persona: "医生" }, [...base, { ...base[0], id: "another" }]), "member:orphan");
    await identity.save(db, "chat:copy-new"); assert.equal((await identity.load(db)).key, "chat:copy-new");
    console.log("PASS: one canonical copied role/NPC across all groups/private/binding; provenance after persona edits; exact-profile and ambiguous-name safety; legacy binding repair; group persona/nickname/history and balances preserved; idempotent references only");
  } finally { await db.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
