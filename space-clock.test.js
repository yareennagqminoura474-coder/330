const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
require("fake-indexeddb/auto"); const Dexie = require("dexie");
const source = fs.readFileSync("time-machine.js", "utf8");
function harness(storage = new Map()) {
  const window = {};
  vm.runInNewContext(source, { window, Date, console, Number, String, Promise, setInterval,
    document: { readyState: "loading", addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  return window.ephoneTimeMachine;
}
async function create(name) { const db = new Dexie(name); db.version(51).stores({ chats: "&id", spaceClock: "&id" }); await db.open(); return db; }
async function bind(clock, db, id) {
  const chat = await db.chats.get(id);
  clock.bindChat({ id, settings: chat.settings, getMessages: () => chat.history, getMemories: () => chat.longTermMemory,
    applyConfig: async (config) => { Object.assign(chat.settings, clock.configForChatSettings(config)); await db.chats.put(chat); } });
  return chat;
}
async function prepare(clock, history, id) { const result = clock.prepareReplyTime(history, { chatId: id }); await result.ready; return result; }
(async () => {
  const name = `space-clock-tests-${Date.now()}`, db = await create(name), other = await create(name + "-other");
  const morning = new Date(2026, 2, 5, 7, 20).getTime();
  const oldTime = morning - 86400000;
  const legacySettings = { timeMode: "custom", customTimeFlow: "frozen", customAnchorRealMs: 1000, customAnchorVirtualMs: oldTime, virtualTimeFrozenMap: { "100": oldTime - 500 } };
  await db.chats.bulkPut([
    { id: "a", settings: legacySettings, history: [{ role: "assistant", timestamp: 100, content: "历史" }], longTermMemory: [{ timestamp: 200, vts: oldTime - 1000 }] },
    { id: "b", settings: { timeMode: "custom", customTimeFlow: "frozen", customAnchorRealMs: 2000, customAnchorVirtualMs: oldTime + 60000 }, history: [] },
    { id: "real", settings: {}, history: [{ role: "user", timestamp: 123, content: "现实历史" }] },
  ]);
  const clock = harness(); await clock.loadSpace(db);
  assert.equal(clock.nowMs("a"), oldTime + 60000); assert.equal(clock.nowMs("b"), oldTime + 60000);
  assert.equal((await db.chats.get("a")).history[0].vts, oldTime - 500);
  assert.equal((await db.chats.get("real")).history[0].vts, 123);
  let a = await bind(clock, db, "a"); await clock.jumpTo(morning, "frozen");
  assert.equal(clock.nowMs("a"), morning); assert.equal(clock.nowMs("b"), morning);
  assert.equal(a.history.filter((item) => item.type === "time_marker").length, 1);
  assert.equal((await db.chats.get("b")).history.length, 0);
  let b = await bind(clock, db, "b"); assert.equal(clock.nowMs(), morning);
  let first = await prepare(clock, b.history, "b");
  assert.equal(first.afterMs, morning); assert.equal(first.minutes, 0); assert.equal(first.manualHold, true);
  await clock.rollbackPreparedReplyTime(first);
  assert.equal(clock.getConfig().holdNextReply, true); assert.equal(clock.nowMs(), morning);
  // Reload from IndexedDB, not localStorage. A failed first request must not
  // consume the manual hold; even another chat's next successful reply uses it.
  const reload = harness(); await reload.loadSpace(db); b = await bind(reload, db, "b");
  first = await prepare(reload, b.history, "b"); assert.equal(first.afterMs, morning);
  const next = await prepare(reload, [{ role: "assistant", content: "继续", vts: morning }], "b");
  assert.ok(next.afterMs > morning); assert.equal(reload.nowMs("a"), next.afterMs);
  await reload.rollbackPreparedReplyTime(next);
  assert.equal(reload.nowMs("a"), morning); assert.equal(reload.getConfig().holdNextReply, false);
  async function deadline(plan, expectedMinutes, elapsedText = "时间到了") {
    await reload.jumpTo(morning, "frozen"); await prepare(reload, [], "b");
    const history = [{ role: "assistant", type: "text", content: plan, vts: morning, timestamp: 100 },
      { role: "user", type: "narration", content: elapsedText, vts: morning + 3 * 60000, timestamp: 101 }];
    const result = await prepare(reload, history, "b");
    assert.equal(result.afterMs, morning + expectedMinutes * 60000, `${plan} / ${elapsedText}`);
    assert.equal(reload.nowMs("a"), result.afterMs);
    assert.equal(clock.messageTime(a.history[0], "a"), oldTime - 500);
  }
  await deadline("等十分钟再开始。", 10);
  await deadline("等20分钟，之后回来。", 20, "到时间了");
  await deadline("休息半小时后再聊。", 30);
  await deadline("等待一个小时二十分钟。", 80);
  await deadline("等一刻钟再来。", 15);
  await deadline("等待两小时。", 120);
  await deadline("休息一个半小时。", 90);
  await reload.jumpTo(morning, "frozen"); await prepare(reload, [], "b");
  const wait = await prepare(reload, [{ role: "assistant", content: "再等十分钟", vts: morning }], "b");
  assert.ok(wait.afterMs < morning + 10 * 60000); // future promise is not elapsed
  const future = await prepare(reload, [{ role: "assistant", type: "text", content: "十分钟之后再继续。", vts: morning }], "b");
  assert.ok(future.afterMs < morning + 10 * 60000);
  const reached = await prepare(reload, [{ role: "assistant", content: "等十分钟", vts: morning }, { role: "user", content: "时间到了", vts: wait.afterMs }], "b");
  assert.equal(reached.afterMs, morning + 10 * 60000); // only the remaining time
  const again = await prepare(reload, [{ role: "assistant", content: "等十分钟", vts: morning }, { role: "user", content: "时间到了", vts: wait.afterMs }], "b");
  assert.equal(again.afterMs, reached.afterMs); // never count the same deadline twice
  await reload.jumpTo(morning, "frozen"); await prepare(reload, [], "b");
  const elapsed = await prepare(reload, [{ role: "user", type: "narration", content: "过了二十分钟", vts: morning }], "b");
  assert.equal(elapsed.afterMs, morning + 20 * 60000);
  await reload.jumpTo(morning, "frozen"); await prepare(reload, [], "b");
  const notYet = await prepare(reload, [{ role: "assistant", content: "等二十分钟", vts: morning }, { role: "user", content: "时间还没到", vts: morning }], "b");
  assert.ok(notYet.afterMs < morning + 20 * 60000);
  await reload.jumpTo(morning, "frozen");
  const reroll = reload.prepareReplyTime([], { chatId: "b", advance: false });
  assert.equal(reroll.afterMs, morning); assert.equal(reload.getConfig().holdNextReply, true);
  await reload.loadSpace(other); assert.equal(reload.getConfig("b").mode, "real");
  await other.chats.put({ id: "x", settings: {}, history: [] }); await bind(reload, other, "x");
  await reload.jumpTo(morning + 7 * 86400000, "frozen");
  await reload.loadSpace(db); assert.equal(reload.nowMs("a"), morning); assert.equal(reload.getConfig("a").holdNextReply, true);
  const held = await prepare(reload, [], "a");
  await bind(reload, db, "a"); await reload.jumpTo(morning + 60000, "frozen");
  await reload.rollbackPreparedReplyTime(held); assert.equal(reload.nowMs(), morning + 60000); // stale rollback cannot undo a later manual jump
  await reload.useRealTime(); await reload.jumpTo(morning, "frozen");
  assert.equal((await db.chats.get("a")).history[0].vts, oldTime - 500);
  assert.equal((await db.chats.get("a")).longTermMemory[0].vts, oldTime - 1000);
  await db.delete(); await other.delete();
  console.log("PASS: shared per-space clock, silent synchronization, historical preservation, manual first-round hold, retry/reload, exact Chinese/numeric waits, elapsed scenes, no repeated deadline, rollback and space isolation");
})().catch((error) => { console.error(error); process.exitCode = 1; });
