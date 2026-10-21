// Isolated mobile browser: long, partially annotated replies must follow actual
// afternoon/evening/night scene changes without another provider request.
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
        window.__longSceneWrites = [...(window.__longSceneWrites || []), {
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
      if (url.startsWith("https://long-scenes.invalid/")) {
        calls.push(route.request().postDataJSON());
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: "stop" }] }) });
      }
      // No actual main, auxiliary or third-party service is reachable here.
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://long-scenes.invalid/v1", apiKey: "fake-local-test", model: "local-long-scene-test" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "long-scene-role", originalName: "林", groupNickname: "林", persona: "普通家庭的成年人。", avatar };
      for (const id of ["long-scene-watch", "long-scene-normal"]) await window.db.chats.put({
        id, name: id, avatar, isGroup: true, isSpectatorGroup: id === "long-scene-watch", members: [member],
        history: [{ role: "user", content: "接着下午的故事，推进到晚上休息。", timestamp: 1 }],
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
    function longReply() {
      const items = [
        { type: "narration", content: "2026年3月5日，15点00分，星期四，地点：家" },
        { type: "narration", content: "两人在客厅交谈了一会。", scene_phase: "elapsed", scene_elapsed_minutes: 2, scene_time_reason: "交谈" },
      ];
      for (let i = 0; i < 160; i++) {
        if (i === 50) items.push({ type: "narration", content: "天色渐暗，夜幕降临，客厅的灯亮了。" });
        if (i === 85) items.push({ type: "narration", content: "两人吃完晚饭，收拾好餐桌。" });
        if (i === 88) items.push({ type: "narration", content: "另一边，家人也吃完晚饭，放下了筷子。" });
        if (i === 145) items.push({ type: "narration", content: "夜已深，他躺上床，闭上眼睛沉沉睡去。" });
        items.push({ type: "text", name: "林", content: `长轮次台词${i}。` });
      }
      return items;
    }
    const start = new Date(2026, 2, 5, 15, 0).getTime(), night = new Date(2026, 2, 5, 22, 0).getTime(), midnight = new Date(2026, 2, 6).getTime();
    for (const id of ["long-scene-watch", "long-scene-normal"]) {
      await open(id);
      await page.evaluate((start) => window.ephoneTimeMachine.jumpTo(start, "frozen"), start);
      const close = page.locator('#daily-schedule-status [data-action="close"]');
      if (await close.isVisible()) await close.click();
      response = longReply();
      const before = calls.length;
      await page.evaluate(() => window.__longSceneWrites = []);
      const button = id === "long-scene-watch" ? "#spectator-propel-btn" : "#wait-reply-btn";
      await page.locator(button).click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy(), { timeout: 60000 });
      assert.equal(calls.length, before + 1, `${id}: one main API request, no semantic repair request`);
      const saved = await page.evaluate((id) => window.db.chats.get(id), id);
      const rows = saved.history.filter((item) => item.role === "assistant" || item.type === "narration");
      assert.equal(rows.filter((item) => /^长轮次台词\d+。$/.test(item.content)).length, 160, `${id}: no truncation`);
      assert.equal(rows[0].isReplyHeader, true);
      assert.equal(rows[0].vts, start, "manual opening is exact");
      assert.equal(rows.filter((item) => item.isReplyHeader).length, 1);
      assert.equal(rows.filter((item) => item.isSceneTimeHeader).length, 0);
      assert.equal(rows.filter((item) => /地点：/.test(item.content)).length, 1);
      assert.ok(rows.every((item, index) => index === 0 || item.vts >= rows[index - 1].vts), "scene clocks are monotonic");
      const evening = rows.find((item) => /夜幕降临/.test(item.content));
      assert.ok(new Date(evening.vts).getHours() >= 17 && evening.vts < midnight, "actual evening is not left at 15:02");
      const sleeping = rows.find((item) => /沉沉睡去/.test(item.content));
      assert.ok(sleeping.vts >= night && sleeping.vts < midnight, "actual deep-night sleep advances to nighttime");
      const end = rows.at(-1).vts;
      assert.ok(end >= night && end < midnight, "parallel dinners cannot roll the same evening into another day");
      assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs("another-chat")), end, "space clock follows final scene");
      const writes = await page.evaluate(() => window.__longSceneWrites);
      assert.ok(writes.length >= 160);
      assert.ok(writes.every((item) => item.vts === item.now), "live clock matches each displayed message, not the eventual end");
      const lastBadge = await page.locator("#chat-messages .narration-timestamp").last().innerText();
      assert.equal(lastBadge, `${String(new Date(sleeping.vts).getHours()).padStart(2, "0")}:${String(new Date(sleeping.vts).getMinutes()).padStart(2, "0")}`);
      // A reload must preserve the final scene clock rather than reopening the afternoon.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.ephoneAppReady);
      assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs("another-chat")), end);
      await open(id);
      response = [{ type: "text", name: "林", content: "接着刚才的夜晚继续。" }];
      const second = calls.length;
      await page.locator(button).click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy(), { timeout: 60000 });
      assert.equal(calls.length, second + 1);
      const next = await page.evaluate((id) => window.db.chats.get(id), id);
      const opening = next.history.findLast((item) => item.isReplyHeader);
      assert.ok(opening.vts > end && opening.vts <= end + 3 * 60000, "next opening advances from the latest night scene");
      const expected = new Date(opening.vts);
      const compact = `2026-03-05 ${String(expected.getHours()).padStart(2, "0")}:${String(expected.getMinutes()).padStart(2, "0")}`;
      assert.ok(calls.at(-1).messages[0].content.includes(compact), "next main request receives final scene's actual clock");
    }
    assert.deepEqual(errors, []);
    console.log("long scene mobile browser tests passed (watch + normal, 160 messages, local fake API only)");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
