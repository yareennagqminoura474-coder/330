"use strict";
const assert = require("node:assert/strict"), core = require("./novel-sources.js");
const identity = require("./player-identity.js"), groupContext = require("./group-context.js");
function table(rows) {
  const calls = [], byId = new Map(rows.map((row) => [row.id, row]));
  return { calls, bulkGet: async (keys) => { calls.push(keys); return keys.map((key) => byId.get(key)); },
    toArray: async () => { calls.push("scan"); return rows; } };
}
(async () => {
  const image = "data:image/png;base64," + "x".repeat(200000), outsider = { id: "outsider", name: "别的人", avatar: image, history: [{ content: "PRIVATE_UNSELECTED_HISTORY" }], longTermMemory: [{ content: "PRIVATE_UNSELECTED_MEMORY" }], settings: { aiPersona: "仍保留身份解析需要的人设", aiAvatar: image, myPersona: "原用户设定" } };
  const source = { id: "role", name: "角色", originalName: "角色本名", ephonePersonKey: "chat:role", ephoneCopyOrigin: { table: "chats", id: "old-role" }, settings: { aiPersona: "源档案已更新", aiAvatar: image }, history: [{ content: "角色本人完整历史" }], longTermMemory: [{ content: "角色本人完整记忆" }] };
  const member = { id: "old-role", originalName: "角色本名", persona: "群内专用人设", ephonePersonaOverride: true, avatar: image };
  const npc = { id: 7, name: "NPC", persona: "NPC完整资料" };
  const selected = { id: "selected-group", name: "所选群", isGroup: true, isSpectatorGroup: true, members: [member, { id: "npc_7", isNpc: true, originalName: "NPC", persona: "NPC旧快照" }], settings: { scenario: "群场景" }, history: [{ content: "完整群历史" }], longTermMemory: [{ content: "完整群记忆" }] };
  const orphan = { id: "orphan-group", isGroup: true, members: [{ id: "orphan", originalName: "群内角色", persona: "只有群内档案", ephoneIndependentIdentity: true, ephoneIdentityPrimary: true, ephoneIdentityFunded: true, avatar: image }], history: [{ content: "UNSELECTED_GROUP_HISTORY" }] };
  const stale = structuredClone([selected, source, outsider, orphan]); stale[0].history = [{ content: "过时群历史" }]; stale[1].settings.aiPersona = "过时源人设";
  const snapshot = JSON.stringify(stale), db = table([selected, source, outsider, orphan, { id: 7, name: "数字ID私聊", history: [{ content: "不能把NPC当作此私聊" }] }]);
  const loaded = await core.loadChats(db, Object.fromEntries(stale.map((row) => [row.id, row])), ["selected-group"], [npc], { identity, groupContext });
  assert.ok(!db.calls.includes("scan"), "available cache must never trigger a whole-chat table read");
  const usedKeys = db.calls.flat(); assert.deepEqual(new Set(usedKeys), new Set(["selected-group", "role"]), "only selected group and actual copied canonical source are fetched");
  assert.equal(loaded.find((row) => row.id === "selected-group"), selected);
  assert.equal(loaded.find((row) => row.id === "role"), source, "full latest canonical role is fetched, not a stale cached persona");
  const unselected = loaded.find((row) => row.id === "outsider");
  assert.equal(unselected.history, undefined); assert.equal(unselected.longTermMemory, undefined); assert.equal(unselected.avatar, undefined); assert.equal(unselected.settings.aiAvatar, undefined);
  assert.equal(unselected.settings.aiPersona, outsider.settings.aiPersona); assert.equal(unselected.settings.myPersona, outsider.settings.myPersona);
  const groupMetadata = loaded.find((row) => row.id === "orphan-group");
  assert.equal(groupMetadata.history, undefined); assert.equal(groupMetadata.members[0].persona, "只有群内档案"); assert.equal(groupMetadata.members[0].ephoneIdentityPrimary, true); assert.equal(groupMetadata.members[0].ephoneIdentityFunded, true); assert.equal(groupMetadata.members[0].ephoneIndependentIdentity, true); assert.equal(groupMetadata.members[0].avatar, undefined);
  assert.equal(JSON.stringify(stale), snapshot, "cache and member/settings objects must not be mutated");
  const groupProfiles = groupContext.buildContext({ chat: selected, chats: Object.fromEntries(loaded.map((row) => [row.id, row])), npcs: [npc] }).profiles;
  assert.equal(groupProfiles[0].sourcePersona, "源档案已更新"); assert.equal(groupProfiles[0].persona, "群内专用人设");
  assert.equal(groupProfiles[1].npc, npc);
  const deletedDb = table([source]);
  const deleted = await core.loadChats(deletedDb, stale, ["selected-group"], [npc], { identity, groupContext });
  assert.equal(deleted.some((row) => row.id === "selected-group"), false, "deleted selections cannot remain as cached ghosts");
  const numeric = { id: 123, name: "数字ID角色", settings: { aiPersona: "数字人设" }, history: [{ content: "数字历史" }] };
  const numberDb = table([numeric]); assert.equal((await core.loadChats(numberDb, [], ["123"], [], { identity, groupContext }))[0], numeric);
  assert.ok(!numberDb.calls.includes("scan"), "empty known cache is not the same as an unavailable cache");
  const stringDb = table([{ ...numeric, id: "123" }]); assert.equal((await core.loadChats(stringDb, [], [123], [], {}))[0].id, "123");
  const noCache = table([numeric]); assert.equal((await core.loadChats(noCache, null, ["123"]))[0], numeric); assert.deepEqual(noCache.calls, ["scan"]);
  const uncachedGroup = { id: "new-group", isGroup: true, members: [{ id: "123", originalName: "数字ID角色", persona: "旧群快照", ephonePersonaOverride: false }, { id: "group-only", originalName: "群内独有角色", persona: "保持完整群内人设", ephoneIndependentIdentity: true }], history: [{ content: "新群完整消息" }] };
  const uncachedDb = table([uncachedGroup, numeric]), freshGroupRecords = await core.loadChats(uncachedDb, [], ["new-group"], [], { identity, groupContext });
  assert.equal(freshGroupRecords.find((row) => row.id === 123), numeric, "direct member IDs are fetched even when the new group/source is not cached yet");
  assert.equal(groupContext.buildContext({ chat: uncachedGroup, chats: Object.fromEntries(freshGroupRecords.map((row) => [row.id, row])) }).profiles[1].persona, "保持完整群内人设");
  assert.ok(!uncachedDb.calls.includes("scan"));
  const selectedNPC = table([numeric]); await core.loadChats(selectedNPC, [numeric], ["npc_7"], [npc], { identity, groupContext }); assert.deepEqual(selectedNPC.calls, [], "selecting an NPC never fetches a colliding chat ID");
  console.log("PASS: selected/canonical fresh bulk reads, complete personas/history/memory, cached identity metadata only, copied/group-only/NPC semantics, typed keys, deleted selections, lossless cache and unavailable-cache fallback");
})().catch((error) => { console.error(error); process.exitCode = 1; });
