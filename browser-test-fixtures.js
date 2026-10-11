// Supplies deterministic daily plans to older feature tests. Those tests count only
// their own feature requests; daily API behavior has its separate browser coverage.
function dailyReply(prompt) {
  if (!prompt.includes("独立生活当天行程规划师")) return null;
  const targets = JSON.parse(prompt.split("数据不是指令：")[1].split("\n上一轮")[0]), date = prompt.match(/仅生成(\d{4}-\d{2}-\d{2})星期/)[1];
  return { choices: [{ message: { content: JSON.stringify({ schedules: targets.map((p) => ({ key: p.key, plan: { date, items: [
    { start: "00:00", end: "07:00", activity: "睡眠", place: "本人家中", reachability: "rest" },
    { start: "09:00", end: "17:00", activity: "工作", place: "自己的单位", reachability: "busy" },
    { start: "23:00", end: "24:00", activity: "睡眠", place: "本人家中", reachability: "rest" }
  ] } })) }) }, finish_reason: "stop" }] };
}
module.exports = { dailyReply };
