// Isolated mobile navigation with held fake replies. No real API or user data.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core"), { dailyReply } = require("./browser-test-fixtures.js");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const calls = [], errors = [], aborted = [];
  const header = { type: "narration", content: "2026年3月5日，10点00分，星期四，地点：客厅" };
  const content = (text) => ({ type: "text", name: "甲", content: text });
  const result = (items) => ({ choices: [{ message: { content: JSON.stringify([header, ...items]) }, finish_reason: "stop" }] });
  let serial = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("requestfailed", (request) => { if (request.url().startsWith("https://navigation-reply.invalid/")) aborted.push(request.failure()?.errorText); });
    await page.addInitScript(() => {
      const timeout = window.setTimeout.bind(window);
      window.__replyNavigationSlowPlayback = false;
      // Keep real async boundaries, with controlled visible playback windows.
      window.setTimeout = (callback, ms, ...args) => timeout(callback, ms >= 500 && ms <= 3000 ? window.__replyNavigationSlowPlayback ? 220 : 8 : ms, ...args);
    });
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://navigation-reply.invalid/")) {
        const body = route.request().postDataJSON(), daily = dailyReply(body.messages?.[0]?.content || "");
        if (daily) return route.fulfill({ contentType: "application/json", body: JSON.stringify(daily) });
        calls.push({ route, body }); return; // Every reply stays held until this test releases it.
      }
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://navigation-reply.invalid/v1", apiKey: "fake-main", model: "navigation-reply", secondaryProxyUrl: "https://navigation-reply.invalid/aux", secondaryApiKey: "fake-aux", secondaryModel: "auxiliary-only" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "nav-private", originalName: "甲", groupNickname: "甲", persona: "甲是成年人，喜欢读书，正在客厅休息。", avatar };
      await window.db.chats.put({ id: member.id, originalName: "甲", name: "甲", avatar, settings: { aiPersona: member.persona, aiAvatar: avatar, maxMemory: 30 }, history: [{ role: "user", content: "请继续。", timestamp: 1 }] });
      for (const [id, spectator] of [["nav-watch", true], ["nav-group", false], ["nav-other-watch", true], ["nav-other-group", false]]) {
        await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: spectator, members: [member], settings: { maxMemory: 30, myNickname: "我", linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [{ role: "user", content: "请继续。", timestamp: 1 }] });
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    const selector = (id) => id.includes("watch") ? "#spectator-propel-btn" : "#wait-reply-btn";
    async function open(id) {
      if (await page.locator("#chat-interface-screen.active").count()) {
        await page.locator("#back-to-list-btn").click();
        await page.waitForSelector("#chat-list-screen.active");
      } else await page.evaluate(() => window.showScreen("chat-list-screen"));
      await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click();
      await page.waitForSelector("#chat-interface-screen.active");
    }
    async function until(test, message) {
      const deadline = Date.now() + 15000;
      while (!test()) { assert.ok(Date.now() < deadline, message); await page.waitForTimeout(15); }
    }
    async function state(id, expected) {
      try { await page.waitForFunction(({ selector, state }) => document.querySelector(selector)?.dataset.replyState === state, { selector: selector(id), state: expected }, { timeout: 8000 }); }
      catch (error) {
        const actual = await page.locator(selector(id)).evaluate((button) => ({ dataset: { ...button.dataset }, disabled: button.disabled, label: button.getAttribute("aria-label"), html: button.innerHTML }));
        throw new Error(id + ": expected " + expected + ", actual " + JSON.stringify(actual), { cause: error });
      }
      const button = page.locator(selector(id));
      if (expected === "running") {
        assert.equal(await button.isDisabled(), false, id + ": own active reply remains stoppable");
        assert.equal(await button.getAttribute("aria-pressed"), "true"); assert.equal(await button.getAttribute("aria-label"), "停止回复");
        assert.equal(await button.locator(".ephone-generating-bars").count(), 1);
        if (id.includes("watch")) assert.equal(await page.locator(".ephone-spectator-controls").evaluate((el) => [...el.querySelectorAll("button, textarea")].every((field) => field.id === "spectator-propel-btn" || field.disabled)), true, "rebuilt watch controls stay locked except stop");
      } else if (expected === "blocked") {
        assert.equal(await button.isDisabled(), true, id + ": another chat cannot start or stop the pending request");
        assert.match(await button.getAttribute("aria-label"), /其他聊天正在回复/);
      } else if (expected === "idle") {
        assert.equal(await button.getAttribute("aria-pressed"), "false"); assert.equal(await button.locator(".ephone-generating-bars").count(), 0);
        if (id.includes("watch")) assert.equal(await page.locator('[data-spectator-action="identity"]').isDisabled(), false, "completed watch controls unlock their identity chooser");
      }
    }
    async function start(id) {
      const before = calls.length; await page.locator(selector(id)).click(); await until(() => calls.length > before, id + ": request should begin");
      assert.equal(calls.length, before + 1); return calls[before];
    }
    const release = (item, body, status = 200) => item.route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
    const history = (id) => page.evaluate(async (id) => (await window.db.chats.get(id)).history, id);
    for (const id of ["nav-watch", "nav-group", "nav-private"]) {
      const other = id === "nav-watch" ? "nav-other-group" : "nav-other-watch";
      await open(id);
      if (id === "nav-watch") await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
      const beforeStop = await history(id), stopRequest = await start(id);
      // Genuine back navigation rebuilds the watch toolbar; it must restore a
      // running state, rather than exposing a second idle request button.
      await open(id); await state(id, "running");
      if (id === "nav-watch") await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-reply-navigation-running.png") });
      await open(other); await state(other, "blocked");
      assert.equal((await page.locator("#chat-header-title").innerText()).trim(), other, "a pending reply does not replace another chat's title");
      const count = calls.length;
      await page.locator(selector(other)).evaluate((button) => button.click());
      assert.equal(calls.length, count); assert.equal(await page.evaluate(() => window.isEPhoneTimeChangeBusy()), true);
      await open(id); await state(id, "running"); await page.locator(selector(id)).click();
      await page.waitForFunction(() => !window.isEPhoneTimeChangeBusy()); await state(id, "idle");
      assert.equal(calls.length, count, "returning and pressing stop must not request another response");
      await release(stopRequest, result([content("这条已被停止，不能保存。") ]));
      assert.deepEqual(await history(id), beforeStop, "stopping a pending network reply adds no late messages");
      // Completion while away must save to its original conversation and leave
      // the other conversation's button/messages alone.
      const request = await start(id), unique = `后台完成-${id}-${++serial}`;
      await open(other); await state(other, "blocked");
      const otherHistory = await history(other);
      await release(request, result([content(unique)])); await page.waitForFunction(() => !window.isEPhoneTimeChangeBusy()); await state(other, "idle");
      assert.equal((await page.locator("#chat-header-title").innerText()).trim(), other, "background completion leaves the other chat's title intact");
      assert.equal(calls.length, count + 1); assert.deepEqual(await history(other), otherHistory);
      assert.equal((await page.locator("#chat-messages").textContent()).includes(unique), false, "a background reply never renders inside another chat");
      await open(id); await state(id, "idle");
      assert.ok((await history(id)).some((message) => message.content === unique));
      assert.ok((await page.locator("#chat-messages").textContent()).includes(unique));
      // The provider has returned, but playback is still in progress. Returning
      // must still expose stop until every received item has finished playing.
      const marker = `播放-${id}-${++serial}`;
      await page.evaluate(() => { window.__replyNavigationSlowPlayback = true; });
      const playingRequest = await start(id);
      await release(playingRequest, result(Array.from({ length: 30 }, (_, index) => content(marker + "-" + index))));
      await page.waitForFunction((marker) => document.querySelector("#chat-messages")?.textContent.includes(marker), marker);
      await open(id); await state(id, "running");
      await page.locator(selector(id)).click(); await page.waitForFunction(() => !window.isEPhoneTimeChangeBusy()); await state(id, "idle");
      const playingHistory = await history(id);
      assert.ok(playingHistory.some((message) => message.content?.startsWith(marker)), "already played messages remain saved");
      assert.ok(playingHistory.filter((message) => message.content?.startsWith(marker)).length < 30, "stop interrupts an ongoing received-response playback");
      await page.evaluate(() => { window.__replyNavigationSlowPlayback = false; });
      // HTTP errors after re-entry are visible and clean up the same state.
      const failure = await start(id); await open(id); await state(id, "running");
      await release(failure, { error: { message: "isolated navigation failure" } }, 500);
      await page.waitForFunction(() => document.querySelector("#custom-modal-overlay.visible")?.textContent.includes("isolated navigation failure"));
      await page.locator("#custom-modal-overlay button").last().click();
      await page.waitForFunction(() => !window.isEPhoneTimeChangeBusy()); await state(id, "idle");
      await open(id); await state(id, "idle");
    }
    assert.equal(calls.length, 12, "three modes each make exactly four deliberate requests; no navigation retries");
    assert.ok(aborted.length >= 3, "the actual pending fetch is aborted in every reply mode");
    assert.deepEqual(errors, []);
    console.log("PASS: mobile watch/normal/private reply buttons persist across real back/re-entry, owner-scoped blocked/stop state, pending-fetch abort, background completion, playback stop and failure cleanup with one API request per reply");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
