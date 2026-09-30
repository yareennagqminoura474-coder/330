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

  const marchFifth = new Date(2026, 2, 5, 12).getTime();
  assert.equal(clock.normalizeWeekdayText("2026年3月5日，星期五", marchFifth), "2026年3月5日，星期四");
  assert.equal(clock.normalizeWeekdayText("3月5号，星期五", marchFifth), "3月5号，星期四");
  assert.equal(clock.normalizeWeekdayText("2026 年 3 月 5 日，周 五", marchFifth), "2026 年 3 月 5 日，周四");
  assert.equal(clock.normalizeWeekdayText("2026-03-05 星期五", marchFifth), "2026-03-05 星期四");
  assert.equal(clock.normalizeWeekdayText("今天星期五，明天星期四", marchFifth), "今天星期四，明天星期五");
  const spectatorChat = { id: "old-spectator-group", isSpectatorGroup: true };
  const oldSpectatorMessage = { role: "assistant", type: "narration", content: "2026年3月5日，星期五", vts: marchFifth };
  assert.equal(clock.normalizeChatMessageWeekday(oldSpectatorMessage, spectatorChat).content, "2026年3月5日，星期四");
  assert.equal(oldSpectatorMessage.content, "2026年3月5日，星期五");
  assert.equal(clock.normalizeChatMessageWeekday({ ...oldSpectatorMessage, role: "user" }, spectatorChat).content, "2026年3月5日，星期五");
  await clock.jumpTo(marchFifth, clock.FLOWS.FROZEN);
  assert.match(clock.getPromptRule("group-1"), /2026-03-05 12:00 周四/);
  assert.match(clock.getPromptRule("group-1", marchFifth + 7 * 60 * 1000), /2026-03-05 12:07 周四/);
  const marchReply = clock.ensureReplyHeader([
    { type: "narration", content: "2026年3月5日，星期五，教室里很安静。" },
  ], { chatId: "group-1", replyTimeMs: marchFifth });
  assert.match(marchReply[0].content, /2026年3月5日，12点00分，星期四/);
  assert.match(marchReply[1].content, /2026年3月5日，星期四/);

  const preparation = clock.prepareReplyTime(
    [{ role: "assistant", type: "text", content: "继续", sentAsCharacter: true }],
    { chatId: "group-1" },
  );
  assert.equal(preparation.chatId, "group-1");
  assert.equal(preparation.afterMs, clock.nowMs("group-1"));
  assert.match(clock.formatReplyHeader(clock.nowMs(), "学校"), /2026年3月5日，\d{2}点\d{2}分，星期四/);
  console.log("Time machine weekday tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
