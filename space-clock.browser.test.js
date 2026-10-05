const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const root = __dirname;
  const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, "." + (relative === "/" ? "/index.html" : relative));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const prompts = [], errors = []; let failure = false;
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://clock-test.invalid/")) {
        prompts.push(route.request().postDataJSON().messages[0].content);
        if (failure) return route.fulfill({ status: 503, body: "Test failure" });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify([{ type: "text", name: "林", content: "等十分钟再继续。" }]) } }] }) });
      }
      return route.abort(); // Only isolated fixtures; no real AI or user data.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    const morning = new Date(2026, 2, 5, 7, 20).getTime();
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main") || { id: "main" };
      await window.db.apiConfig.put({ ...config, proxyUrl: "https://clock-test.invalid/v1", apiKey: "test-placeholder", model: "test-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "clock-person", originalName: "林", groupNickname: "林", persona: "爱好书法。", avatar };
      await window.db.chats.put({ id: member.id, name: "林", originalName: "林", isGroup: false, avatar, settings: { aiPersona: member.persona, aiAvatar: avatar, maxMemory: 20 }, history: [] });
      for (const [id, name, watch] of [["clock-watch", "观看时间测试", true], ["clock-standard", "普通时间测试", false]]) {
        await window.db.chats.put({ id, name, isGroup: true, isSpectatorGroup: watch, avatar, members: [member],
          settings: { maxMemory: 20, myNickname: "我", linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [{ role: "user", content: "继续", timestamp: 100 }] });
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function openChat(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen"));
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click();
      await page.waitForSelector("#chat-interface-screen.active");
    }
    await openChat("clock-watch");
    // Exercise the actual date picker, including the correct weekday label.
    await page.locator('[data-spectator-action="time"]').click();
    await page.locator('[data-time-mode="custom"]').click();
    await page.locator("#time-machine-datetime").fill("2026-03-05T07:20");
    await page.locator('input[name="time-machine-flow"][value="frozen"]').check();
    assert.equal(await page.locator("#time-machine-selected-weekday").innerText(), "星期四");
    await page.locator("#time-machine-confirm").click();
    await page.waitForFunction(() => !document.getElementById("time-machine-modal").classList.contains("open"));
    await openChat("clock-standard");
    assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs("clock-standard")), morning);
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("clock-standard")).history.filter((item) => item.type === "time_marker").length), 0);
    await page.locator("#wait-reply-btn").click();
    await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.match(prompts.at(-1), /2026-03-05 07:20 周四/);
    const standardHeader = await page.evaluate(async () => (await window.db.chats.get("clock-standard")).history.findLast((item) => item.type === "narration" && /2026年3月5日/.test(item.content)));
    assert.ok(standardHeader, "Normal group must persist the visible date header");
    assert.match(standardHeader.content, /07点20分，星期四/);
    assert.equal(standardHeader.vts, morning);
    await openChat("clock-watch"); await page.evaluate((time) => window.ephoneTimeMachine.jumpTo(time, "frozen"), morning);
    await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.match(prompts.at(-1), /2026-03-05 07:20 周四/);
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("clock-watch")).history.filter((item) => item.isReplyHeader).at(-1)?.vts), morning);
    await page.evaluate(async () => {
      const chat = await window.db.chats.get("clock-watch");
      chat.history.push({ role: "user", type: "narration", content: "时间到了", vts: window.ephoneTimeMachine.nowMs(), timestamp: Date.now() + 100 });
      await window.db.chats.put(chat); await window.refreshPersonaSpaceData();
    });
    await openChat("clock-watch"); await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.match(prompts.at(-1), /2026-03-05 07:30 周四/);
    assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs("clock-standard")), morning + 10 * 60000);
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("clock-watch")).history.filter((item) => item.isReplyHeader).at(-1)?.vts), morning + 10 * 60000);
    failure = true;
    await page.evaluate((time) => window.ephoneTimeMachine.jumpTo(time, "frozen"), morning + 140 * 60000);
    await page.locator("#spectator-propel-btn").click();
    await page.waitForFunction(async () => (await window.db.spaceClock.get("main"))?.holdNextReply === true);
    await page.waitForFunction(() => document.getElementById("custom-modal-overlay")?.textContent.includes("503"));
    await page.locator("#custom-modal-overlay button").last().click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    failure = false; await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.match(prompts.at(-1), /2026-03-05 09:40 周四/);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await openChat("clock-standard"); assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), morning + 140 * 60000);
    assert.deepEqual(errors, []);
    console.log("PASS: mobile time modal, normal and spectator request prompts/headers, silent shared clock, exact first manual round, ten-minute deadline, failed-request hold rollback, persisted reload");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
