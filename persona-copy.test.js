const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), crypto = require("node:crypto"), groupContext = require("./group-context");
(async () => {
  const name = "persona-copy-" + Date.now(), source = new Dexie(name), target = new Dexie(name + "__space_other");
  const schema = { chats: "&id", npcs: "++id", memories: "++id", userWallet: "&id", userTransactions: "++id", spaceProfiles: "&id", spaceClock: "&id", globalSettings: "&id" };
  source.version(1).stores(schema); target.version(1).stores(schema); await source.open(); await target.open();
  const storage = new Map([["ephone-persona-spaces-v1", JSON.stringify([{ id: "other", name: "另一空间" }])]]);
  const window = { db: source, Dexie, crypto, EPHONE_DB_BASE_NAME: name, ephoneGroupContext: groupContext };
  const localStorage = { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) };
  vm.runInNewContext(fs.readFileSync("persona-spaces.js", "utf8"), { window, localStorage, structuredClone, document: { addEventListener() {} }, console });
  try {
    const role = { id: "a", ephonePersonKey: "old-person", name: "甲备注", originalName: "甲", avatar: "avatar", history: [{ content: "secret" }],
      longTermMemory: ["secret"], ephoneNpcOrigin: { history: ["secret"] }, lastReplyBatch: "secret", groupId: 17,
      settings: { aiPersona: "甲基础人设", myPersona: "原对象人设", aiAvatar: "avatar", maxMemory: 60, background: "wall",
        linkedWorldBookIds: ["shared-book"], linkedMemoryChatIds: ["old-other"], customAnchorVirtualMs: 1234, latestThought: "secret",
        aiAvatarLibrary: [{ name: "图", url: "pic", history: "secret" }], enableBackgroundActivity: true, unknownState: { history: ["secret"] } } };
    await source.chats.add(role);
    await source.npcs.add({ id: 1, name: "乙", persona: "乙完整人设", avatar: "npcpic", history: ["secret"], associatedWith: ["a", "not-copied"], ephonePersonKey: "old-npc-key" });
    const members = [{ id: "a", originalName: "甲", groupNickname: "师兄", persona: "旧人设", ephonePersonaOverride: false },
      { id: "npc_1", originalName: "乙", persona: "乙本群人设", ephonePersonaOverride: true },
      { id: "missing", originalName: "丙", persona: "仅存群内的完整人设" }];
    for (const spectator of [false, true]) await source.chats.add({ id: spectator ? "watch" : "group", name: spectator ? "围观群" : "普通群", isGroup: true, isSpectatorGroup: spectator,
      members, settings: { myPersona: "用户设定", linkedMemoryChatIds: ["a"] }, history: [{ content: "secret" }], longTermMemory: ["secret"] });
    await source.memories.add({ chatId: "a", content: "secret" });
    await source.userWallet.put({ id: "main", balance: 999 }); await source.spaceProfiles.put({ id: "player", key: "old-person" });
    await target.chats.add({ id: "a", name: "甲", history: ["destination-data"] }); await target.userWallet.put({ id: "main", balance: 42 });
    await target.npcs.add({ id: 1, name: "乙", persona: "目标空间原有NPC", history: ["destination-data"] });
    const before = await source.chats.toArray(), copy = window.EPhoneSpaces.copyChatData;
    const first = await copy("a", "other"), second = await copy("a", "other");
    assert.notEqual(first.id, "a"); assert.notEqual(first.id, second.id);
    const copied = await target.chats.get(first.id);
    assert.equal(copied.settings.aiPersona, "甲基础人设"); assert.equal(copied.settings.maxMemory, 60);
    assert.deepEqual(copied.settings.linkedWorldBookIds, ["shared-book"]); assert.deepEqual(copied.settings.linkedMemoryChatIds, []);
    assert.doesNotMatch(JSON.stringify(copied), /secret|old-person|old-other|customAnchorVirtualMs|groupId|ephoneNpcOrigin/);
    const groupIds = [];
    for (const groupId of ["group", "watch"]) {
      const result = await copy(groupId, "other"), group = await target.chats.get(result.id); groupIds.push(result.id);
      assert.equal(group.isSpectatorGroup, groupId === "watch"); assert.equal(group.history.length, 0); assert.equal(group.members.length, 3);
      const all = Object.fromEntries((await target.chats.toArray()).map((r) => [r.id, r])), npcs = await target.npcs.toArray();
      const profiles = group.members.map((m) => groupContext.memberProfile(m, all, npcs));
      assert.deepEqual(profiles.map((p) => p.persona), ["甲基础人设", "乙本群人设", "仅存群内的完整人设"]);
      assert.notEqual(group.members[0].id, "a"); assert.notEqual(group.members[1].id, "npc_1", "target numeric NPC IDs must not resolve to the source (preseed below)");
      assert.deepEqual(profiles[1].npc.associatedWith, [group.members[0].id]);
      assert.doesNotMatch(JSON.stringify(group), /secret|old-person|old-npc-key/);
    }
    assert.notEqual((await target.chats.get(groupIds[0])).members[0].id, (await target.chats.get(groupIds[1])).members[0].id);
    assert.deepEqual(await source.chats.toArray(), before); assert.deepEqual((await target.chats.get("a")).history, ["destination-data"]);
    for (const table of ["memories", "userTransactions", "spaceProfiles", "spaceClock", "globalSettings"]) assert.equal(await target.table(table).count(), 0);
    assert.equal((await target.userWallet.get("main")).balance, 42);
    await assert.rejects(copy("a", "default"), /另一个/); await assert.rejects(copy("a", "absent"), /有效/); await assert.rejects(copy("missing", "other"), /找不到/);
    const counts = [await target.chats.count(), await target.npcs.count()];
    class FaultDexie extends Dexie { async open() { await super.open(); this.chats.hook("creating", (_key, value) => { if (value.isGroup) throw new Error("injected copy failure"); }); return this; } }
    window.Dexie = FaultDexie;
    await assert.rejects(copy("group", "other"), /injected/);
    assert.deepEqual([await target.chats.count(), await target.npcs.count()], counts, "all copied members roll back with a failed group");
    console.log("PASS: settings-only private/ordinary/spectator copies, independent fresh member IDs, current/override/missing personas, scoped NPC links, no history/money/binding/API/clock copies, source unchanged, repeat-safe, atomic rollback");
  } finally { await source.delete(); await target.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
