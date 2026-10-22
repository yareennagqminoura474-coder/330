// Real mobile reply/render/save paths, isolated fake provider only. A natural
// night-time scene must not freeze at 19:xx just because one mixed source was
// split into several already-timed action fragments.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    let body = fs.readFileSync(file);
    if (file.endsWith(path.sep + "script.js")) body = body.toString().replace("  async function _0xbb356a(_0x5e47bd, _0x759d78, _0x29b05b = ![]) {", `
      async function _0xbb356a(_0x5e47bd, _0x759d78, _0x29b05b = ![]) {
        window.__bedtimeWrites = [...(window.__bedtimeWrites || []), {
          content: _0x5e47bd.content, vts: _0x5e47bd.vts,
          now: window.ephoneTimeMachine.nowMs(_0x759d78.id) }];`);
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  let response = []; const calls = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await page.addInitScript(() => {
      const original = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) => original(fn, ms >= 700 && ms <= 3000 ? 15 : ms, ...args);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://bedtime-scenes.invalid/")) {
        calls.push(route.request().postDataJSON());
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: "stop" }] }) });
      }
      return route.abort(); // No real provider, auxiliary or repair request.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://bedtime-scenes.invalid/v1", apiKey: "fake-local-bedtime", model: "local-bedtime-test" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "bedtime-role", originalName: "林", groupNickname: "林", persona: "普通家庭的成年人，生活节奏自然，按具体当天安排休息。", avatar };
      for (const id of ["bedtime-watch", "bedtime-normal", "bedtime-early", "bedtime-intention"]) await window.db.chats.put({
        id, name: id, avatar, isGroup: true, isSpectatorGroup: id !== "bedtime-normal", members: [member],
        history: [{ role: "user", content: "接着晚饭后的故事继续。", timestamp: 1 }],
        settings: { myNickname: "我", aiPersona: member.persona, aiAvatar: avatar, maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] },
      });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady);
    async function open(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen"));
      await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click();
      await page.waitForSelector("#chat-interface-screen.active");
    }
    const start = new Date(2026, 2, 5, 19, 20).getTime(), late = new Date(2026, 2, 5, 21).getTime(), midnight = new Date(2026, 2, 6).getTime();
    async function jump() {
      await page.evaluate((time) => window.ephoneTimeMachine.jumpTo(time, "frozen"), start);
      const close = page.locator('#daily-schedule-status [data-action="close"]');
      if (await close.isVisible()) await close.click();
    }
    async function generate(id) {
      const before = calls.length;
      await page.locator(id === "bedtime-normal" ? "#wait-reply-btn" : "#spectator-propel-btn").click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy(), { timeout: 60000 });
      assert.equal(calls.length, before + 1, "a reply uses exactly one main request, no semantic repair API");
      return page.evaluate((id) => window.db.chats.get(id), id);
    }
    function longReply() {
      return [
        { type: "narration", content: "2026年3月5日，19点20分，星期四，地点：家" },
        { type: "narration", name: "林", content: "他坐在客厅，接着刚才的话题。", scene_phase: "instant", scene_elapsed_minutes: 0 },
        ...Array.from({ length: 120 }, (_, i) => ({ type: "text", name: "林", content: `晚间台词${i}。` })),
        { type: "text", name: "林", content: "（他吃完了晚饭。）晚安。（他关灯上床，钻进被窝。）", scene_phase: "elapsed", scene_elapsed_minutes: 15, scene_time_reason: "用餐与收拾" },
      ];
    }
    for (const id of ["bedtime-watch", "bedtime-normal"]) {
      await open(id); await jump(); response = longReply();
      await page.evaluate(() => window.__bedtimeWrites = []);
      const saved = await generate(id), rows = saved.history.filter((item) => item.role === "assistant" || item.type === "narration");
      assert.equal(rows.filter((item) => /^晚间台词\d+。$/.test(item.content)).length, 120, "all long-turn dialogue survives");
      assert.equal(rows[0].isReplyHeader, true); assert.equal(rows[0].vts, start);
      assert.equal(rows.filter((item) => item.isReplyHeader).length, 1);
      assert.equal(rows.filter((item) => item.isSceneTimeHeader).length, 0);
      assert.equal(rows.filter((item) => /地点：/.test(item.content)).length, 1);
      assert.ok(rows.some((item) => item.content === "晚安。"), "farewell dialogue is not rewritten or dropped");
      const sleeping = rows.find((item) => /关灯上床/.test(item.content));
      assert.ok(sleeping, "the split physical bedtime scene is displayed intact");
      assert.ok(sleeping.vts >= late && sleeping.vts < midnight, "a completed ordinary night transition cannot freeze at 19:35");
      assert.ok(rows.every((item, index) => index === 0 || item.vts >= rows[index - 1].vts));
      const end = rows.at(-1).vts;
      assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs("another-chat")), end);
      const writes = await page.evaluate(() => window.__bedtimeWrites);
      assert.ok(writes.length >= 120);
      assert.ok(writes.every((item) => item.vts === item.now), "each live clock follows that displayed scene");
      const badge = await page.locator("#chat-messages .narration-timestamp").last().innerText();
      assert.equal(badge, `${String(new Date(end).getHours()).padStart(2, "0")}:${String(new Date(end).getMinutes()).padStart(2, "0")}`);
      assert.match(calls.at(-1).messages[0].content, /收场|结束一轮|晚安.{0,15}(?:结束|收尾)/, "generation prompt also guards against rushed bedtime closure");
      assert.match(calls.at(-1).messages[0].content, /作息|早睡|就寝安排/, "existing individual plans remain authoritative");
      response = [{ type: "text", name: "林", content: "接着夜间的场景继续。" }];
      const next = await generate(id), opening = next.history.findLast((item) => item.isReplyHeader);
      assert.ok(opening.vts > end && opening.vts <= end + 3 * 60000, "next round continues from final night clock, not 19:20");
      const time = new Date(opening.vts), compact = `2026-03-05 ${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
      assert.ok(calls.at(-1).messages[0].content.includes(compact));
    }
    // A specifically stated early bedtime is a different scene, not a reason
    // for a global forced 22:00. The earlier statement itself remains a plan.
    await open("bedtime-early"); await jump();
    response = [
      { type: "narration", name: "林", content: "他坐在客厅。", scene_phase: "instant", scene_elapsed_minutes: 0 },
      { type: "narration", name: "林", content: "他打算今晚19:30就上床睡觉。", scene_phase: "planned", scene_elapsed_minutes: 0 },
      { type: "text", name: "林", content: "今天遵医嘱早睡。" },
      { type: "narration", name: "林", content: "他关灯上床，钻进被窝，沉沉睡去。" },
    ];
    const early = (await generate("bedtime-early")).history.filter((item) => item.role === "assistant" || item.type === "narration");
    assert.equal(early.find((item) => /打算今晚/.test(item.content)).vts, start, "a plan does not immediately change the current clock");
    assert.ok(early.at(-1).vts >= start && early.at(-1).vts < start + 30 * 60000, "explicit 19:30 early bedtime is respected instead of forced late");
    await open("bedtime-intention"); await jump();
    response = [
      { type: "narration", content: "他坐在客厅。", scene_phase: "instant", scene_elapsed_minutes: 0 },
      { type: "text", name: "林", content: "晚安。" },
      { type: "narration", name: "林", content: "他即将入睡。", scene_phase: "planned", scene_elapsed_minutes: 0 },
    ];
    const intention = (await generate("bedtime-intention")).history.filter((item) => item.role === "assistant" || item.type === "narration");
    assert.equal(intention.at(-1).vts, start, "goodnight or imminent sleep alone is not already completed bedtime");
    assert.deepEqual(errors, []);
    console.log("PASS: evening bedtime mobile watch/normal 120-message mixed sources, full content, single main/header, scene/live/next clock, explicit early bedtime and no farewell/future jump (local fake API only)");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
