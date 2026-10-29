const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
require("fake-indexeddb/auto"); const Dexie = require("dexie");
(async () => {
  const window = {}, db = new Dexie(`scene-appointments-${Date.now()}`), history = [];
  db.version(51).stores({ chats: "&id", spaceClock: "&id" }); await db.open();
  vm.runInNewContext(fs.readFileSync("time-machine.js", "utf8"), { window, Date, console, Number, String, Promise, setInterval,
    document: { readyState: "loading", addEventListener() {}, getElementById() { return null; } }, localStorage: { getItem: () => null, setItem() {} } });
  const clock = window.ephoneTimeMachine, at = (h, m = 0) => new Date(2026, 9, 29, h, m).getTime();
  await clock.loadSpace(db); clock.bindChat({ id: "a", settings: { currentLocation: "办公室" }, getMessages: () => history, applyConfig: async () => {} });
  await clock.jumpTo(at(17, 50), "frozen");
  const build = (items, start = at(17, 50)) => clock.ensureReplyHeader(items, { chatId: "a", replyTimeMs: start, sceneTimeline: true, quietTimeline: true });
  const n = (content, extra = {}) => ({ type: "narration", content, ...extra });
  const after = (content, start) => build([n("他坐在桌边，拿起手机。"), n(content)], start).at(-1).vts;
  const screenshot = [n("他坐在桌边，拿起手机。"),
    n("消息内容：'晚上你爸请吃饭，他跟我说了。我六点半过来接你。'"),
    n("手指悬在屏幕上方停了两秒，心跳又快了几拍。他已经知道晚上要吃饭了——说明她爸已经联系过他了。打了几个字又删掉，删了又打，最后发过去一句。"),
    { type: "text", name: "林澈", content: "好，六点半在大楼门口等你。" },
    n("发完之后把手机扣在桌面上。深呼吸了三次，拿起旁边的冰美式喝了一大口——早上点的第二杯，冰块已经全化了。"),
    { type: "text", name: "林澈", content: "难喝。" }];
  const original = JSON.stringify(screenshot), rows = build(screenshot);
  assert.equal(JSON.stringify(screenshot), original);
  assert.equal(rows.length, screenshot.length + 1); assert.equal(rows[0].vts, at(17, 50));
  assert.ok(rows.every((r) => r.vts < at(18)), "an appointment quoted in a message must not advance the scene to 19:00");
  for (const quote of [
    "'晚上你爸请吃饭，他跟我说了。我六点半过来接你。'", '"晚上你爸请吃饭，我六点半过来接你。"',
    "“晚上你爸请吃饭，我六点半过来接你。”", "‘晚上你爸请吃饭，我六点半过来接你。’", "「晚上你爸请吃饭，我六点半过来接你。」", "『晚上你爸请吃饭，我六点半过来接你。』",
    "'Tonight I'll pick you up. 晚上九点半来接你。'",
  ]) assert.equal(after("他看了一眼消息：" + quote), at(17, 50), `quoted conversation isn't current time: ${quote}`);
  for (const text of [
    "消息内容：晚上你爸请吃饭，他跟我说了。我六点半过来接你。", "短信写着：晚上来接你。", "他读到留言：夜里见，先吃完晚饭再来。",
    "他答应晚上去吃饭。", "他和她约在晚上六点半见面。", "他收到一条关于晚上聚餐的消息。", "他看着晚上吃饭的邀约。",
  ]) assert.equal(after(text), at(17, 50), `referenced future time isn't an actual phase: ${text}`);
  assert.equal(after("他看了一眼短信：'过了二十分钟，夜幕降临。'"), at(17, 50), "quoted past events are not an elapsed scene either");
  assert.equal(after("消息内容：'晚上九点见。'。十分钟后，他收拾好东西。"), at(18), "real elapsed narration after a message survives");
  assert.equal(after("他回复：'晚上六点半见。'，随后抬头看表，时针已经指向六点半。"), at(18, 30));
  assert.equal(after("手机上的时间显示为‘18:30’。"), at(18, 30), "a quoted actual clock display is still a clock");
  assert.equal(after('挂钟显示"晚上六点半"。'), at(18, 30));
  assert.equal(after("到了晚上六点半，他已经走到大楼门口。"), at(18, 30));
  assert.equal(after("夜幕降临，窗外已经黑了。"), at(18));
  assert.equal(after("晚上，他坐在客厅。"), at(19), "an actual new evening scene still advances");
  assert.equal(after("夜色中，他坐在客厅。"), at(19));
  assert.equal(after("过了十分钟，他看见短信里写着'晚上九点见。'"), at(18));
  assert.equal(after("他花了二十分钟写完回信：'晚上六点半见。'"), at(18, 10));
  assert.equal(build([n("他拿起手机。"), n("消息内容：'晚上六点半来接你。'", {
    scene_elapsed_minutes: 60, scene_time_reason: "短信提到了晚上的约定", scene_phase: "elapsed",
  })]).at(-1).vts, at(17, 50), "contradictory elapsed metadata on a reported appointment is not elapsed time");
  const quotedUser = clock.prepareReplyTime([{ role: "user", type: "narration", content: "消息内容：'过了二十分钟，夜幕降临。'", vts: at(17, 50) }], { chatId: "a", sceneTimeline: true });
  await quotedUser.ready; // Consume the manual hold before testing ordinary preparation.
  await clock.rollbackPreparedReplyTime(quotedUser);
  const hold = clock.prepareReplyTime([], { chatId: "a", sceneTimeline: true }); await hold.ready;
  const reportedUser = clock.prepareReplyTime([{ role: "user", type: "narration", content: "消息内容：'过了二十分钟，夜幕降临。'", vts: at(17, 50) }], { chatId: "a", sceneTimeline: true });
  await reportedUser.ready;
  assert.ok(reportedUser.afterMs < at(18), "quoted elapsed time from a manual message cannot jump the next opening either");
  await clock.rollbackPreparedReplyTime(reportedUser);
  for (const question of ["时间到了？", "时间到了?", "十分钟后？", "消息内容：过了二十分钟，夜幕降临。", "他看了一眼消息：过了二十分钟，夜幕降临。"]) {
    const p = clock.prepareReplyTime([{ role: "assistant", type: "text", content: "再等十分钟。", vts: at(17, 50) },
      { role: "user", type: "narration", content: question, vts: at(17, 50) }], { chatId: "a", sceneTimeline: true });
    await p.ready; assert.ok(p.afterMs < at(18), `reported times and questions are not confirmations: ${question}`);
    await clock.rollbackPreparedReplyTime(p);
  }
  await clock.jumpTo(at(17, 50), "frozen");
  // Commit/reentry and the next request use the final actual scene time.
  const prep = clock.prepareReplyTime(history, { chatId: "a", sceneTimeline: true }); await prep.ready;
  for (const row of rows) await clock.commitReplySceneTime(row.vts, prep);
  assert.equal(clock.nowMs("another-chat"), rows.at(-1).vts);
  const next = clock.prepareReplyTime([{ ...rows.at(-1), role: "assistant" }], { chatId: "a", sceneTimeline: true }); await next.ready;
  assert.ok(next.afterMs > rows.at(-1).vts && next.afterMs < at(18));
  await clock.rollbackPreparedReplyTime(next);
  await clock.setFlow("flow"); assert.ok(build(screenshot).every((r) => r.vts === at(17, 50)));
  await clock.useRealTime(); assert.ok(build(screenshot).every((r) => r.vts === at(17, 50)));
  await db.delete(); console.log("PASS: appointment/quote/report guards, actual quoted clocks, elapsed and real phase transitions, exact opening, full reply preservation, shared/next clock and non-story modes");
})().catch((error) => { console.error(error); process.exitCode = 1; });
