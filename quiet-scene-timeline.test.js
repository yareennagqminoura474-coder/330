const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
require("fake-indexeddb/auto"); const Dexie = require("dexie");
(async () => {
  const window = {}, db = new Dexie(`quiet-scenes-${Date.now()}`);
  db.version(51).stores({ chats: "&id", spaceClock: "&id" }); await db.open();
  vm.runInNewContext(fs.readFileSync("time-machine.js", "utf8"), { window, Date, console, Number, String, Promise, setInterval,
    document: { readyState: "loading", addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem: () => null, setItem() {} } });
  const clock = window.ephoneTimeMachine, history = [], start = new Date(2026, 2, 5, 7, 20).getTime();
  await clock.loadSpace(db); clock.bindChat({ id: "a", settings: { currentLocation: "家" }, getMessages: () => history, applyConfig: async () => {} });
  const buildWithOpening = (items, time) => clock.ensureReplyHeader(items, { chatId: "a", sceneTimeline: true, quietTimeline: true, replyTimeMs: time });
  const build = (items, time) => buildWithOpening(items, time).filter((item) => !item.isReplyHeader);
  const story = [
    { type: "narration", content: "他坐在桌旁。", scene_phase: "instant", scene_elapsed_minutes: 0 },
    { type: "text", content: "早上好。" },
    { type: "narration", content: "聊完了早餐的话题。", scene_elapsed_minutes: 4, scene_time_reason: "谈话持续了一段时间", scene_phase: "elapsed" },
    { type: "narration", content: "吃完早餐，收拾好餐桌。", scene_elapsed_minutes: 25, scene_time_reason: "用餐及收拾", scene_phase: "elapsed" },
    { type: "narration", content: "二十分钟后，抵达学校。", scene_elapsed_minutes: 20, scene_time_reason: "通勤已经完成", scene_phase: "elapsed" },
    { type: "text", content: "到了。" },
  ];
  await clock.jumpTo(start, "frozen");
  const firstPrep = clock.prepareReplyTime(history, { chatId: "a", sceneTimeline: true }); await firstPrep.ready;
  const complete = buildWithOpening(story, start);
  assert.equal(complete[0].isReplyHeader, true);
  assert.equal(complete[0].content, clock.formatReplyHeader(start, "家"));
  assert.equal(complete.filter((m) => m.isReplyHeader).length, 1);
  assert.ok(!complete.some((m) => m.isSceneTimeHeader));
  const duplicated = buildWithOpening([
    { type: "narration", content: "2026年3月5日，07点20分，星期四，地点：家" },
    ...story.slice(0, 2),
    { type: "narration", content: "2026年3月5日，07点24分，星期四，地点：家。继续剧情。" },
  ], start);
  assert.equal(duplicated.filter((m) => /地点：/.test(m.content)).length, 1);
  assert.ok(duplicated.some((m) => m.content === "继续剧情。"));
  const first = build(story, firstPrep.afterMs);
  assert.equal(first.length, story.length); assert.equal(first[0].vts, start);
  assert.deepEqual(Array.from(first, (m) => (m.vts - start) / 60000), [0, 0, 4, 29, 49, 49]);
  assert.ok(first.every((m) => !m.isReplyHeader && !m.isSceneTimeHeader));
  for (const item of first) await clock.commitReplySceneTime(item.vts, firstPrep);
  const nextPrep = clock.prepareReplyTime([{ ...first.at(-1), role: "assistant" }], { chatId: "a", sceneTimeline: true }); await nextPrep.ready;
  const second = build(story, nextPrep.afterMs);
  assert.equal(second[0].vts, start + 49 * 60000);
  assert.equal(second.at(-1).vts, start + 98 * 60000, "the same relative plan advances from the latest end, not last round's timestamps");
  const later = new Date(2026, 2, 5, 10, 30).getTime(); await clock.jumpTo(later, "frozen");
  const manual = clock.prepareReplyTime(history, { chatId: "a", sceneTimeline: true }); await manual.ready;
  assert.equal(build(story, manual.afterMs)[0].vts, later);
  const legacy = build([
    { type: "narration", content: "2026年3月5日，07点20分，星期四，地点：家" },
    { type: "narration", content: "坐在桌旁。" },
    { type: "narration", content: "2026年3月5日，07点24分，星期四，地点：家。聊天告一段落。" },
    { type: "text", content: "继续。" },
  ], later);
  assert.equal(legacy[0].vts, later); assert.equal(legacy.at(-1).vts, later + 4 * 60000);
  assert.equal(legacy.length, 3); assert.ok(legacy.some((m) => m.content === "聊天告一段落。"));
  const frozen = build([
    { type: "narration", content: "他拿起杯子。", scene_elapsed_minutes: 99 },
    { type: "narration", content: "放下杯子。", scene_elapsed_minutes: 99, scene_phase: "instant" },
    { type: "narration", content: "又拿起杯子。", scene_elapsed_minutes: 99, scene_time_reason: "拿杯子" },
    { type: "narration", content: "准备再等十分钟后出发。", scene_elapsed_minutes: 10, scene_phase: "planned" },
    { type: "text", content: "很长的消息。".repeat(10000) },
    { type: "narration", content: "片刻后，他点头。" },
    { type: "text", content: "继续。" },
  ], later);
  assert.ok(frozen.every((m) => m.vts === later), "instant/planned events, prose length, and vague adverbs do not mechanically add time");
  assert.equal(frozen[4].content.length, "很长的消息。".repeat(10000).length, "time handling never truncates content");
  const overnight = build([story[0], { type: "narration", content: "交谈后。", scene_elapsed_minutes: 13, scene_time_reason: "夜间交谈", scene_phase: "elapsed" }, { type: "text", content: "今天星期四。" }], new Date(2026, 2, 5, 23, 58).getTime());
  assert.equal(overnight.at(-1).content, "今天星期五。");
  assert.equal(clock.narrationDisplayText({ isReplyHeader: true, content: "2026年3月5日，07点20分，星期四，地点：家" }), "2026年3月5日，07点20分，星期四，地点：家");
  assert.equal(clock.narrationDisplayText({ isSceneTimeHeader: true, content: "2026年3月5日，07点20分，星期四，地点：家。不能丢失的正文。" }), "不能丢失的正文。");
  assert.throws(() => build([{ type: "narration", content: "2026年3月5日，07点20分，星期四，地点：家" }], later), /没有剧情正文/);
  assert.match(clock.getPromptRule(), /scene_elapsed_minutes/); assert.match(clock.getPromptRule(), /不按消息条数、字数/);
  await db.delete();
  console.log("PASS: quiet scene times, repeated/changed manual opening and relative next-round continuation, stale absolute compatibility, no character/adverb timers, instant/planned guards, full prose, midnight, old clock-header display and header-only failure");
})().catch((error) => { console.error(error); process.exitCode = 1; });
