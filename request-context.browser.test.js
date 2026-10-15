const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core"), { dailyReply } = require("./browser-test-fixtures.js"), context = require("./request-context.js");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname), file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const requests = [], errors = []; let reportUsage = true, shortReply = false;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      const native = url.startsWith("https://generativelanguage.googleapis.com/");
      if (!native && !url.startsWith("https://context-main.invalid/") && !url.startsWith("https://context-aux.invalid/")) return route.abort();
      const body = route.request().postDataJSON(), prompt = native ? body.contents[0].parts[0].text : body.messages[0].content;
      if (prompt.includes("独立生活当天行程规划师")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(dailyReply(prompt)) });
      if (url.startsWith("https://context-aux.invalid/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }) });
      requests.push(body);
      const raw = JSON.stringify([{ type: "narration", content: "2026年3月5日，10点00分，星期四，地点：办公室" }, ...(!shortReply ? [{ type: "text", name: "林老师", content: "继续按我们原来的完整记忆交流。" }] : [])]); shortReply = false;
      const usage = reportUsage ? { prompt_tokens: 51234, completion_tokens: 123, prompt_tokens_details: { cached_tokens: 20000 } } : undefined;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(native ? { candidates: [{ content: { parts: [{ text: raw }] }, finishReason: "STOP" }], usageMetadata: reportUsage ? { promptTokenCount: 34567, candidatesTokenCount: 100 } : undefined } : { choices: [{ message: { content: raw }, finish_reason: "stop" }], usage }) });
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main") || { id: "main" }; await window.db.apiConfig.put({ ...config, proxyUrl: "https://context-main.invalid/v1", apiKey: "fake-main", model: "reply-model", secondaryProxyUrl: "https://context-aux.invalid/v1", secondaryApiKey: "fake-aux", secondaryModel: "aux-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "context-role", originalName: "林老师", groupNickname: "林老师", persona: "成年人，普通家庭，教师。", avatar };
      await window.db.chats.put({ id: member.id, name: member.originalName, originalName: member.originalName, avatar, settings: { aiPersona: member.persona, aiAvatar: avatar, maxMemory: 30 }, history: [{ role: "user", content: "联系01约过我们见面。完整聊天原文。", timestamp: 100, vts: new Date(2026, 2, 5, 9).getTime() }], longTermMemory: [{ content: "必须完整保留的总结记忆", timestamp: 10 }] });
      for (const [id, watch] of [["context-watch", true], ["context-group", false]]) await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: watch, members: [member], settings: { myNickname: "我", maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [] });
      for (let i = 1; i <= 30; i++) {
        await window.db.npcs.put({ id: i, name: "联系" + String(i).padStart(2, "0"), persona: "OFFSCREEN_PROFILE_" + i + "_" + "完整NPC人设。".repeat(250) + "完整尾部" });
        await window.db.characterRelations.put({ id: "relation" + i, a: "chat:context-role", b: "npc:" + i, aToB: "同事", bToA: "同事", source: "manual", detail: "共同工作", evidence: [{ quote: "DO_NOT_SEND_RAW_EVIDENCE".repeat(50) }] });
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function chat(id) { await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click(); await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active"); }
    await chat("context-watch"); await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    await page.evaluate(() => { if (document.querySelector("#daily-schedule-status")) document.querySelector("#daily-schedule-status").hidden = true; });
    for (const id of ["context-watch", "context-group", "context-role"]) {
      await chat(id); const before = requests.length; await page.locator(id === "context-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy()); assert.equal(requests.length, before + 1);
      const payload = requests.at(-1), stats = await page.evaluate((id) => window.db.spaceProfiles.get("context-usage:" + id), id);
      assert.equal(stats.inputTokens, 51234); assert.equal(stats.cachedInputTokens, 20000); assert.equal(stats.estimatedInputTokens, context.inspect(payload).estimatedInputTokens); assert.equal(stats.textChars, context.inspect(payload).textChars);
      assert.match(payload.messages[0].content, /必须完整保留的总结记忆/); assert.doesNotMatch(JSON.stringify(payload), /OFFSCREEN_PROFILE_30_|DO_NOT_SEND_RAW_EVIDENCE/); assert.match(payload.messages[0].content, /联系30/);
      if (id === "context-role") { assert.match(payload.messages[0].content, /OFFSCREEN_PROFILE_1_/); assert.match(payload.messages[0].content, /完整尾部/); }
      assert.doesNotMatch(JSON.stringify(stats), /必须完整保留|fake-main|完整NPC|chat\/completions/);
      await page.locator("#chat-settings-btn").click(); await page.waitForSelector("#chat-settings-screen.active");
      await page.waitForFunction(() => document.getElementById("request-context-actual").textContent.includes("51,234"));
      assert.match(await page.locator("#request-context-details").innerText(), /系统规则|关系与当天生活/); assert.match(await page.locator("#request-context-details").innerText(), /不要再相加/);
      assert.match(await page.locator("#token-count-value").innerText(), /Tokens/);
      if (id === "context-role") { await page.locator("#request-context-details").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-context-v174.png") }); }
    }
    // A summary/helper request cannot overwrite the main reply's usage.
    const beforeAux = await page.evaluate(() => window.db.spaceProfiles.get("context-usage:context-role"));
    await page.evaluate(() => window.EPhoneMarketAdapter.generate("辅助任务")); assert.deepEqual(await page.evaluate(() => window.db.spaceProfiles.get("context-usage:context-role")), beforeAux);
    // Missing usage clears old provider totals; an automatic recovery is marked.
    reportUsage = false; shortReply = true; await chat("context-watch"); const beforeRetry = requests.length;
    await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.equal(requests.length, beforeRetry + 2); const retryStats = await page.evaluate(() => window.db.spaceProfiles.get("context-usage:context-watch")); assert.equal(retryStats.attempt, 2); assert.equal(retryStats.inputTokens, null);
    await page.locator("#chat-settings-btn").click(); await page.waitForSelector("#chat-settings-screen.active"); await page.waitForFunction(() => document.getElementById("request-context-actual").textContent.includes("未返回")); assert.match(await page.locator("#request-context-details").innerText(), /本轮发生补发/);
    reportUsage = true;
    // Real native Gemini reply path is counted from its final contents/parts.
    await page.evaluate(async () => { await window.db.apiConfig.update("main", { proxyUrl: "https://generativelanguage.googleapis.com/v1beta/models", apiKey: "fake-native-key", model: "native-model" }); });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await chat("context-role"); await page.locator("#wait-reply-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    const nativeStats = await page.evaluate(() => window.db.spaceProfiles.get("context-usage:context-role")); assert.equal(nativeStats.inputTokens, 34567); assert.equal(nativeStats.textChars, context.inspect(requests.at(-1)).textChars); assert.equal(nativeStats.model, "native-model");
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); assert.equal((await page.evaluate(() => window.db.spaceProfiles.get("context-usage:context-role"))).inputTokens, 34567);
    const memories = await page.evaluate(async () => (await window.db.chats.get("context-role")).longTermMemory); assert.equal(memories.length, 1); assert.equal(memories[0].content, "必须完整保留的总结记忆");
    await page.evaluate(async () => { const spaces = JSON.parse(localStorage.getItem("ephone-persona-spaces-v1")); localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([...spaces, { id: "context-other", name: "另一空间" }])); await window.EPhoneSpaces.switchSpace("context-other"); });
    assert.equal(await page.evaluate(() => window.db.spaceProfiles.get("context-usage:context-role")), undefined);
    assert.deepEqual(errors, []);
    console.log("PASS: actual watch/group/private/native reply payload and reported usage, unrelated profile/evidence exclusion, complete selected profiles/memories, settings UI, missing usage/recovery, auxiliary isolation, reload and space isolation");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
