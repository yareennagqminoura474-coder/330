const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
require("fake-indexeddb/auto"); const Dexie = require("dexie");
function harness() {
  const window = {}, storage = new Map();
  vm.runInNewContext(fs.readFileSync("time-machine.js", "utf8"), { window, Date, console, Number, String, Promise, setInterval,
    document: { readyState: "loading", addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  return { clock: window.ephoneTimeMachine, window };
}
(async () => {
  const db = new Dexie(`scene-timeline-${Date.now()}`); db.version(51).stores({ chats: "&id", spaceClock: "&id" }); await db.open();
  const { clock, window } = harness(), history = [], start = new Date(2026, 2, 5, 7, 20).getTime();
  await clock.loadSpace(db);
  clock.bindChat({ id: "a", settings: { currentLocation: "家" }, getMessages: () => history, applyConfig: async () => {} });
  async function jump(time = start) { await clock.jumpTo(time, "frozen"); const prep = clock.prepareReplyTime(history, { chatId: "a", sceneTimeline: true }); await prep.ready; return prep; }
  const prep = await jump();
  const source = [{ type: "narration", content: "2026年3月5日，07点28分，星期五，地点：家" }];
  for (let i = 0; i < 125; i++) {
    if (i === 12) source.push({ type: "narration", content: "聊完早餐的话题，他端来了早饭。", scene_time: "2026-03-05T07:24" });
    if (i === 57) source.push({ type: "narration", content: "吃完早饭，收拾好餐桌，他们走到门口。", scene_time: "2026-03-05T07:57" });
    if (i === 95) source.push({ type: "narration", content: "二十分钟后，车停在学校门口。", scene_time: "2026-03-05T08:17" });
    source.push({ type: "text", name: "林", content: `短句${i}。` });
  }
  const original = JSON.stringify(source);
  const timeline = clock.ensureReplyHeader(source, { chatId: "a", replyTimeMs: start, sceneTimeline: true });
  assert.equal(JSON.stringify(source), original, "timeline planning cannot mutate the raw response");
  assert.equal(timeline[0].vts, start); assert.match(timeline[0].content, /07点20分，星期四/);
  assert.equal(timeline.filter((m) => m.isReplyHeader).length, 1);
  assert.deepEqual(Array.from(timeline.filter((m) => m.isSceneTimeHeader), (m) => m.vts), [start + 4 * 60000, start + 37 * 60000, start + 57 * 60000]);
  assert.equal(timeline.filter((m) => m.type === "text").length, 125, "no reply count cap or truncation");
  let last = start;
  for (const item of timeline) {
    assert.ok(item.vts >= last); last = item.vts;
    await clock.commitReplySceneTime(item.vts, prep);
    assert.equal(clock.nowMs("b"), item.vts, "other chats silently follow the currently committed scene");
  }
  assert.equal(clock.nowMs(), start + 57 * 60000);
  assert.equal((await db.spaceClock.get("main")).anchorVirtualMs, last);
  const next = clock.prepareReplyTime([], { chatId: "a", sceneTimeline: true }); await next.ready;
  assert.equal(next.afterMs, last, "next round starts where this one ended, without double advancement");
  const resolvedElapsed = timeline.find((m) => /二十分钟后/.test(m.content));
  const afterElapsed = clock.prepareReplyTime([{ ...resolvedElapsed, role: "assistant" }], { chatId: "a", sceneTimeline: true }); await afterElapsed.ready;
  assert.equal(afterElapsed.afterMs, last, "an elapsed narration already timed by this batch cannot be counted a second time");
  const reload = harness().clock; await reload.loadSpace(db); assert.equal(reload.nowMs("b"), last);
  const midnight = new Date(2026, 2, 5, 23, 58).getTime(), crossed = [];
  window.EPhoneCharacterDaily = { onTimeChange: (before, after) => crossed.push([before, after]) };
  const nightPrep = await jump(midnight); crossed.length = 0;
  const overnight = clock.ensureReplyHeader([
    { type: "text", content: "先坐一会。" },
    { type: "narration", content: "2026年3月6日，00点11分，星期四，地点：卧室。叙述正文必须保留。" },
    { type: "text", content: "今天星期四，明天星期五。" },
  ], { chatId: "a", replyTimeMs: midnight, sceneTimeline: true });
  assert.match(overnight.find((m) => m.isSceneTimeHeader).content, /2026年3月6日，00点11分，星期五/);
  assert.ok(overnight.some((m) => m.content === "叙述正文必须保留。"));
  assert.equal(overnight.at(-1).content, "今天星期五，明天星期六。");
  await clock.commitReplySceneTime(overnight.at(-1).vts, nightPrep); assert.equal(crossed.length, 1);
  const future = clock.ensureReplyHeader([
    { type: "text", content: "再等十分钟再走。" }, { type: "narration", content: "他准备十分钟后再出发。" },
    { type: "text", content: "去年2025年3月5日，星期三，我们见过。", scene_time: "2028-01-01T09:00" },
    { type: "narration", content: "这条是倒退的时间，不应倒流。", scene_time: "2025-01-01T09:00" },
    { type: "narration", content: "无效日期不应跳时。", scene_time: "2026-02-30T09:00" },
  ], { chatId: "a", replyTimeMs: start, sceneTimeline: true });
  assert.ok(future.every((m) => m.vts === start), "plans, dialogue timestamps, past and impossible dates never jump time");
  const fallback = clock.ensureReplyHeader(Array.from({ length: 35 }, (_, i) => ({ type: "text", content: `第${i}段自然长对话，` + "内容较多，需要一定时间说完。".repeat(4) })), { chatId: "a", replyTimeMs: start, sceneTimeline: true });
  assert.ok(fallback.some((m) => m.vts > start), "legacy models without scene metadata still advance based on actual content");
  assert.equal(fallback.filter((m) => m.type === "text").length, 35);
  const stopped = await jump();
  await clock.commitReplySceneTime(start + 4 * 60000, stopped);
  assert.equal(clock.nowMs(), start + 4 * 60000, "planning later scenes does not commit unseen future content");
  await clock.jumpTo(start + 60000, "frozen");
  await assert.rejects(clock.commitReplySceneTime(start + 40 * 60000, stopped), /空间时间已更新/);
  await clock.rollbackPreparedReplyTime(stopped); assert.equal(clock.nowMs(), start + 60000);
  const failed = await jump(); await clock.rollbackPreparedReplyTime(failed);
  assert.equal(clock.getConfig().holdNextReply, true, "failed API keeps manual opening time for retry");
  await clock.setFlow("flow");
  const flowing = clock.ensureReplyHeader(source, { chatId: "a", replyTimeMs: start, sceneTimeline: true });
  assert.ok(flowing.every((m) => m.vts === start), "real-time-flow mode cannot acquire narrative offsets");
  await clock.useRealTime();
  const real = clock.ensureReplyHeader(source, { chatId: "a", replyTimeMs: start, sceneTimeline: true });
  assert.ok(real.every((m) => m.vts === start));
  assert.match(clock.getPromptRule(), /真实时间/);
  await db.delete();
  console.log("PASS: 125-message scene-paced timeline, exact opening, variable gaps, elapsed-vs-future narration, midnight weekdays/body, legacy fallback, per-item shared clock/persistence, stop/failure/stale guards and non-story modes");
})().catch((error) => { console.error(error); process.exitCode = 1; });
