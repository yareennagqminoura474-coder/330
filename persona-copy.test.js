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
    assert.notEqual(first.id, "a"); assert.equal(first.id, second.id); assert.equal(second.reused, true);
    const npcCopy = await window.EPhoneSpaces.copyNpcData(1, "other");
    const repeatedNpc = await window.EPhoneSpaces.copyNpcData(1, "other");
    assert.equal(npcCopy.id, repeatedNpc.id); assert.equal(repeatedNpc.reused, true);
    assert.deepEqual((await target.npcs.get(npcCopy.id)).associatedWith, [first.id]);
    assert.doesNotMatch(JSON.stringify(await target.npcs.get(npcCopy.id)), /secret|old-npc-key|ephoneArchivedChatId/);
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
    assert.equal((await target.chats.get(groupIds[0])).members[0].id, first.id);
    assert.equal((await target.chats.get(groupIds[1])).members[0].id, first.id);
    assert.equal((await target.chats.get(groupIds[0])).members[1].id, "npc_" + npcCopy.id);
    const countsBeforeRepeat = [await target.chats.count(), await target.npcs.count()];
    const oldGroup = await target.chats.get(groupIds[1]); oldGroup.history = [{ content: "目标空间已有群聊记录" }]; await target.chats.put(oldGroup);
    const duplicates = await Promise.all([copy("watch", "other"), copy("watch", "other")]);
    assert.notEqual(duplicates[0].id, duplicates[1].id);
    assert.deepEqual([await target.chats.count(), await target.npcs.count()], [countsBeforeRepeat[0] + 2, countsBeforeRepeat[1]], "new groups, no extra member profiles");
    for (const result of duplicates) assert.equal((await target.chats.get(result.id)).history.length, 0, "copies must not reopen a target group with old chat history");
    assert.deepEqual((await target.chats.get(groupIds[1])).history, oldGroup.history, "existing target conversation is untouched");
    assert.deepEqual(await source.chats.toArray(), before); assert.deepEqual((await target.chats.get("a")).history, ["destination-data"]);
    for (const table of ["memories", "userTransactions", "spaceProfiles", "spaceClock", "globalSettings"]) assert.equal(await target.table(table).count(), 0);
    assert.equal((await target.userWallet.get("main")).balance, 42);
    await assert.rejects(copy("a", "default"), /另一个/); await assert.rejects(copy("a", "absent"), /有效/); await assert.rejects(copy("missing", "other"), /找不到/);
    const moved = { id: "moved-role", name: "已移动角色", originalName: "已移动角色", settings: { aiPersona: "目标空间更新后的人设" }, history: ["现有聊天"], longTermMemory: ["现有记忆"] };
    await target.chats.add(moved);
    await source.chats.add({ id: "group-with-moved", name: "包含已移动成员", isGroup: true, settings: {}, members: [{ id: "moved-role", originalName: "已移动角色", persona: "移动前的旧人设", ephonePersonaOverride: false }], history: [] });
    const movedGroup = await copy("group-with-moved", "other");
    assert.equal((await target.chats.get(movedGroup.id)).members[0].id, moved.id);
    assert.deepEqual(await target.chats.get(moved.id), moved, "moved identity, edited persona and memories are reused without overwrite");
    const movedOldGroup = { id: "watch", name: "原先移动来的群聊", isGroup: true, isSpectatorGroup: true, members: [], settings: {}, history: [{ content: "已移动群的旧聊天" }], longTermMemory: ["已移动群的总结"] };
    await target.chats.add(movedOldGroup);
    const cleanGroup = await copy("watch", "other");
    assert.notEqual(cleanGroup.id, "watch");
    assert.deepEqual((await target.chats.get(cleanGroup.id)).history, []);
    assert.deepEqual((await target.chats.get(cleanGroup.id)).longTermMemory, []);
    assert.deepEqual(await target.chats.get("watch"), movedOldGroup);
    const legacy = await target.chats.get(first.id); delete legacy.ephoneCopyOrigin; await target.chats.put(legacy);
    assert.equal((await copy("a", "other")).id, first.id, "unmarked v1.7.99 copies are reused by exact identity/profile");
    await source.chats.add({ id: "fail-group", name: "failed group", isGroup: true, settings: {}, members: [{ id: "new-person", originalName: "新人物", persona: "全新人设" }, { id: "npc_77", isNpc: true, originalName: "新NPC", persona: "全新NPC人设" }], history: [] });
    const counts = [await target.chats.count(), await target.npcs.count()];
    class FaultDexie extends Dexie { async open() { await super.open(); this.chats.hook("creating", (_key, value) => { if (value.isGroup) throw new Error("injected copy failure"); }); return this; } }
    window.Dexie = FaultDexie;
    await assert.rejects(copy("fail-group", "other"), /injected/);
    assert.deepEqual([await target.chats.count(), await target.npcs.count()], counts, "all copied members roll back with a failed group");
    console.log("PASS: settings-only role/NPC/group copies; direct, moved, legacy, repeated/concurrent and multiple-group member reuse; current/override/missing personas, scoped NPC links, target edits/history preserved, no history/money/binding/API/clock copies, atomic rollback");
  } finally { await source.delete(); await target.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
