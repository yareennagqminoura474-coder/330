const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity.js"), core = require("./character-social-core.js");
(async () => {
  const db = new Dexie("context-scope-" + Date.now()); db.version(1).stores({ chats: "&id", npcs: "++id,name", characterRelations: "&id,a,b", characterLives: "&key", relationshipEvents: "&id,chatId,vts,status" }); await db.open();
  try {
    const members = [{ id: "a", originalName: "甲老师" }, { id: "b", originalName: "乙老师" }];
    const chat = { id: "group", isGroup: true, members, settings: { maxMemory: 30 }, history: [{ type: "text", content: "明天向联系01请教这件事。" }], longTermMemory: [{ content: "关于联系02的完整记忆，全部保留。" }] };
    await db.chats.bulkPut([{ id: "a", name: "甲老师", settings: { aiPersona: "当前成员完整档案" }, longTermMemory: [{ content: "联系03帮过我。" }] }, { id: "b", name: "乙老师", settings: { aiPersona: "乙老师人设" } }, chat]);
    let oldExpanded = 0;
    for (let i = 1; i <= 35; i++) {
      const name = "联系" + String(i).padStart(2, "0"), persona = "ONLY_PROFILE_" + i + "_" + "该人物完整的生活性格经历。".repeat(210) + "_完整尾部";
      await db.npcs.add({ id: i, name, persona });
      for (const key of ["chat:a", "chat:b"]) { await db.characterRelations.put({ id: core.pairId(key, "npc:" + i), a: key, b: "npc:" + i, aToB: "同事", bToA: "同事", detail: "RELATION_DETAIL_" + i, source: "history", evidence: [{ quote: "INTERNAL_PROOF_" + i + "_" + "原文证据".repeat(120) }] }); if (i <= 25) oldExpanded += persona.slice(0, 1800).length + 500; }
    }
    const before = JSON.stringify(await db.characterRelations.toArray());
    const prompt = await new core.Service(db, identity).prompt(chat, Date.now(), { referenceText: "已勾选的聊天里提到联系04" });
    const json = JSON.parse(prompt.slice(prompt.indexOf('{"people":'))), profiles = json.contactProfiles;
    assert.equal(profiles.length, 4); assert.ok(profiles.every((p) => p.persona.endsWith("_完整尾部")), "relevant profiles are complete, not shortened to 1800 characters");
    assert.equal((prompt.match(/ONLY_PROFILE_1_/g) || []).length, 1, "shared contact persona is sent once, not once per member");
    assert.doesNotMatch(prompt, /ONLY_PROFILE_35_|INTERNAL_PROOF_/); assert.match(prompt, /联系35/); assert.match(prompt, /"relation":"同事"/);
    assert.match(prompt, /RELATION_DETAIL_1/); assert.doesNotMatch(prompt, /RELATION_DETAIL_35/);
    assert.equal(json.people[0].contacts.length, 35, "directory has no arbitrary 25-contact cutoff");
    assert.ok(prompt.length < oldExpanded / 3, "offscreen profile/evidence expansion is materially smaller without clipping selected memories");
    assert.equal(JSON.stringify(await db.characterRelations.toArray()), before); assert.equal((await db.npcs.get(35)).persona.includes("ONLY_PROFILE_35_"), true);
    assert.equal((await db.chats.get("group")).longTermMemory[0].content, chat.longTermMemory[0].content);
    console.log("PASS: relevant full NPC profiles from current history, group/personal memory and linked context; shared profiles once; all relationship identities preserved; no raw evidence/offscreen profile expansion; no database mutation");
  } finally { db.close(); await Dexie.delete(db.name); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
