const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
require("fake-indexeddb/auto"); const Dexie = require("dexie");
(async () => {
  const window = {}, db = new Dexie(`long-scenes-${Date.now()}`);
  db.version(51).stores({ chats: "&id", spaceClock: "&id" }); await db.open();
  vm.runInNewContext(fs.readFileSync("time-machine.js", "utf8"), { window, Date, console, Number, String, Promise, setInterval,
    document: { readyState: "loading", addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem: () => null, setItem() {} } });
  const clock = window.ephoneTimeMachine, at = (hour, minute = 0, day = 5) => new Date(2026, 2, day, hour, minute).getTime();
  vm.runInNewContext(fs.readFileSync("narration-mode.js", "utf8"), { window, document: { readyState: "loading", addEventListener() {} } });
  await clock.loadSpace(db); clock.bindChat({ id: "a", settings: { currentLocation: "家" }, getMessages: () => [], applyConfig: async () => {} });
  const n = (content, fields = {}) => ({ type: "narration", content, ...fields });
  const build = (items, start = at(14)) => clock.ensureReplyHeader(items, { chatId: "a", replyTimeMs: start, sceneTimeline: true, quietTimeline: true });
  const after = (content, fields, start) => build([n("他坐在家里。"), n(content, fields)], start).at(-1).vts;
  await clock.jumpTo(at(14), "frozen");
  const story = [n("他整理完物品。", { scene_elapsed_minutes: 2, scene_time_reason: "整理已经完成", scene_phase: "elapsed" }),
    ...Array.from({ length: 150 }, (_, i) => ({ type: "text", content: `短句${i}。` })),
    n("天色渐暗，夜幕降临，客厅里的灯亮了。"), n("两人吃完晚饭，收拾好餐桌。"),
    n("另一边，他也吃完了晚饭。"), n("夜已深，他洗完澡，爬上床盖好被子，很快沉沉睡去。")];
  const prep = clock.prepareReplyTime([], { chatId: "a", sceneTimeline: true }); await prep.ready;
  const rows = build(story);
  assert.equal(rows[0].vts, at(14)); assert.equal(rows[0].isReplyHeader, true);
  assert.equal(rows.filter((item) => item.isReplyHeader).length, 1);
  assert.equal(rows.length, story.length + 1, "all 150 dialogue items survive, only one opening is added");
  assert.ok(rows.every((item, i) => i === 0 || item.vts >= rows[i - 1].vts));
  assert.equal(rows.find((item) => item.content.startsWith("天色渐暗")).vts, at(18));
  assert.ok(rows.at(-1).vts >= at(22) && rows.at(-1).vts < at(0, 0, 6));
  assert.equal(rows.find((item) => item.content.startsWith("另一边")).vts, rows.find((item) => item.content.startsWith("两人吃完")).vts, "parallel dinner completion is not charged twice");
  for (const item of rows) await clock.commitReplySceneTime(item.vts, prep);
  assert.equal(clock.nowMs("other-chat"), rows.at(-1).vts);
  const next = clock.prepareReplyTime([{ ...rows.at(-1), role: "assistant" }], { chatId: "a", sceneTimeline: true }); await next.ready;
  assert.equal(next.afterMs, rows.at(-1).vts + 60000); await clock.rollbackPreparedReplyTime(next);
  assert.equal(after("时间来到晚上九点半，他已经洗完澡。"), at(21, 30));
  assert.equal(after("时钟已经指向21:45，他躺在床上。", { scene_elapsed_minutes: 2, scene_time_reason: "上床", scene_phase: "elapsed" }), at(21, 45), "actual prose clock wins over contradictory metadata, not summed");
  assert.equal(after("过了十分钟，窗外夜幕降临。"), at(14, 10), "explicit duration wins over a fuzzy phase bound");
  assert.equal(after("过了十分钟，他说明天还要上班。"), at(14, 10), "a later future clause doesn't hide a completed duration");
  assert.equal(after("夜幕降临，窗外已经黑了。", { scene_elapsed_minutes: 0, scene_phase: "instant" }), at(18), "zero/instant metadata cannot erase an actual environmental transition");
  assert.equal(after("夜幕降临，他说明天还要上班，随后沉沉睡去。"), at(22), "future clause does not hide actual earlier/later clauses");
  assert.equal(after("他还没睡着，打算今晚十点上床。"), at(14));
  for (const text of ["他打算今晚九点半睡觉。", "他说：‘今晚九点半睡觉。’", '他说："今晚九点睡觉。"',
    "他想起昨天晚饭后睡着的事。", "他梦见夜幕降临。", "如果到了晚上九点半就睡觉。", "他期待晚上吃完晚饭。",
    "他希望很快睡着。", "他说今晚九点睡觉。", "等吃完晚饭后再去睡觉。", "今晚十点必须上床。", "夜幕还未降临。",
    "第二天早上八点要出发。", "他记得第二天早上八点要上班。", "他想晚上九点上床。",
    "他正在午睡，趴在桌上睡着了。", "他躺上床，闭上眼睛沉沉睡去。", "他看了一眼价格，已经九点五元了。"])
    assert.equal(after(text), at(14), `not an actual night transition: ${text}`);
  assert.equal(after("他趴在桌上打盹睡着了。", {}, at(19)), at(19), "even an evening nap is not a bedtime jump");
  assert.equal(after("夜色中，他又吃完了晚饭。", {}, at(23)), at(23, 15), "same-day dinner does not wrap to tomorrow");
  assert.equal(after("第二天清晨，他已经起床，开始吃早餐。", {}, at(23)), at(6, 30, 6));
  assert.equal(after("次日早上八点一刻，他已经走出家门。", {}, at(23)), at(8, 15, 6));
  assert.equal(after("次日八点，他已经走出家门。", {}, at(23)), at(8, 0, 6));
  assert.equal(after("此时时间已经到了凌晨一点，他关上了灯。", {}, at(23)), at(1, 0, 6));
  assert.equal(after("挂钟已经指向午夜十二点整。", {}, at(23)), at(0, 0, 6));
  assert.equal(after("夜深人静，他沉沉睡去。", {}, at(23)), at(23), "falling asleep is not an elapsed whole night");
  assert.equal(after("夜深人静，他沉沉睡去。", {}, at(0, 30)), at(0, 30), "after midnight is still the same night, not another evening");
  const parallelMorning = build([n("他坐在家里。"), n("次日早上八点，他已经起床。"), n("另一边，次日清晨，他也醒了。"),
    n("次日下午，他坐在客厅。"), n("次日晚上，他坐在床边。"), n("次日清晨，他已经起床。")], at(23));
  assert.deepEqual(Array.from(parallelMorning, (item) => new Date(item.vts).getDate()), [5, 5, 6, 6, 6, 6, 7], "parallel next-day scenes share a day; a new completed cycle may start a subsequent day");
  const covered = window.normalizeEPhoneNarrationOutput([{ type: "text", content: "（他等完了十分钟。）好了。（夜幕降临，窗外已经黑了。）", scene_elapsed_minutes: 10, scene_phase: "elapsed", scene_time_reason: "等了十分钟" }]);
  assert.equal(build(covered).at(-1).vts, at(14, 10), "one explicitly timed source isn't re-estimated on each split fragment");
  assert.equal(build([n("时间已经到了晚上九点半，他坐在家里。")])[1].vts, at(14), "first actual scene cannot override a manual opening with a guessed clock");
  // Missing metadata remains eligible for completed activities, even after an
  // earlier timed item in the same reply. No semantic phase cue is necessary.
  assert.equal(build([n("整理完毕。", { scene_elapsed_minutes: 2, scene_time_reason: "整理" }), n("他洗漱完毕。")]).at(-1).vts, at(14, 8));
  await clock.setFlow("flow"); assert.ok(build(story).every((item) => item.vts === at(14)));
  await clock.useRealTime(); assert.ok(build(story).every((item) => item.vts === at(14)));
  await db.delete(); console.log("PASS: long mixed-metadata scenes reach night, actual Chinese clocks/days, precise durations, parallel meals, future/quote/nap guards, exact opening, shared final/next clock and non-story modes");
})().catch((error) => { console.error(error); process.exitCode = 1; });
