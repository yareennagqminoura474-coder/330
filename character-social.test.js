const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity.js"), core = require("./character-social-core.js");
const schema = { chats: "&id", npcs: "++id,name", characterRelations: "&id,a,b", characterLives: "&key", relationshipEvents: "&id,chatId,vts,status" };
const at = (day, hour, min = 0) => new Date(2026, 2, day, hour, min).getTime();
const routine = { job: "医生", home: "自己的住处", note: "拟定，可编辑", enabled: true, routine: [{ days: [1,2,3,4,5], start: "09:00", end: "18:00", activity: "门诊工作", place: "医院", reachability: "busy" }, { days: [0,1,2,3,4,5,6], start: "22:00", end: "07:00", activity: "睡觉", place: "家", reachability: "rest" }] };
(async () => {
  const db = new Dexie("social-test-" + Date.now()); db.version(54).stores(schema); await db.open();
  const service = new core.Service(db, identity), key = "chat:a";
  try {
    const members = [{ id: "a", originalName: "甲" }, { id: "b", originalName: "乙" }];
    const quote = "甲和乙是大学同学。";
    await db.chats.bulkPut([
      { id: "a", name: "甲", settings: { aiPersona: "甲是普通家庭的医生，住在自己的公寓，节俭，不喜欢热闹。" }, history: [{ role: "assistant", senderName: "甲", content: "工作后我想自己静一静。", timestamp: 1, vts: at(5, 8) }] },
      { id: "b", name: "乙", settings: { aiPersona: "乙是甲的大学同学，教师。" }, history: [{ role: "user", content: "乙私聊里的秘密不可进入甲的生成输入。", timestamp: 2 }] },
      { id: "g", name: "同学群", isGroup: true, members, history: [{ type: "narration", role: "system", content: quote, timestamp: 10, vts: at(5, 8) }], longTermMemory: [{ timestamp: 20, vts: at(4, 8), content: "甲与乙毕业后仍有联系。" }] },
      { id: "hidden", name: "其他人的私聊", settings: {}, history: [{ content: "不在甲的关系或私密记忆里", timestamp: 3 }] }
    ]);
    const context = await service.context(key), prompt = core.generationPrompt(context);
    assert.match(prompt, /工作后我想自己静一静/); assert.match(prompt, /甲和乙是大学同学/); assert.match(prompt, /甲与乙毕业后仍有联系/);
    assert.doesNotMatch(prompt, /乙私聊里的秘密|不在甲的关系或私密记忆里/);
    assert.match(prompt, /学生不要强行配下属/); assert.match(prompt, /新拟定关系evidence留空/);
    const batch = { ownerKey: key, people: [{ ref: "colleague", name: "陈医生", persona: "陈医生，35岁，甲同科室的医生，温和细心，有自己的家庭和轮班生活。", life: { ...routine, home: "陈医生自己的家" } }, { ref: "classmate", name: "乙", existingKey: "chat:b" }],
      relations: [{ a: key, b: "colleague", aToB: "同事", bToA: "同事", detail: "同科室合作，各自有独立生活", evidence: [] },
        { a: key, b: "classmate", aToB: "大学同学", bToA: "大学同学", detail: "毕业后仍有联系", evidence: [{ chatId: "g", timestamp: 10, quote }] }], life: routine };
    const result = await service.generate(key, batch, at(5, 8), context);
    assert.equal(result.created.length, 1); assert.equal(result.linked, 2); assert.equal(await db.npcs.count(), 1);
    const npc = (await db.npcs.toArray())[0]; assert.equal(npc.enableBackgroundActivity, false); assert.deepEqual(npc.associatedWith, ["a"]);
    assert.equal((await db.characterLives.get("npc:" + npc.id)).home, "陈医生自己的家");
    assert.equal((await db.chats.get("g")).members.length, 2, "new NPCs do not magically join a group");
    assert.equal((await db.characterRelations.get(core.pairId(key, "chat:b"))).source, "history");
    assert.equal((await db.characterRelations.get(core.pairId(key, "npc:" + npc.id))).source, "generated");
    const second = await service.generate(key, batch, at(5, 8), context);
    assert.equal(second.created.length, 0); assert.equal(second.kept, 2); assert.equal(await db.npcs.count(), 1);
    let relation = await db.characterRelations.get(core.pairId(key, "chat:b"));
    await service.saveRelation({ ...relation, aToB: "老朋友", bToA: "老朋友" }, at(5, 8), { revision: relation.revision });
    await service.generate(key, batch, at(5, 8), context); assert.equal((await db.characterRelations.get(relation.id)).aToB, "老朋友", "generation cannot overwrite edited facts");
    await assert.rejects(service.saveRelation(relation, at(5, 8), { revision: relation.revision }), /刚被更新/);
    const bad = { ...batch, people: [{ ref: "bad", name: "不应留下的新角色", persona: "虚构的新角色，用于事务失败时必须完整回滚。" }], relations: [{ a: key, b: "bad", aToB: "朋友", bToA: "朋友", evidence: [{ chatId: "hidden", timestamp: 3, quote: "不在甲的关系" }] }] };
    await assert.rejects(service.generate(key, bad, at(5, 8), context), /可参考聊天范围/);
    assert.equal(await db.npcs.count(), 1); assert.equal(await db.characterRelations.count(), 2, "no orphan NPC or partial relations after a failed transaction");
    const life = await db.characterLives.get(key);
    assert.equal(core.activityAt(life, at(5, 10)).activity, "门诊工作");
    assert.equal(core.activityAt(life, at(6, 2)).activity, "睡觉");
    assert.equal(core.activityAt(life, at(7, 10)), null, "weekend is not a weekday shift");
    assert.throws(() => core.normalizeLife({ routine: [routine.routine[0], { ...routine.routine[0], id: "overlap", start: "17:00", end: "20:00" }] }), /时间重叠/);
    assert.throws(() => core.normalizeLife({ routine: [{ days: [1], start: "24:00", end: "07:00", activity: "休息", place: "家" }] }), /时刻无效/);
    const chat = await db.chats.get("g");
    chat.history.push({ role: "system", type: "narration", content: "甲到了自己的书房，开始读书。", timestamp: 30, vts: at(5, 10) }); await db.chats.put(chat);
    const action = { type: "life_update", name: "甲", activity: "读书", place: "书房", minutes: 60, reachability: "available", quote: "甲到了自己的书房，开始读书。" };
    await service.act(action, chat, at(5, 10), 31);
    const actual = await db.characterLives.get(key); assert.equal(core.activityAt(actual, at(5, 10, 30)).source, "chat");
    assert.equal(core.activityAt(actual, at(5, 11)).source, "routine"); assert.equal(core.activityAt(actual, at(5, 9)).source, "routine", "backwards clock cannot see future action");
    await assert.rejects(service.act({ ...action, name: "乙" }, chat, at(5, 10), 32), /没有指向该角色/);
    await assert.rejects(service.act({ ...action, activity: "开会", quote: "甲准备开会。" }, chat, at(5, 10), 32), /找不到对应聊天原文/);
    await service.act({ type: "relationship_event", name: "甲", otherName: "乙", aToB: "朋友", bToA: "朋友", detail: "从旧同学恢复朋友关系", for_timestamp: 10, quote }, chat, at(5, 10), 33);
    let events = await db.relationshipEvents.toArray(); assert.equal(events.length, 1); assert.equal(events[0].status, "pending");
    assert.equal((await db.characterRelations.get(relation.id)).aToB, "老朋友", "proposals do not rewrite facts before user confirmation");
    await service.act({ type: "relationship_event", name: "甲", otherName: "乙", aToB: "朋友", bToA: "朋友", for_timestamp: 10, quote }, chat, at(5, 10), 34);
    assert.equal(await db.relationshipEvents.count(), 1, "same proposal dedupes across replies");
    await service.review(events[0].id, true, at(5, 10)); assert.equal((await db.characterRelations.get(relation.id)).source, "confirmed_chat");
    await assert.rejects(service.review(events[0].id, true, at(5, 10)), /已处理/);
    const story = await service.prompt(chat, at(5, 10, 20));
    assert.match(story, /陈医生/); assert.match(story, /不能默认全员一直陪/); assert.match(story, /当前聊天合法成员/); assert.match(story, /"source":"chat"/);
    assert.match(story, /不会.*|不让其他角色凭空知道其行踪/);
    // Generated names re-use exact existing names, and ambiguous names fail safely.
    await db.npcs.add({ name: "乙", persona: "另一个同名人" });
    await assert.rejects(service.generate(key, { ...batch, people: [{ ref: "ambiguous", name: "乙" }], relations: [{ a: key, b: "ambiguous", aToB: "同事", bToA: "同事" }] }, at(5, 10), context), /同名人物/);
    // No automatic background activity, calls, chat edits or invented messages.
    assert.equal((await db.chats.get("a")).history.length, 1); assert.equal((await db.chats.get("g")).history.length, 2);
    const freshContext = await service.context(key), full = "普通家庭成长的成年人，在本地从事教师工作，收入稳定但并不富裕。性格温和认真，有时过于坚持原则，平时喜欢跑步和阅读，周末会见自己的朋友。说话简洁，有独立的工作、住处和烦恼，重视隐私与相处界限，不会全天围着甲转，遇到矛盾会先解释再坚持自己的意见。";
    const newBatch = { npcs: ["韩老师", "李同事", "赵邻居"].map((name) => ({ name, persona: full, relation: { toOwner: "朋友", fromOwner: "朋友", detail: "共同兴趣结识，各有自己的工作生活" }, life: { ...routine, routine: [routine.routine[0], routine.routine[0]] } })) };
    const newResult = await service.generateNew(key, "这是结果：\n```json\n" + JSON.stringify(newBatch) + "\n```", at(5, 10), freshContext);
    assert.equal(newResult.created.length, 3); assert.equal(newResult.linked, 3); assert.equal(newResult.warnings.length, 3, "bad optional schedules never discard complete NPCs or bindings");
    for (const p of newResult.created) { const row = await db.npcs.get(Number(p.key.slice(4))); assert.ok(row.persona.length >= 100); assert.ok(await db.characterRelations.get(core.pairId(key, p.key))); }
    for (const raw of [{ npcs: [] }, { npcs: [{ name: "只有一个人", persona: full, relation: { toOwner: "朋友", fromOwner: "朋友" } }] }, { npcs: [{ name: "缺人设" }, { name: "也缺人设" }] }, '{"npcs":['])
      await assert.rejects(service.generateNew(key, raw, at(5, 10), freshContext), (e) => e.code === "SOCIAL_GENERATION_INVALID");
    const countNew = await db.npcs.count(); await assert.rejects(service.generateNew(key, newBatch, at(5, 10), await service.context(key)), /至少2位/); assert.equal(await db.npcs.count(), countNew);
    assert.match(core.newCirclePrompt(freshContext), /先生成.*全新的完整NPC/); assert.match(core.newCirclePrompt(freshContext), /外貌.*家庭经济条件/);
    // Schedules are generated in the same click, or can be filled without re-creating NPCs.
    const week = { ...routine, routine: [...routine.routine, { days: [0,6], start: "14:00", end: "16:00", activity: "个人兴趣社交", place: "附近球场", reachability: "available" }] };
    assert.equal(core.completeRoutine(week), true); assert.equal(core.completeRoutine(routine), false);
    const completeCircle = core.prepareCircle({ ...newBatch, life: week, npcs: newBatch.npcs.map((p) => ({ ...p, life: week })) }, freshContext);
    assert.equal(completeCircle.warnings.length, 0); assert.equal(core.completeRoutine(completeCircle.batch.life), true);
    assert.equal(completeCircle.batch.people.every((p) => core.completeRoutine(p.life)), true, "complete routines survive the initial NPC generation request");
    await service.saveLife("chat:b", { ...week, home: "手动设定的家" }, at(5, 10), 0);
    const pausedKey = newResult.created[2].key;
    await service.saveLife(pausedKey, { enabled: false, routine: [], home: "暂停的生活" }, at(5, 10), 0);
    let targets = await service.scheduleTargets(key);
    assert.ok(targets.some((p) => p.key === key), "incomplete generated routines are included for repair");
    assert.ok(!targets.some((p) => p.key === newResult.created[0].key), "NPCs are excluded from legacy routine generation too");
    assert.ok(!targets.some((p) => p.key === "chat:b" || p.key === pausedKey), "manual or paused life is never silently overwritten");
    const plan = { schedules: targets.map((p) => ({ key: p.key, life: { ...week, job: p.name + "的职业", home: p.name + "自己的家" } })) };
    const oldLives = await db.characterLives.toArray();
    const badPlan = structuredClone(plan); badPlan.schedules[0].life.routine.push(week.routine[0]);
    await assert.rejects(service.saveSchedules(badPlan, targets, at(5, 10)), (e) => e.code === "SOCIAL_GENERATION_INVALID");
    assert.deepEqual(await db.characterLives.toArray(), oldLives, "one overlap does not partially replace a batch");
    await assert.rejects(service.saveSchedules({ schedules: plan.schedules.slice(1) }, targets, at(5, 10)), /缺少人物/);
    await assert.rejects(service.saveSchedules({ schedules: targets.map(() => null) }, targets, at(5, 10)), (e) => e.code === "SOCIAL_GENERATION_INVALID");
    const beforeSchedules = await db.npcs.count(), actualBefore = (await db.characterLives.get(key)).actual;
    assert.equal(await service.saveSchedules(plan, targets, at(5, 10)), targets.length);
    for (const t of targets) assert.equal(core.completeRoutine(await db.characterLives.get(t.key)), true);
    assert.equal(await db.npcs.count(), beforeSchedules, "schedule generation never creates more people");
    assert.deepEqual((await db.characterLives.get(key)).actual, actualBefore, "current story activity remains intact");
    assert.equal((await db.characterLives.get("chat:b")).home, "手动设定的家");
    assert.deepEqual(await service.scheduleTargets(key), []);
    const replace = await service.scheduleTargets("chat:b", { replaceOwner: true, includeCircle: false });
    await service.saveSchedules({ schedules: [{ key: "chat:b", life: week }] }, replace, at(5, 10));
    assert.equal((await db.characterLives.get("chat:b")).home, "手动设定的家", "explicitly requested re-generation preserves identity and home");
    const pausedTargets = await service.scheduleTargets(pausedKey, { replaceOwner: true, includeCircle: false });
    assert.deepEqual(pausedTargets, [], "NPCs stay excluded even with explicit legacy re-generation options");
    assert.equal((await db.characterLives.get(pausedKey)).enabled, false, "NPC legacy records remain untouched");
    const stale = await service.scheduleTargets(key, { replaceOwner: true, includeCircle: false });
    await service.saveLife(key, week, at(5, 10), stale[0].revision);
    await assert.rejects(service.saveSchedules({ schedules: [{ key, life: week }] }, stale, at(5, 10)), /作息已被修改/);
    assert.match(core.schedulePrompt(targets), /不创建NPC/); assert.match(core.newCirclePrompt(freshContext), /角色日程由用户按需生成/);
    console.log("PASS: persona and own-chat grounding, verified sources, atomic NPC/relation creation, reuse/duplicates, manual fact preservation, weekly/overnight life, source-owned actual states, time travel, pending reviewed relation changes and private prompt boundaries");
  } finally { db.close(); await Dexie.delete(db.name); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
