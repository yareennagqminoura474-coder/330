const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
require("fake-indexeddb/auto"); const Dexie = require("dexie");
const calendar = require("./holiday-calendar");
const at = (date) => new Date(date + "T12:00:00").getTime();
(async () => {
  assert.match(calendar.describe(at("2026-10-01")), /国庆节放假中.*2026-10-01 周四～2026-10-07 周三（7天）/);
  assert.match(calendar.describe(at("2026-10-07")), /含今天还剩1天/);
  assert.match(calendar.describe(at("2026-10-08")), /公共安排：普通工作日/);
  assert.match(calendar.describe(at("2026-10-10")), /2026-10-10 周六/);
  assert.match(calendar.describe(at("2026-10-10")), /公共安排：调休上班日/);
  assert.match(calendar.describe(at("2026-09-20")), /公共安排：调休上班日/);
  assert.match(calendar.describe(at("2026-09-26")), /中秋节放假中/);
  assert.match(calendar.describe(at("2026-02-17")), /当天节日：春节（正月初一）/);
  assert.match(calendar.describe(at("2026-02-23")), /第9天，含今天还剩1天/);
  assert.match(calendar.describe(at("2026-02-24")), /公共安排：普通工作日/);
  assert.match(calendar.describe(at("2026-02-28")), /公共安排：调休上班日/);
  assert.match(calendar.describe(at("2026-01-04")), /公共安排：调休上班日/);
  assert.match(calendar.describe(at("2025-01-01")), /元旦放假中.*（1天）/);
  assert.match(calendar.describe(at("2025-10-06")), /当天节日：中秋节/);
  assert.match(calendar.describe(at("2025-10-06")), /国庆节、中秋节放假中.*（8天）/);
  assert.match(calendar.describe(at("2024-02-09")), /当天节日：除夕/);
  assert.match(calendar.describe(at("2024-02-09")), /公共安排：普通工作日/);
  assert.match(calendar.describe(at("2027-02-06")), /当天节日：春节（正月初一）/);
  assert.match(calendar.describe(at("2027-02-05")), /当天节日：除夕/);
  assert.match(calendar.describe(at("2027-06-09")), /当天节日：端午节/);
  assert.match(calendar.describe(at("2027-09-15")), /当天节日：中秋节/);
  assert.match(calendar.describe(at("2027-02-06")), /2027年的中国大陆放假调休安排尚未内置/);
  assert.doesNotMatch(calendar.describe(at("2027-02-06")), /放假中|2026-02-15|共9天/);
  assert.match(calendar.describe(at("2026-03-03")), /当天节日：元宵节/);
  assert.match(calendar.describe(at("2026-03-03")), /公共安排：普通工作日/);
  for (const year of [2024, 2025, 2026]) {
    for (let ms = new Date(year, 0, 1, 12).getTime(); new Date(ms).getFullYear() === year; ms = new Date(new Date(ms).setDate(new Date(ms).getDate() + 1)).getTime()) {
      const text = calendar.describe(ms);
      assert.ok(!/NaN|undefined|Invalid Date/.test(text));
    }
  }
  for (const bad of ["2026-02-30 | 假 | 放假", "2026-03-05 ~ 2026-03-01 | 假 | 放假", "2026-03-05 | 假 | 放假 |", "2026-03-05 | 假 | 随便"])
    assert.throws(() => calendar.parseDraft(bad));
  const text = "2026-12-20 ~ 2027-01-10 | 寒假 | 放假 | 清北班学生\n2027-01-11 | 返校 | 上课 | 清北班学生";
  const entries = calendar.parseDraft(text);
  assert.match(calendar.describe(at("2027-01-05"), entries), /寒假.*清北班学生.*当前生效/);
  assert.doesNotMatch(calendar.describe(at("2027-01-12"), entries), /寒假|返校/);
  const name = "holiday-test-" + Date.now();
  const db = new Dexie(name), other = new Dexie(name + "-other");
  for (const d of [db, other]) { d.version(1).stores({ spaceClock: "&id", chats: "&id" }); await d.open(); }
  await db.spaceClock.put({ id: "main", mode: "custom", anchorVirtualMs: at("2026-10-10") });
  await calendar.loadSpace(db); await calendar.saveDraft(text);
  assert.match(calendar.prompt(at("2027-01-05")), /寒假/);
  assert.equal((await db.spaceClock.get("main")).anchorVirtualMs, at("2026-10-10"));
  await calendar.loadSpace(other); assert.doesNotMatch(calendar.prompt(at("2027-01-05")), /本空间自定义安排：寒假/);
  await calendar.loadSpace(db); assert.match(calendar.prompt(at("2027-01-05")), /本空间自定义安排：寒假/);
  const window = { ephoneHolidayCalendar: calendar }, storage = new Map();
  vm.runInNewContext(fs.readFileSync("time-machine.js", "utf8"), { window, document: { readyState: "loading", addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }, Date, console, setInterval });
  const clock = window.ephoneTimeMachine, history = [];
  await clock.loadSpace(db);
  clock.bindChat({ id: "watch", settings: {}, getMessages: () => history, applyConfig: async () => {} });
  await clock.jumpTo(at("2026-10-10"), "frozen");
  assert.match(clock.getPromptRule(), /2026-10-10 周六.*\n.*当天节日/);
  assert.match(clock.getPromptRule(), /公共安排：调休上班日/);
  assert.match(clock.getPromptRule("watch", at("2026-10-03")), /国庆节放假中/);
  assert.match(clock.getPromptRule("watch", at("2027-01-05")), /本空间自定义安排：寒假/);
  assert.match(calendar.prompt(at("2027-01-05")), /未设定则不编造/);
  await calendar.saveDraft(""); assert.doesNotMatch(calendar.prompt(at("2027-01-05")), /本空间自定义安排：寒假/);
  const put = db.spaceClock.put.bind(db.spaceClock);
  db.spaceClock.put = async () => { throw new Error("simulated write failure"); };
  await assert.rejects(() => calendar.saveDraft(text), /simulated write failure/);
  assert.doesNotMatch(calendar.prompt(at("2027-01-05")), /本空间自定义安排：寒假/);
  db.spaceClock.put = put;
  await calendar.saveDraft(text); // Failed writes must not poison the next save.
  await db.delete(); await other.delete();
  console.log("PASS: all 2024–2026 dates, official breaks/makeup days, exact 2027 festivals (including ICU CNY regression), unknown-year honesty, custom dates/scopes, per-space persistence/clear/failure recovery, unchanged shared clock, real time-machine prompt integration");
})().catch((error) => { console.error(error); process.exitCode = 1; });
