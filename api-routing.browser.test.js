const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core"), { dailyReply } = require("./browser-test-fixtures.js");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname), file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const requests = [], errors = []; let failAuxiliary = false;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      const native = url.startsWith("https://generativelanguage.googleapis.com/");
      if (!native && !url.startsWith("https://route-primary.invalid/") && !url.startsWith("https://route-auxiliary.invalid/")) return route.abort(); // Fake providers only.
      const body = route.request().postDataJSON(), prompt = native ? body.contents[0].parts[0].text : body.messages[0].content;
      const primary = url.startsWith("https://route-primary.invalid/"); requests.push({ primary, native, prompt, model: body.model });
      if (native) {
        assert.ok(url.includes("native-aux-model")); assert.equal(new URL(url).searchParams.get("key"), "fake-native-key");
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"result":"native auxiliary success"}' }] }, finishReason: "STOP" }] }) });
      }
      assert.equal(body.model, primary ? "reply-model" : "aux-model");
      assert.equal(route.request().headers().authorization, primary ? "Bearer fake-primary" : "Bearer fake-auxiliary");
      if (!primary && failAuxiliary) return route.fulfill({ status: 503, body: "isolated auxiliary failure" });
      let raw;
      if (primary) raw = [{ type: "narration", content: "2026年3月5日，10点00分，星期四，地点：办公室" }, { type: "text", name: "林", content: "记得我们之前的完整经历。" }];
      else if (prompt.includes("独立生活当天行程规划师")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(dailyReply(prompt)) });
      else if (prompt.includes("待总结的对话历史")) raw = { summary: "我记得这段完整对话里约定的事情，这是新增总结，不覆盖旧记忆。" };
      else raw = { result: "auxiliary success" };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: "stop" }] }) });
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main") || { id: "main" }; await window.db.apiConfig.put({ ...config, proxyUrl: "https://route-primary.invalid/v1", apiKey: "fake-primary", model: "reply-model", secondaryProxyUrl: "https://route-auxiliary.invalid/v1", secondaryApiKey: "fake-auxiliary", secondaryModel: "aux-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "routing-role", originalName: "林", groupNickname: "林", persona: "成年人，普通家庭，有自己的工作。", avatar };
      const memory = { content: "不能删除的完整记忆标记", timestamp: 3, vts: new Date(2026, 2, 4, 10).getTime() };
      const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "第" + i + "条重要经历", timestamp: 100 + i, vts: new Date(2026, 2, 5, 9, i).getTime() }));
      await window.db.chats.put({ id: member.id, name: "林", originalName: "林", avatar, settings: { aiPersona: member.persona, aiAvatar: avatar, maxMemory: 30 }, history, longTermMemory: [memory, structuredClone(memory), { ...memory, vts: memory.vts + 1000 }] });
      for (const [id, watch] of [["routing-watch", true], ["routing-group", false]]) await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: watch, members: [member], settings: { myNickname: "我", maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [] });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function chat(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click(); await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active");
    }
    await chat("routing-watch"); await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    await page.waitForFunction(() => !window.EPhoneCharacterDaily.isBusy());
    assert.ok(requests.some((r) => !r.primary && r.prompt.includes("独立生活当天行程规划师")), "cross-day generation uses auxiliary API");
    await page.evaluate(() => { if (document.querySelector("#daily-schedule-status")) document.querySelector("#daily-schedule-status").hidden = true; });
    for (const id of ["routing-watch", "routing-group", "routing-role"]) {
      await chat(id); const before = requests.length; await page.locator(id === "routing-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      assert.equal(requests.length - before, 1); assert.equal(requests.at(-1).primary, true); assert.match(requests.at(-1).prompt, /不能删除的完整记忆标记/);
      assert.equal((requests.at(-1).prompt.match(/不能删除的完整记忆标记/g) || []).length, 2, "only the exact duplicate is removed; dated variant remains");
    }
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("routing-role")).longTermMemory.length), 3, "dedupe never deletes stored memories");
    const manual = await page.evaluate(() => window.EPhoneMarketAdapter.generate("辅助任务固定测试")); assert.match(manual, /auxiliary success/); assert.equal(requests.at(-1).primary, false);
    // Exercise the actual chat-settings summary button and its range, not a mock summarizer.
    await page.locator("#chat-settings-btn").click(); await page.waitForSelector("#chat-settings-screen.active");
    await page.locator("#chat-summary-range-start").fill("1"); const historyCount = await page.evaluate(async () => (await window.db.chats.get("routing-role")).history.length);
    await page.locator("#chat-summary-range-end").fill(String(historyCount)); await page.locator("#chat-settings-summarize-btn").click();
    await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click();
    await page.waitForFunction(async () => (await window.db.chats.get("routing-role")).longTermMemory.length === 4);
    assert.equal(requests.at(-1).primary, false); assert.match(requests.at(-1).prompt, /待总结的对话历史/);
    await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click(); await page.waitForFunction(() => !document.querySelector("#chat-settings-summarize-btn").disabled);
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("routing-role")).lastMemorySummaryIndex), historyCount);
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("routing-role")).history.length), historyCount);
    // An auxiliary HTTP failure cannot spend on the primary API as a fallback.
    failAuxiliary = true; const beforeFailure = requests.length;
    assert.match(await page.evaluate(() => window.EPhoneMarketAdapter.generate("失败测试").catch((e) => e.message)), /503/);
    assert.equal(requests.length - beforeFailure, 1); assert.equal(requests.at(-1).primary, false); failAuxiliary = false;
    await page.evaluate(() => window.showScreen("api-settings-screen"));
    await page.locator("#secondary-api-key").fill(""); await page.waitForFunction(async () => !(await window.db.apiConfig.get("main")).secondaryApiKey);
    const beforeMissing = requests.length; assert.match(await page.evaluate(() => window.EPhoneMarketAdapter.generate("缺少副API").catch((e) => e.message)), /本次不会改用主 API/); assert.equal(requests.length, beforeMissing);
    await chat("routing-role"); await page.locator("#wait-reply-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy()); assert.equal(requests.at(-1).primary, true, "same-day replies still work without auxiliary API");
    // Native Gemini auxiliary stays independent of the compatible primary connection.
    await page.evaluate(() => window.showScreen("api-settings-screen")); await page.locator("#secondary-proxy-url").fill("https://generativelanguage.googleapis.com/v1beta/models"); await page.locator("#secondary-api-key").fill("fake-native-key");
    await page.evaluate(() => { const select = document.getElementById("secondary-model-select"); select.append(new Option("native-aux-model", "native-aux-model")); });
    await page.locator("#secondary-model-select").selectOption("native-aux-model"); await page.waitForFunction(async () => (await window.db.apiConfig.get("main")).secondaryModel === "native-aux-model");
    assert.match(await page.evaluate(() => window.EPhoneMarketAdapter.generate("原生副API测试")), /native auxiliary success/); assert.equal(requests.at(-1).native, true);
    assert.deepEqual(errors, []);
    console.log("PASS: actual watch/normal/private replies use primary; daily plans, adapter and real range-summary use auxiliary URL/key/model; stored complete memories/history unchanged; missing/failing auxiliary never calls primary; compatible/native Gemini separation");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
