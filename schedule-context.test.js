const assert = require("node:assert/strict"); require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity.js"), social = require("./character-social-core.js"), life = require("./life-simulation-core.js");
(async () => {
  const db = new Dexie("schedule-context-" + Date.now()); db.version(1).stores({ chats: "&id", npcs: "++id", characterRelations: "&id", characterLives: "&key", relationshipEvents: "&id", lifeSimulation: "&id" }); await db.open();
  try {
    const vts = new Date(2026, 2, 5, 10).getTime(), date = "2026-03-05", members = [];
    for (let i = 0; i < 15; i++) {
      const id = "p" + i, name = "角色" + String(i).padStart(2, "0"); members.push({ id, originalName: name });
      await db.chats.put({ id, name, settings: { aiPersona: "完整的人设和记忆不删减" }, history: [], longTermMemory: [{ content: "完整记忆".repeat(1000), timestamp: 1 }] });
      await db.characterLives.put({ key: "chat:" + id, revision: 1, dailyPlans: { [date]: { date, revision: 1, note: "不需要发送的冗长日程说明".repeat(200), items: Array.from({ length: 12 }, (_, j) => ({ id: String(j), start: String(j * 2).padStart(2, "0") + ":00", end: String(j * 2 + 2).padStart(2, "0") + ":00", activity: name + "安排" + j, place: "本人住处", reachability: "available" })) } } });
    }
    const n = await db.npcs.add({ name: "NPC联系人", persona: "完整NPC人设" }); members.push({ id: "npc_" + n, originalName: "NPC联系人", isNpc: true });
    await db.characterLives.put({ key: "npc:" + n, dailyPlans: { [date]: { date, revision: 1, items: [{ id: "old", start: "00:00", end: "24:00", activity: "旧NPC日程不读取", place: "家" }] } } });
    const chat = { id: "group", name: "十五人群", isGroup: true, members, settings: {}, history: [{ role: "assistant", senderName: "角色03", content: "角色11，你接下来有什么安排？", timestamp: 20, vts }] }; await db.chats.put(chat);
    const service = new social.Service(db, identity), prompt = await service.prompt(chat, vts), payload = JSON.parse(prompt.trim().split("\n").at(-1));
    const selected = payload.people.filter((p) => Object.hasOwn(p, "todayPlan"));
    assert.deepEqual(selected.map((p) => p.name), ["角色03", "角色11"]);
    assert.ok(selected.every((p) => p.todayPlan.items.length === 2 && p.todayPlan.items[0].start === "10:00"));
    assert.doesNotMatch(prompt, /旧NPC日程不读取|角色14安排|冗长日程说明/);
    assert.equal(payload.people.length, 16, "identity and relationships are not removed to save schedule tokens");
    const sim = new life.Service(db, identity); await sim.sync(vts);
    const simPrompt = await sim.prompt(chat, vts), simPayload = JSON.parse(simPrompt.trim().split("\n").at(-1));
    assert.equal(simPayload.people.filter((p) => Object.hasOwn(p, "itinerary")).length, 2);
    assert.ok(simPayload.people.filter((p) => p.itinerary).every((p) => p.itinerary.length <= 2));
    assert.doesNotMatch(simPrompt, /旧NPC日程不读取|角色14安排/);
    assert.equal((await db.chats.get("p14")).longTermMemory[0].content.length, 4000, "full stored memories remain intact");
    assert.equal((await service.dailyTargets(vts)).length, 0, "existing role days reused and NPC omitted");
    console.log("PASS: 15-role group sends only focused current/next schedules, no NPC/whole-day/duplicate execution dumps, original person profiles and full memories preserved");
  } finally { db.close(); await Dexie.delete(db.name); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
