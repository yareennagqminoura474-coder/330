const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const storage = new Map();
const window = {};
const document = {
  readyState: "loading",
  addEventListener() {},
  getElementById() { return null; },
};
vm.runInNewContext(fs.readFileSync("time-machine.js", "utf8"), {
  window,
  document,
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  },
  console,
  Date,
  Number,
  String,
  Promise,
  setInterval,
});

(async () => {
  const clock = window.ephoneTimeMachine;
  const history = [];
  const settings = {};
  clock.bindChat({ id: "group-1", settings, getMessages: () => history, applyConfig: async () => {} });

  const thursday = new Date(2027, 0, 7, 23, 59).getTime();
  await clock.jumpTo(thursday, clock.FLOWS.FROZEN);
  assert.match(history.at(-1).content, /2027-01-07 23:59 周四/);
  assert.match(clock.formatReplyHeader(clock.nowMs(), "学校"), /2027年1月7日，23点59分，星期四，地点：学校/);

  const reply = clock.ensureReplyHeader([
    { type: "narration", content: "2027年1月7日，23点59分，星期三，地点：学校" },
    { type: "text", content: "2028年2月29日，星期一再见。" },
    { type: "narration", content: "2027年2月30日，星期一是假日期，不应擅自修正。" },
  ]);
  assert.equal(reply.filter((item) => item.isReplyHeader).length, 1);
  assert.match(reply[0].content, /2027年1月7日，23点59分，星期四，地点：学校/);
  assert.match(reply[1].content, /2028年2月29日，星期二/);
  assert.match(reply[2].content, /2027年2月30日，星期一/);
  assert.match(clock.getPromptRule(), /星期必须按该日期的日历计算/);

  clock.prepareReplyTime([{ role: "user", type: "text", content: "继续" }]);
  assert.match(clock.formatReplyHeader(clock.nowMs(), "学校"), /2027年1月8日，\d{2}点\d{2}分，星期五/);
  console.log("Time machine weekday tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
