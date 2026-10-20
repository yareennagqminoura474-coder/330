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
      const items = [
        { type: "narration", content: "2026年3月5日，07点20分，星期四，地点：家\n\u200b\ufeff" },
        { type: "text", name: "林", content: "" },
        { type: "text", name: "林", content: " \n\t\u200b\ufeff" },
        { type: "text", name: "林", content: "<span>&nbsp;<br></span>" },
        { type: "narration", content: "他坐在桌旁。", scene_phase: "instant", scene_elapsed_minutes: 0 },
      ];
      for (let i = 0; i < 115; i++) {
        if (i === 12) items.push({ type: "narration", content: "交谈了一会，准备吃早饭。", scene_elapsed_minutes: 4, scene_time_reason: "交谈", scene_phase: "elapsed" });
        if (i === 57) items.push({ type: "narration", content: "吃完早饭，收拾好餐桌，走到门口。", scene_elapsed_minutes: 33, scene_time_reason: "用餐并收拾", scene_phase: "elapsed" });
        if (i === 95) items.push({ type: "narration", content: "二十分钟后，车停在学校门口。", scene_elapsed_minutes: 20, scene_time_reason: "行车结束", scene_phase: "elapsed" });
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
      assert.match(calls.at(-1).messages[0].content, /scene_elapsed_minutes/);
      assert.ok(!calls.at(-1).messages[0].content.includes("所有台词、动作和旁白必须一致，不得自行再加几分钟"));
      const stored = await page.evaluate((id) => window.db.chats.get(id), id), visible = stored.history.filter((m) => m.role === "assistant" || m.type === "narration");
      assert.equal(visible.filter((m) => /^短句\d+。$/.test(m.content)).length, 115, `${id}: all reply items persist`);
      assert.equal(visible.length, 120, "only one opening, four real narrations and 115 text replies; no blank residual messages");
      assert.equal(visible.find((m) => m.type === "narration").vts, start);
      assert.equal(visible[0].isReplyHeader, true, "opening must be the first visible reply");
      assert.equal(visible.filter((m) => m.isReplyHeader).length, 1);
      assert.equal(visible.filter((m) => m.isSceneTimeHeader).length, 0);
      assert.deepEqual(visible.filter((m) => m.type === "narration").map((m) => m.vts), [start, start, start + 4 * 60000, start + 37 * 60000, start + 57 * 60000]);
      const badges = await page.locator("#chat-messages .narration-timestamp").allTextContents();
      assert.deepEqual(badges, ["07:20", "07:20", "07:24", "07:57", "08:17"]);
      assert.equal(await page.locator("#chat-messages .narration-bubble").filter({ hasText: "地点：" }).count(), 1);
      const firstText = visible.find((m) => m.content === "短句0。");
      assert.equal(await page.locator(`.message-bubble[data-timestamp="${firstText.timestamp}"]`).locator("..").locator(".timestamp").innerText(), "07:20");
      if (id === "scene-watch") {
        await page.locator("#chat-messages .narration-timestamp").last().scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-quiet-time-v1792.png") });
      }
      for (const [i, minutes] of [[0, 0], [12, 4], [57, 37], [95, 57], [114, 57]])
        assert.equal(visible.find((m) => m.content === `短句${i}。`).vts, start + minutes * 60000);
      assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs("scene-other")), start + 57 * 60000);
      const writes = await page.evaluate(() => window.__sceneWrites);
      assert.ok(writes.filter((m) => /^短句/.test(m.content)).every((m) => m.vts === m.now), "live clock follows each displayed scene, not the future end of the response");
    }
    const oldRows = await page.evaluate(async () => {
      const chat = await window.db.chats.get("scene-watch"), stamp = Date.now() + 10000;
      const rows = [
        { role: "assistant", type: "text", senderName: "林", content: "", timestamp: stamp, vts: chat.history[0].vts },
        { role: "assistant", type: "text", senderName: "林", content: "\u200b\ufeff", timestamp: stamp + 1, vts: chat.history[0].vts },
        { role: "assistant", type: "narration", content: "<span>&nbsp;<br></span>", timestamp: stamp + 2, vts: chat.history[0].vts },
        { role: "assistant", type: "text", senderName: "林", content: "", message: "旧记录兼容字段的实际正文。", timestamp: stamp + 3, vts: chat.history[0].vts },
      ];
      chat.history.push(...rows); await window.db.chats.put(chat); await window.refreshPersonaSpaceData();
      return rows;
    });
    await open("scene-watch");
    for (const row of oldRows.slice(0, 3)) assert.equal(await page.locator(`#chat-messages [data-timestamp="${row.timestamp}"]`).count(), 0, "old empty rows are not rendered");
    assert.ok(await page.locator("#chat-messages").textContent().then((text) => text.includes("旧记录兼容字段的实际正文。")));
    assert.ok(await page.evaluate((stamp) => window.db.chats.get("scene-watch").then((chat) => chat.history.some((m) => m.timestamp === stamp)), oldRows[0].timestamp), "render filtering cannot delete history");
    await open("scene-watch"); response = [{ type: "narration", content: "下一轮开场。" }, { type: "narration", content: "又交谈了一会。", scene_elapsed_minutes: 6, scene_time_reason: "继续交谈", scene_phase: "elapsed" }, { type: "text", name: "林", content: "下一轮继续。" }];
    await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.match(calls.at(-1).messages[0].content, /2026-03-05 08:18 周四/);
    assert.match(JSON.stringify(calls.at(-1).messages.slice(1)), /07:57/);
    assert.match(JSON.stringify(calls.at(-1).messages.slice(1)), /08:17/);
    assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), start + 64 * 60000, "next reply gets its automatic opening increment plus the scene's six minutes");
    const twoRounds = await page.evaluate(() => window.db.chats.get("scene-watch"));
    assert.equal(twoRounds.history.filter((m) => m.isReplyHeader).length, 2, "every round gets its own single opening header");
    // A provider that completely ignores the custom scene fields must still
    // move time in this exact production quiet-timeline path, in every mode.
    for (const id of ["scene-watch", "scene-normal", "scene-private", "scene-offline"]) {
      await open(id); await jump(start);
      const previousLength = await page.evaluate((id) => window.db.chats.get(id).then((chat) => chat.history.length), id);
      response = [
        { type: "narration", content: "他坐在餐桌旁。" }, { type: "text", name: "林", content: "先吃早饭吧。" },
        { type: "narration", content: "两人吃完早餐，收拾好餐桌。" }, { type: "text", name: "林", content: "吃好了。" },
        { type: "narration", content: "他洗漱完毕，擦干了脸。" }, { type: "text", name: "林", content: "马上来。" },
        { type: "narration", content: "他换好衣服，拿上书包。" }, { type: "text", name: "林", content: "走吧。" },
        { type: "narration", content: "过了十分钟，车停在学校门口。" }, { type: "text", name: "林", content: "到了，开始上课。" },
      ];
      const button = page.locator(id === "scene-watch" ? "#spectator-propel-btn" : "#wait-reply-btn"), before = calls.length;
      await button.click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      assert.equal(calls.length, before + 1, "fallback adds zero auxiliary/repair requests");
      const saved = await page.evaluate((id) => window.db.chats.get(id), id), rows = saved.history.slice(previousLength);
      assert.equal(rows.filter((item) => item.isReplyHeader).length, 1);
      assert.equal(rows.find((item) => item.isReplyHeader).vts, start, "manual opening remains exactly 07:20");
      assert.equal(rows.find((item) => item.content === "两人吃完早餐，收拾好餐桌。").vts, start + 15 * 60000);
      assert.equal(rows.find((item) => item.content === "他洗漱完毕，擦干了脸。").vts, start + 21 * 60000);
      assert.equal(rows.find((item) => item.content === "他换好衣服，拿上书包。").vts, start + 24 * 60000);
      assert.equal(rows.at(-1).vts, start + 34 * 60000);
      assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), start + 34 * 60000);
      assert.equal(await page.locator("#chat-messages .narration-timestamp").last().innerText(), "07:54", "fallback changes actual narration corner timestamps");
      response = [{ type: "text", name: "林", content: "接着刚才的话题继续。" }, { type: "text", name: "林", content: "现在开始上课了。" }];
      const beforeNext = calls.length; await button.click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      assert.equal(calls.length, beforeNext + 1);
      assert.match(calls.at(-1).messages[0].content, /2026-03-05 07:55 周四/, "next main request receives automatically advanced latest clock");
      const next = await page.evaluate((id) => window.db.chats.get(id), id);
      assert.equal(next.history.findLast((item) => item.isReplyHeader).vts, start + 35 * 60000);
      assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), start + 35 * 60000);
    }
    await open("scene-watch");
    // Exercise the real picker repeatedly; it must reflect the latest clock,
    // not retain the previous draft or the model's former absolute date.
    for (const value of ["2026-03-05T10:30", "2026-03-05T11:45"]) {
      await page.locator('[data-spectator-action="time"]').click();
      await page.locator("#time-machine-datetime").fill(value);
      await page.locator("#time-machine-confirm").click();
      response = [{ type: "narration", content: "2026年3月5日，07点20分，星期四，地点：家" }, { type: "narration", content: "这一轮开始。" }, { type: "narration", content: "2026年3月5日，07点24分，星期四，地点：家。聊完一段话。" }];
      await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      const expected = new Date(value).getTime() + 4 * 60000;
      assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), expected);
      await page.locator('[data-spectator-action="time"]').click();
      assert.equal(await page.locator("#time-machine-datetime").inputValue(), value.slice(0, 14) + String(Number(value.slice(14)) + 4).padStart(2, "0"));
      await page.locator("#time-machine-cancel").click();
    }
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
    assert.equal(overnight.history.findLast((m) => m.content === "正文不能丢失。").vts, new Date(2026, 2, 6, 0, 11).getTime());
    assert.equal(await page.locator(".narration-timestamp").last().innerText(), "00:11");
    assert.equal(overnight.history.at(-1).content, "今天星期五，明天星期六。");
    assert.ok(overnight.history.some((m) => m.content === "正文不能丢失。"));
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await open("scene-normal");
    assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), new Date(2026, 2, 6, 0, 11).getTime());
    failure = true; await jump(start);
    await page.locator("#wait-reply-btn").click();
    await page.waitForFunction(() => document.getElementById("custom-modal-overlay")?.textContent.includes("503"));
    await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.equal(await page.evaluate(async () => (await window.db.spaceClock.get("main")).holdNextReply), true);
    failure = false; response = [{ type: "text", name: "林", content: "这一轮成功了。" }];
    await page.locator("#wait-reply-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), start);
    failure = true; await page.locator("#wait-reply-btn").click();
    await page.waitForFunction(() => document.getElementById("custom-modal-overlay")?.textContent.includes("503"));
    await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), start, "failed automatic next round restores last successfully displayed clock");
    assert.equal(await page.evaluate(async () => (await window.db.spaceClock.get("main")).holdNextReply), false);
    assert.deepEqual(errors, []);
    console.log("PASS: actual mobile watch/normal/private/offline 115-message replies save per-scene time with one primary call, synchronized live clock, exact manual start, Stop, midnight/body/weekday, reload and failure retry hold");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
