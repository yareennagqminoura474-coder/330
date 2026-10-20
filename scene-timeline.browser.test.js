// Isolated mobile UI, fake provider only; production reply/render/save paths.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(__dirname, "." + (new URL(req.url, "http://localhost").pathname === "/" ? "/index.html" : new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    let body = fs.readFileSync(file);
    if (file.endsWith(path.sep + "script.js")) body = body.toString().replace("  async function _0xbb356a(_0x5e47bd, _0x759d78, _0x29b05b = ![]) {", `
      async function _0xbb356a(_0x5e47bd, _0x759d78, _0x29b05b = ![]) {
        window.__sceneWrites = [...(window.__sceneWrites || []), { id: _0x759d78.id, content: _0x5e47bd.content,
          vts: _0x5e47bd.vts, now: window.ephoneTimeMachine.nowMs(_0x759d78.id) }];`);
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  let response = [], failure = false; const calls = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    // Accelerate display animations, not the network; retain time to test Stop.
    await page.addInitScript(() => { const original = window.setTimeout; window.setTimeout = (fn, ms, ...args) => original(fn, ms >= 700 && ms <= 3000 ? 25 : ms, ...args); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://scene-test.invalid/")) {
        calls.push(route.request().postDataJSON());
        if (failure) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "isolated failure" } }) });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: "stop" }] }) });
      }
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://scene-test.invalid/v1", apiKey: "fake-scene-key", model: "scene-test-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "scene-role", originalName: "林", groupNickname: "林", persona: "普通家庭的成年人。", avatar };
      for (const id of ["scene-watch", "scene-normal", "scene-private", "scene-offline"]) await window.db.chats.put({ id, name: id === "scene-private" || id === "scene-offline" ? "林" : id, originalName: "林", avatar,
        isGroup: ["scene-watch", "scene-normal"].includes(id), isSpectatorGroup: id === "scene-watch", members: [member], history: [{ role: "user", content: "继续", timestamp: 1 }],
        settings: { myNickname: "我", aiPersona: member.persona, aiAvatar: avatar, maxMemory: 30, isOfflineMode: id === "scene-offline", linkedMemoryChatIds: [], linkedWorldBookIds: [] } });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function open(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active");
    }
    const start = new Date(2026, 2, 5, 7, 20).getTime();
    async function jump(time) { await page.evaluate((time) => window.ephoneTimeMachine.jumpTo(time, "frozen"), time); const close = page.locator('#daily-schedule-status [data-action="close"]'); if (await close.isVisible()) await close.click(); }
    function longReply() {
      const items = [{ type: "narration", content: "2026年3月5日，07点28分，星期五，地点：家" }];
      for (let i = 0; i < 115; i++) {
        if (i === 12) items.push({ type: "narration", content: "交谈了一会，准备吃早饭。", scene_time: "2026-03-05T07:24" });
        if (i === 57) items.push({ type: "narration", content: "吃完早饭，收拾好餐桌，走到门口。", scene_time: "2026-03-05T07:57" });
        if (i === 95) items.push({ type: "narration", content: "二十分钟后，车停在学校门口。", scene_time: "2026-03-05T08:17" });
        items.push({ type: "text", name: "林", content: `短句${i}。` });
      }
      return items;
    }
    for (const id of ["scene-watch", "scene-normal", "scene-private", "scene-offline"]) {
      await open(id); await jump(start); response = longReply(); const count = calls.length;
      await page.evaluate(() => window.__sceneWrites = []);
      await page.locator(id === "scene-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy(), { timeout: 60000 });
      assert.equal(calls.length, count + 1, "one primary request for the whole long reply, no auxiliary or repair calls");
      assert.match(calls.at(-1).messages[0].content, /scene_time/);
      assert.ok(!calls.at(-1).messages[0].content.includes("所有台词、动作和旁白必须一致，不得自行再加几分钟"));
      const stored = await page.evaluate((id) => window.db.chats.get(id), id), visible = stored.history.filter((m) => m.role === "assistant" || m.type === "narration");
      assert.equal(visible.filter((m) => /^短句\d+。$/.test(m.content)).length, 115, `${id}: all reply items persist`);
      assert.equal(visible.find((m) => m.isReplyHeader).vts, start);
      assert.deepEqual(visible.filter((m) => m.isSceneTimeHeader).map((m) => m.vts), [start + 4 * 60000, start + 37 * 60000, start + 57 * 60000]);
      for (const [i, minutes] of [[0, 0], [12, 4], [57, 37], [95, 57], [114, 57]])
        assert.equal(visible.find((m) => m.content === `短句${i}。`).vts, start + minutes * 60000);
      assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs("scene-other")), start + 57 * 60000);
      const writes = await page.evaluate(() => window.__sceneWrites);
      assert.ok(writes.filter((m) => /^短句/.test(m.content)).every((m) => m.vts === m.now), "live clock follows each displayed scene, not the future end of the response");
    }
    await open("scene-watch"); response = [{ type: "text", name: "林", content: "下一轮继续。" }];
    await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.match(calls.at(-1).messages[0].content, /2026-03-05 08:17 周四/);
    assert.match(JSON.stringify(calls.at(-1).messages.slice(1)), /07:57/);
    assert.match(JSON.stringify(calls.at(-1).messages.slice(1)), /08:17/);
    for (const id of ["scene-watch", "scene-normal"]) {
      await open(id); await jump(start); response = longReply(); const beforeStop = calls.length;
      const button = page.locator(id === "scene-watch" ? "#spectator-propel-btn" : "#wait-reply-btn");
      await button.click();
      await page.waitForFunction((time) => window.ephoneTimeMachine.nowMs() === time, start + 4 * 60000);
      await button.click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      assert.equal(calls.length, beforeStop + 1);
      const stopped = await page.evaluate((id) => window.db.chats.get(id), id);
      assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), stopped.history.at(-1).vts);
      assert.equal(stopped.history.at(-1).vts, start + 4 * 60000, "Stop never commits the unshown final scene");
    }
    await open("scene-watch");
    const midnight = new Date(2026, 2, 5, 23, 58).getTime(); await jump(midnight);
    response = [{ type: "text", name: "林", content: "先坐一会。" }, { type: "narration", content: "2026年3月6日，00点11分，星期四，地点：卧室。正文不能丢失。" }, { type: "text", name: "林", content: "今天星期四，明天星期五。" }];
    await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    const overnight = await page.evaluate(() => window.db.chats.get("scene-watch"));
    assert.match(overnight.history.findLast((m) => m.isSceneTimeHeader).content, /2026年3月6日，00点11分，星期五/);
    assert.equal(overnight.history.at(-1).content, "今天星期五，明天星期六。");
    assert.ok(overnight.history.some((m) => m.content === "正文不能丢失。"));
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await open("scene-normal");
    assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), new Date(2026, 2, 6, 0, 11).getTime());
    failure = true; await jump(start);
    await page.locator("#wait-reply-btn").click();
    await page.waitForFunction(() => document.getElementById("custom-modal-overlay")?.textContent.includes("503"));
    await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.equal(await page.evaluate(async () => (await window.db.spaceClock.get("main")).holdNextReply), true);
    assert.deepEqual(errors, []);
    console.log("PASS: actual mobile watch/normal/private/offline 115-message replies save per-scene time with one primary call, synchronized live clock, exact manual start, Stop, midnight/body/weekday, reload and failure retry hold");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
