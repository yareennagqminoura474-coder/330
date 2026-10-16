const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity.js"), core = require("./character-social-core.js");
const at = (day, hour = 10) => new Date(2026, 2, day, hour).getTime();
const items = [
  { start: "00:00", end: "07:00", activity: "睡眠", place: "自己的家", reachability: "rest" },
  { start: "09:00", end: "17:00", activity: "当天工作", place: "自己的单位", reachability: "busy" },
  { start: "23:00", end: "24:00", activity: "睡眠", place: "自己的家", reachability: "rest" }
];
(async () => {
  const db = new Dexie("daily-social-test-" + Date.now()); db.version(54).stores({ chats: "&id", npcs: "++id", characterRelations: "&id,a,b", characterLives: "&key", relationshipEvents: "&id" }); await db.open();
  try {
    await db.chats.bulkPut([{ id: "a", name: "甲", settings: { aiPersona: "甲是医生，有独立家庭" }, history: [] }, { id: "b", name: "乙", settings: { aiPersona: "乙是教师" }, history: [] }]);
    const npc = await db.npcs.add({ name: "独立NPC", persona: "另一位没有关系绑定的邻居" });
    const service = new core.Service(db, identity), key = "chat:a";
    await service.saveLife(key, { home: "手动公寓", job: "手动职业", routine: [{ days: [0,1,2,3,4,5,6], start: "10:00", end: "11:00", activity: "旧一周计划", place: "旧地点" }] }, at(5), 0);
    await db.characterLives.update(key, { actual: { since: at(5), until: at(5, 11), activity: "剧情活动", place: "剧情地点" } });
    await service.saveLife("chat:b", { enabled: false, routine: [] }, at(5), 0);
    const targets = await service.dailyTargets(at(5)); assert.equal(targets.length, 2, "only roles generate daily plans, never NPCs");
    assert.deepEqual(await service.dailyTargets(at(5), { key: "npc:" + npc }), [], "manual NPC generation also stays excluded");
    const raw = { schedules: targets.map((p) => ({ key: p.key, plan: { date: "2026-03-05", note: "当天拟定", items } })) };
    const prior = await db.characterLives.toArray();
    for (const mutation of [
      (p) => p.schedules.pop(), (p) => p.schedules[0].plan.date = "2026-03-06",
      (p) => p.schedules[0].plan.items.push(items[0]), (p) => p.schedules[0].plan.items[0].end = "25:00",
      (p) => p.schedules[0].plan.items[0].start = "23:00"
    ]) {
      const bad = structuredClone(raw); mutation(bad);
      await assert.rejects(service.saveDailySchedules(bad, targets, at(5)), (e) => e.code === "SOCIAL_GENERATION_INVALID");
      assert.deepEqual(await db.characterLives.toArray(), prior, "invalid batch changes no people or daily plans");
    }
    await service.saveDailySchedules(raw, targets, at(5));
    let a = await db.characterLives.get(key); assert.equal(a.home, "手动公寓"); assert.equal(a.job, "手动职业"); assert.equal(a.routine[0].activity, "旧一周计划");
    assert.equal(core.activityAt(a, at(5)).source, "chat", "actual scene remains higher priority than plans");
    assert.equal(core.activityAt(a, at(5, 12)).source, "daily"); assert.equal(core.activityAt(a, at(6, 12)), null, "yesterday must not repeat as today's schedule");
    assert.equal(core.activityAt(a, at(5, 23)).activity, "睡眠");
    assert.equal(core.activityAt(await db.characterLives.get("chat:b"), at(5)), null, "paused life stays paused");
    assert.deepEqual(await service.dailyTargets(at(5)), [], "already saved day is reused");
    assert.equal((await service.dailyTargets(at(6))).length, 2, "new day plans roles only");
    await assert.rejects(service.saveDailySchedules(raw, targets, at(5)), /刚被修改/);
    const tomorrow = await service.dailyTargets(at(6));
    await service.saveDailySchedules({ schedules: tomorrow.map((p) => ({ key: p.key, plan: { date: p.date, items: items.map((r) => ({ ...r, activity: "次日不同安排" })) } })) }, tomorrow, at(6));
    a = await db.characterLives.get(key); assert.equal(Object.keys(a.dailyPlans).length, 2);
    assert.equal(core.activityAt(a, at(6, 12)).activity, "次日不同安排"); assert.equal(core.activityAt(a, at(5, 12)).activity, "当天工作", "time travel restores historical day");
    const manualTargets = await service.dailyTargets(at(5), { key, includeCircle: false, replaceOwner: true });
    await service.saveDailyLife(key, { items, job: "自定义职业", home: "自定义住处", note: "手动当天", enabled: true }, at(5), a.revision, manualTargets[0].planRevision);
    a = await db.characterLives.get(key); assert.equal(a.dailyPlans["2026-03-05"].source, "manual"); assert.equal(a.dailyPlans["2026-03-06"].items[1].activity, "次日不同安排");
    assert.deepEqual(await service.dailyTargets(at(5)), [], "manual day does not get auto-overwritten");
    const prompt = await service.prompt(await db.chats.get("a"), at(5, 12)); assert.match(prompt, /todayPlan/); assert.match(prompt, /2026-03-05/); assert.doesNotMatch(prompt, /次日不同安排/);
    const generated = core.dailyPrompt(tomorrow, at(6), "确定的公共假期信息"); assert.match(generated, /2026-03-06星期五/); assert.match(generated, /确定的公共假期信息/); assert.match(generated, /不生成一周/);
    assert.equal(await db.npcs.count(), 1); assert.equal(await db.characterRelations.count(), 0);
    const concurrentA = await service.dailyTargets(at(8)), concurrentB = await service.dailyTargets(at(9));
    const plans = (targets) => ({ schedules: targets.map((p) => ({ key: p.key, plan: { date: p.date, items } })) });
    await db.characterLives.update(key, { actual: { since: at(8), until: at(8, 11), activity: "并发剧情", place: "客厅" }, revision: a.revision + 10 });
    await service.saveDailySchedules(plans(concurrentA), concurrentA, at(8));
    await service.saveDailySchedules(plans(concurrentB), concurrentB, at(9));
    const parallel = await db.characterLives.get(key);
    assert.equal(parallel.actual.activity, "并发剧情");
    assert.ok(parallel.dailyPlans["2026-03-08"] && parallel.dailyPlans["2026-03-09"], "different days merge, without rejecting unrelated revisions");
    const stale = await service.dailyTargets(at(10));
    await db.characterLives.update(key, { home: "生成期间新改的家" });
    await assert.rejects(service.saveDailySchedules(plans(stale), stale, at(10)), /生活设置已修改/);
    assert.equal((await db.characterLives.get(key)).dailyPlans["2026-03-10"], undefined);
    const chat = await db.chats.get("a");
    chat.history = Array.from({ length: 70 }, (_, i) => ({ timestamp: i + 1, vts: at(4), role: "assistant", content: "旧聊天".repeat(250) }));
    chat.history.push({ timestamp: 100, vts: at(4, 20), role: "assistant", content: "明天上午九点去医院复查。" },
      { timestamp: 101, vts: at(4, 21), role: "assistant", content: "改成明天下午三点复查，上午请假在家。" },
      { timestamp: 102, vts: at(6), content: "未来秘密不该读" }, { timestamp: 103, vts: at(4), isHidden: true, content: "隐藏消息不该读" },
      { timestamp: Date.now(), content: "没有vts的最新虚拟聊天约定" });
    chat.longTermMemory = Array.from({ length: 6 }, (_, i) => ({ timestamp: i, vts: at(4), content: "旧总结".repeat(500) }));
    await db.chats.put(chat);
    await db.chats.update("b", { history: [{ timestamp: 110, vts: at(4), content: "乙的私聊秘密" }] });
    globalThis.ephoneTimeMachine = { messageTime: (m) => m.timestamp === chat.history.at(-1).timestamp ? at(4, 22) : m.timestamp };
    try {
      const context = await service.dailyContext(key, at(5));
      assert.match(JSON.stringify(context), /改成明天下午三点复查/);
      assert.match(JSON.stringify(context), /没有vts的最新虚拟聊天约定/);
      assert.equal(context.sources[0].when, "2026-03-04 22:00");
      assert.doesNotMatch(JSON.stringify(context), /未来秘密|隐藏消息|乙的私聊秘密/);
      assert.ok(context.sources.reduce((n, s) => n + s.content.length, 0) <= 12000);
      assert.match(core.dailyPrompt([{ ...concurrentA[0], recentContext: context.sources }], at(5)), /最新的明确更正为准|原话的日期换算/);
    } finally { delete globalThis.ephoneTimeMachine; }
    console.log("PASS: dated plans, latest own-chat grounding and budget/privacy, virtual legacy dates, concurrent scene/day merging, manual stale protection, midnight validation, history and prompt isolation");
  } finally { db.close(); await Dexie.delete(db.name); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
