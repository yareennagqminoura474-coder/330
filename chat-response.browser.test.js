const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
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
  const calls = [], errors = []; let fixtures = [], holdRecovery = false, heldRoute;
  const header = { type: "narration", content: "2026年3月5日，07点20分，星期四，地点：客厅" };
  const reply = (content) => ({ type: "text", name: "林", content });
  const openai = (raw, finish_reason = "stop") => ({ choices: [{ message: { content: raw }, finish_reason }] });
  const json = (items) => JSON.stringify(items);
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://reply-test.invalid/") || url.startsWith("https://generativelanguage.googleapis.com/")) {
        const body = route.request().postDataJSON(), daily = require("./browser-test-fixtures.js").dailyReply(body.messages?.[0]?.content || "");
        if (daily) return route.fulfill({ contentType: "application/json", body: JSON.stringify(daily) });
        calls.push(body);
        if (holdRecovery && calls.at(-1).messages?.at(-1)?.content.includes("本轮回复完整性修复")) { heldRoute = route; return; }
        const fixture = fixtures.shift();
        if (!fixture) return route.fulfill({ status: 500, body: "Missing isolated test fixture" });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture) });
      }
      return route.abort(); // No real provider calls or user data.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main") || { id: "main" };
      await window.db.apiConfig.put({ ...config, proxyUrl: "https://reply-test.invalid/v1", apiKey: "test-placeholder", model: "test-model", secondaryProxyUrl: "https://reply-test.invalid/v1", secondaryApiKey: "test-aux-placeholder", secondaryModel: "auxiliary-test-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "reply-person", originalName: "林", groupNickname: "林", persona: "爱好书法。", avatar };
      await window.db.chats.put({ id: member.id, name: "林", originalName: "林", isGroup: false, avatar, settings: { aiPersona: member.persona, aiAvatar: avatar, maxMemory: 20 }, history: [{ role: "user", content: "继续", timestamp: 100 }] });
      for (const [id, watch] of [["reply-watch", true], ["reply-standard", false]]) {
        await window.db.chats.put({ id, name: id, isGroup: true, isSpectatorGroup: watch, avatar, members: [member],
          settings: { maxMemory: 20, myNickname: "我", linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [{ role: "user", content: "继续", timestamp: 100 }] });
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function openChat(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen"));
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click();
      await page.waitForSelector("#chat-interface-screen.active");
    }
    async function generate(id, responses) {
      await openChat(id); fixtures = [...responses]; const before = calls.length;
      await page.locator(id === "reply-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      assert.equal(fixtures.length, 0); return calls.slice(before);
    }
    const morning = new Date(2026, 2, 5, 7, 20).getTime();
    await openChat("reply-watch"); await page.evaluate((time) => window.ephoneTimeMachine.jumpTo(time, "frozen"), morning);
    const multipart = json([header, reply("多段回复的正文没有丢失。")]);
    await generate("reply-watch", [{ candidates: [{ content: { parts: [{ thought: true, text: "不展示的思考" }, { text: multipart.slice(0, 40) }, { text: multipart.slice(40) }] }, finishReason: "STOP" }] }]);
    assert.ok(await page.evaluate(async () => (await window.db.chats.get("reply-watch")).history.some((item) => item.content === "多段回复的正文没有丢失。")));
    for (const id of ["reply-person", "reply-standard", "reply-watch"]) {
      await openChat(id); await page.evaluate((time) => window.ephoneTimeMachine.jumpTo(time, "frozen"), morning);
      const countBefore = await page.evaluate(async (id) => (await window.db.chats.get(id)).history.length, id);
      const requests = await generate(id, [openai(json([header]) + ', {"type":"transfer","amount":999'), openai(json([header, reply("自动恢复后的完整正文。")]))]);
      assert.equal(requests.length, 2, id);
      assert.equal(requests[0].messages[0].content, requests[1].messages[0].content, "Recovery uses exactly the same prepared clock/context");
      assert.match(requests[1].messages.at(-1).content, /本轮回复完整性修复/);
      const added = await page.evaluate(async ({ id, countBefore }) => (await window.db.chats.get(id)).history.slice(countBefore), { id, countBefore });
      assert.equal(added.filter((item) => item.type === "narration" && /2026年3月5日/.test(item.content)).length, 1, id + ": no duplicate time header");
      assert.equal(added.filter((item) => item.content === "自动恢复后的完整正文。").length, 1);
      assert.ok(added.every((item) => item.type !== "transfer"));
      assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), morning);
    }
    const fences = '```json\n' + json([header]) + '\n```\n```json\n' + json([reply("第二个格式块也保留。")]) + '\n```';
    await generate("reply-watch", [openai(fences)]);
    assert.ok(await page.evaluate(async () => (await window.db.chats.get("reply-watch")).history.some((item) => item.content === "第二个格式块也保留。")));
    await generate("reply-standard", [openai([{ type: "text", text: json([reply("数组格式的回复也保留。")]) }])]);
    assert.ok(await page.evaluate(async () => (await window.db.chats.get("reply-standard")).history.some((item) => item.content === "数组格式的回复也保留。")));
    // Two incomplete responses: show an honest error, preserve history and manual hold.
    await openChat("reply-watch"); await page.evaluate((time) => window.ephoneTimeMachine.jumpTo(time, "frozen"), morning);
    const historyBeforeFailure = await page.evaluate(async () => (await window.db.chats.get("reply-watch")).history);
    fixtures = [openai(json([header])), openai(json([header]))]; const beforeFailure = calls.length;
    await page.locator("#spectator-propel-btn").click();
    await page.waitForFunction(() => document.getElementById("custom-modal-overlay")?.textContent.includes("已自动重试一次"));
    assert.equal(calls.length - beforeFailure, 2);
    assert.deepEqual(await page.evaluate(async () => (await window.db.chats.get("reply-watch")).history), historyBeforeFailure);
    assert.equal(await page.evaluate(async () => (await window.db.spaceClock.get("main"))?.holdNextReply), true);
    await page.locator("#custom-modal-overlay button").last().click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    // Stop must still work while the second request is in flight.
    holdRecovery = true; fixtures = [openai(json([header]))];
    const beforeCancel = calls.length;
    await page.locator("#spectator-propel-btn").click();
    await page.waitForFunction(() => window.isPersonaSpaceBusy());
    await page.waitForFunction(() => document.querySelector("#spectator-propel-btn")?.classList.contains("is-generating") || window.isPersonaSpaceBusy());
    for (let i = 0; i < 100 && !heldRoute; i++) await page.waitForTimeout(50);
    assert.ok(heldRoute); assert.equal(calls.length - beforeCancel, 2);
    await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    await heldRoute.fulfill({ contentType: "application/json", body: JSON.stringify(openai(json([reply("停止后不应出现。")])) ) }).catch(() => {});
    assert.deepEqual(await page.evaluate(async () => (await window.db.chats.get("reply-watch")).history), historyBeforeFailure);
    holdRecovery = false;
    // The native Gemini route must rebuild contents for recovery too, rather
    // than accidentally retrying the unchanged first request body.
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main");
      await window.db.apiConfig.put({ ...config, proxyUrl: "https://generativelanguage.googleapis.com/v1beta/models", model: "test-gemini" });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    const gemini = (text, reason = "STOP") => ({ candidates: [{ content: { parts: [{ thought: true, text: "hidden thoughts" }, { text: text.slice(0, 20) }, { text: text.slice(20) }] }, finishReason: reason }] });
    for (const id of ["reply-person", "reply-standard", "reply-watch"]) {
      const requests = await generate(id, [gemini(json([header]), "MAX_TOKENS"), gemini(json([header, reply("原生接口自动恢复的正文。")]))]);
      assert.equal(requests.length, 2); assert.ok(requests[0].contents);
      assert.deepEqual(requests[0].contents[0], requests[1].contents[0]);
      assert.match(requests[1].contents.at(-1).parts[0].text, /本轮回复完整性修复/);
      assert.ok(await page.evaluate(async (id) => (await window.db.chats.get(id)).history.some((item) => item.content === "原生接口自动恢复的正文。"), id));
    }
    assert.deepEqual(errors, []);
    console.log("PASS: real mobile UI, all three modes on compatible and native Gemini routes, multipart thought filtering, complete-body recovery, unchanged clock, no duplicated header/partial transfer, all code fences/content arrays, bounded failure rollback, stop during retry");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
