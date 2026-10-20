const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
require("fake-indexeddb/auto"); const Dexie = require("dexie");
(async () => {
  const window = {}, db = new Dexie(`scene-fallback-${Date.now()}`), history = [];
  db.version(51).stores({ chats: "&id", spaceClock: "&id" }); await db.open();
  const environment = { window, Date, console, Number, String, Promise, setInterval,
    document: { readyState: "loading", addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(fs.readFileSync("time-machine.js", "utf8"), environment);
  vm.runInNewContext(fs.readFileSync("narration-mode.js", "utf8"), environment);
  const clock = window.ephoneTimeMachine, start = new Date(2026, 2, 5, 7, 20).getTime();
  await clock.loadSpace(db); clock.bindChat({ id: "a", settings: { currentLocation: "家" }, getMessages: () => history, applyConfig: async () => {} });
  const build = (items, time = start) => clock.ensureReplyHeader(items, { chatId: "a", replyTimeMs: time, sceneTimeline: true, quietTimeline: true });
  async function jump() { await clock.jumpTo(start, "frozen"); const prep = clock.prepareReplyTime(history, { chatId: "a", sceneTimeline: true }); await prep.ready; assert.equal(prep.afterMs, start); return prep; }
  const prep = await jump();
  const source = [
    { type: "narration", content: "2026年3月5日，07点20分，星期四，地点：家" },
    { type: "narration", content: "他坐在桌旁。" }, { type: "text", content: "开始吃饭吧。" },
    { type: "narration", content: "两人吃完早餐，收拾好餐桌。" }, { type: "text", content: "吃好了。" },
    { type: "narration", content: "他洗漱完毕，擦干了脸。" }, { type: "text", content: "马上来。" },
    { type: "narration", content: "他换好衣服，拿上了书包。" }, { type: "text", content: "出发了。" },
    { type: "narration", content: "过了十分钟，车停在学校门口。" }, { type: "text", content: "到了。" },
  ];
  const unchanged = JSON.stringify(source), timed = build(source);
  assert.equal(JSON.stringify(source), unchanged, "timing never mutates the provider's full reply");
  assert.equal(timed[0].isReplyHeader, true); assert.equal(timed[0].vts, start);
  assert.equal(timed.filter((item) => item.isReplyHeader).length, 1); assert.equal(timed.filter((item) => item.isSceneTimeHeader).length, 0);
  assert.deepEqual(Array.from(timed.slice(1), (item) => (item.vts - start) / 60000), [0, 0, 15, 15, 21, 21, 24, 24, 34, 34]);
  for (const item of timed) await clock.commitReplySceneTime(item.vts, prep);
  assert.equal(clock.nowMs("other-chat"), start + 34 * 60000, "fallback per-message time commits to the same space");
  const next = clock.prepareReplyTime([{ ...timed.at(-1), role: "assistant" }], { chatId: "a", sceneTimeline: true }); await next.ready;
  assert.equal(next.afterMs, start + 35 * 60000, "next round automatically advances after a metadata-free reply");
  await clock.rollbackPreparedReplyTime(next); assert.equal(clock.nowMs(), start + 34 * 60000, "failed next round rolls its automatic pause back");
  const richerDialogue = Array.from({ length: 3 }, () => ({ role: "assistant", type: "text", content: "这是一段自然的长对话，讲清楚接下来的安排和想法。".repeat(20) }));
  const longer = clock.prepareReplyTime(richerDialogue, { chatId: "a", sceneTimeline: true }); await longer.ready;
  assert.equal(longer.minutes, 3, "automatic inter-round pace is content-dependent rather than a fixed increment");
  await clock.rollbackPreparedReplyTime(longer);
  await jump();
  const conversation = Array.from({ length: 110 }, (_, i) => ({ type: "text", name: "林", content: `第${i}句：这是自然的来回交流，不是额外报时。` }));
  const spoken = build(conversation);
  assert.equal(spoken[1].vts, start); assert.ok(spoken.at(-1).vts > start + 5 * 60000);
  assert.ok(spoken.at(-1).vts < start + 30 * 60000); assert.equal(spoken.filter((item) => item.type === "text").length, 110);
  assert.ok(new Set(spoken.map((item) => item.vts)).size > 3, "one metadata-free round advances repeatedly");
  const noFalseElapsed = build([
    { type: "text", content: "好的。" },
    { type: "narration", content: "他还没吃完早饭。" },
    { type: "narration", content: "他没吃完早餐。" },
    { type: "narration", content: "他打算明天吃完早餐后去学校。", scene_elapsed_minutes: 20, scene_time_reason: "早餐", scene_phase: "elapsed" },
    { type: "narration", content: "他想起昨天吃完早饭的事。" },
    { type: "narration", content: "他准备十分钟后出发。", scene_phase: "planned", scene_elapsed_minutes: 10 },
    { type: "narration", content: "他拿起杯子。", scene_phase: "instant", scene_elapsed_minutes: 99 },
  ]);
  assert.ok(noFalseElapsed.every((item) => item.vts === start), "intentions, negated completion, memories and instant actions cannot force elapsed time");
  const question = clock.prepareReplyTime([{ role: "user", type: "text", content: "你吃完早饭了吗？", vts: start }], { chatId: "a", sceneTimeline: true }); await question.ready;
  assert.equal(question.minutes, 1, "asking whether breakfast is finished cannot jump a whole meal");
  await clock.rollbackPreparedReplyTime(question);
  const mixed = window.normalizeEPhoneNarrationOutput([{ type: "text", content: "好了（收拾好书桌）（换好衣服）走吧。", scene_elapsed_minutes: 5,
    scene_time_reason: "整理和换衣", scene_phase: "elapsed" }]);
  const splitTimed = build(mixed);
  assert.equal(splitTimed.at(-1).vts, start + 5 * 60000, "mixed source's one metadata advance isn't duplicated across action fragments");
  const textPlan = build([{ type: "text", content: "先聊两句。" },
    { type: "text", content: "讨论完了。", scene_phase: "elapsed", scene_time_reason: "谈话", scene_elapsed_minutes: 7 },
    { type: "narration", content: "他坐在桌旁。" }]);
  assert.equal(textPlan.at(-1).vts, start + 7 * 60000, "metadata on valid dialogue is no longer ignored");
  const exactFirst = build([{ type: "narration", content: "二十分钟后，走到了门口。" }, { type: "text", content: "到了。" }]);
  assert.equal(exactFirst[0].vts, start); assert.equal(exactFirst[1].vts, start + 20 * 60000, "opening stays exact while a first elapsed scene is no longer lost");
  const overnightStart = new Date(2026, 2, 5, 23, 58).getTime(), overnight = build([
    { type: "text", content: "先洗漱吧。" }, { type: "narration", content: "他洗漱完毕。" }, { type: "text", content: "今天星期四。" },
  ], overnightStart);
  assert.equal(overnight.at(-1).vts, overnightStart + 6 * 60000); assert.equal(overnight.at(-1).content, "今天星期五。");
  await clock.setFlow("flow"); assert.ok(build(source).every((item) => item.vts === start));
  await clock.useRealTime(); assert.ok(build(source).every((item) => item.vts === start));
  await db.delete();
  console.log("PASS: real quiet timeline without model metadata advances per completed scene and dialogue, restores variable next-round auto time, exact manual opening, single header, one split event, exact elapsed/midnight, rollback and non-story guards");
})().catch((error) => { console.error(error); process.exitCode = 1; });
