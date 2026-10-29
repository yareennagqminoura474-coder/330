// Native NY presentation features in the real mobile app; providers are fake.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
const { dailyReply } = require("./browser-test-fixtures.js");
const openai = (text) => ({ choices: [{ message: { content: text }, finish_reason: "stop" }] });
const extra = { options: ["一起去散步", "留在家里喝茶", "询问明天的计划", "暂时安静地坐一会儿"], translation: { language: "英文", content: "The complete translated story remains available here." },
  title: "今日安排", panel_html: '<style>body{font:16px sans-serif;padding:12px}button{padding:14px}</style><p>今天可以出门散步。</p><button id="draft" onclick="STscript(\'/send 一起去散步\')">选择散步</button>' };
const source = { name: "NY native features test", prompts: [
  { identifier: "choices", name: "四个选项", content: "在正文结束后给出四个选项。" },
  { identifier: "translation", name: "英&汉双语", content: "完整中英双语。" },
  { identifier: "panel", name: "自由创建前端", content: "创建可互动的日程 HTML 网页。" },
  { identifier: "summary", name: "全篇总结", content: "总结全篇客观事实，保留人物关系。" }
], prompt_order: [{ character_id: 100000, order: ["choices", "translation", "panel", "summary"].map((identifier) => ({ identifier, enabled: true })) }] };

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname), file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, calls = [], errors = [], unexpected = [];
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  let auxText = "完整总结一：林与对方约好明天散步。", fail = false, hold = false, held = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message)); page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/*", async (route) => {
      const request = route.request(), url = request.url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      const primary = url.startsWith("https://ny-feature-main.invalid/"), auxiliary = url.startsWith("https://ny-feature-aux.invalid/");
      if (!primary && !auxiliary) { if (url.includes("should-not")) unexpected.push(url); return route.abort(); }
      const body = request.postDataJSON(), prompt = (body.messages || []).map((m) => m.content || "").join("\n"), daily = dailyReply(prompt);
      if (daily) return route.fulfill({ contentType: "application/json", body: JSON.stringify(daily) });
      calls.push({ primary, body, prompt, headers: request.headers() });
      if (auxiliary && hold) { held.push(route); return; }
      if (auxiliary && fail) return route.fulfill({ status: 503, body: "isolated summary failure" });
      const text = primary ? JSON.stringify([
        { type: "narration", content: "2026年3月5日，10点00分，星期四，地点：家中" },
        { type: "text", name: "林", content: "完整中文正文：我记得明天的约定，我们可以先坐下来喝杯茶。" },
        { type: "narration", content: "林放下茶杯，等着对方接话。", ny_extra: extra }
      ]) : JSON.stringify({ summary: auxText });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(openai(text)) });
    });
    async function ready() { await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady && window.EPhoneNYFeatures); }
    async function until(predicate, message) { const end = Date.now() + 20000; while (!await predicate()) { assert.ok(Date.now() < end, message); await page.waitForTimeout(25); } }
    async function row(id = "native-a") { return page.evaluate((chatId) => window.EPhoneNYFeatures.readSummary(chatId), id); }
    async function openChat(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active");
    }
    async function append(content, id = "native-a") { await page.evaluate(async ({ id, content }) => { const chat = await window.db.chats.get(id); chat.history.push({ role: "user", content, timestamp: Date.now() }); await window.db.chats.put(chat); }, { id, content }); }
    await ready();
    if (await page.locator("#update-notice-dismiss-btn").isVisible()) await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async (source) => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://ny-feature-main.invalid/v1", apiKey: "fake-feature-main", model: "feature-reply-model",
        secondaryProxyUrl: "https://ny-feature-aux.invalid/v1", secondaryApiKey: "fake-feature-aux", secondaryModel: "feature-summary-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "native-a", originalName: "林", groupNickname: "林", persona: "林是成年人，独立生活的教师。", avatar };
      await window.db.chats.put({ id: "native-a", name: "林", originalName: "林", avatar, settings: { aiPersona: member.persona, aiAvatar: avatar, maxMemory: 30, linkedWorldBookIds: [] },
        history: [{ role: "user", content: "ORIGINAL_HISTORY：约好明天出门。", timestamp: 100, vts: new Date(2026, 2, 5, 9).getTime() }], longTermMemory: [{ content: "EXISTING_MEMORY_UNCHANGED", timestamp: 1 }] });
      await window.db.chats.put({ id: "native-watch", name: "旁观讨论", avatar, isGroup: true, isSpectatorGroup: true, members: [member], settings: { myNickname: "我", maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [] });
      const pack = await window.EPhoneNY.importPreset(source, "native-features.json"); await window.EPhoneNY.configureDefaults({ enabled: true, packId: pack.id });
    }, source);
    await ready();
    for (const id of ["native-a", "native-watch"]) {
      await openChat(id);
      await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
      await page.evaluate(() => { const notice = document.getElementById("daily-schedule-status"); if (notice) notice.hidden = true; });
      const before = calls.length;
      await page.locator(id === "native-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click();
      await until(async () => (await row(id))?.content === auxText, "the completed reply schedules its enabled summary");
      await until(() => page.evaluate(() => !window.isPersonaSpaceBusy()), "reply and auxiliary summary finish");
      const added = calls.slice(before); assert.equal(added.filter((c) => c.primary).length, 1, "one main reply request");
      assert.equal(added.filter((c) => !c.primary).length, 1, "one enabled summary on auxiliary provider");
      assert.equal(added[1].body.model, "feature-summary-model"); assert.equal(added[1].headers.authorization, "Bearer fake-feature-aux");
      assert.match(added[0].prompt, /ny_extra/);
      if (id === "native-watch") assert.doesNotMatch(added[1].prompt, /ORIGINAL_HISTORY/, "each chat summarizes only its own source history");
      const history = await page.evaluate(async (chatId) => (await window.db.chats.get(chatId)).history, id);
      assert.ok(history.some((m) => m.content.includes("完整中文正文")), "all normal Chinese story remains persisted");
      assert.deepEqual(history.findLast((m) => m.nyFeatures)?.nyFeatures.options, extra.options, "the completed normal/watch round retains its extras");
      assert.equal((await row(id)).content, auxText); assert.equal((await row(id)).valid, true);
      await page.waitForSelector(".ny-reply-features");
      const beforeChoice = calls.length;
      await page.locator(".ny-reply-features button").first().click();
      const input = page.locator(id === "native-watch" ? ".ephone-spectator-compose textarea" : "#chat-input");
      assert.equal(await input.inputValue(), extra.options[0]); assert.equal(calls.length, beforeChoice, "choice only fills draft");
      await page.locator(".ny-reply-features summary").filter({ hasText: "英文版本" }).click();
      assert.equal(await page.locator(".ny-reply-features details").first().locator("div").textContent(), extra.translation.content);
      await page.locator(".ny-reply-features summary").filter({ hasText: "今日安排" }).click();
      const frame = page.frameLocator(".ny-reply-features iframe").frameLocator("iframe"); await frame.locator("#draft").click();
      assert.equal(await input.inputValue(), extra.options[0]); assert.equal(calls.length, beforeChoice);
      const iframe = await page.locator(".ny-reply-features iframe").elementHandle(), outer = await iframe.contentFrame();
      const childHandle = await outer.locator("iframe").elementHandle(), child = await childHandle.contentFrame();
      assert.equal(await child.evaluate(() => { try { return !!window.parent.document.body; } catch { return false; } }), false, "panel cannot access parent document or wallet");
      assert.equal(await child.evaluate(async () => { try { await fetch("https://should-not-send.invalid/private"); return true; } catch { return false; } }), false, "panel fetch blocked");
      await child.evaluate(() => { location.href = "https://should-not-navigate.invalid/private"; }).catch((error) => { if (!/context|navigation/i.test(error.message)) throw error; });
      await page.waitForTimeout(150);
      assert.equal(unexpected.length, 0);
      await page.evaluate(() => window.postMessage({ type: "ephone-ny-draft", text: "forged-message" }, "*"));
      await page.waitForTimeout(50); assert.notEqual(await input.inputValue(), "forged-message", "unregistered sources cannot inject drafts");
      if (id === "native-watch") {
        await page.locator(".ny-reply-features details").evaluateAll((elements) => elements.forEach((el) => el.open = false));
        await page.locator(".ny-reply-features").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-ny-features-mobile.png") });
      }
    }
    await ready(); await openChat("native-a"); await page.waitForSelector(".ny-reply-features");
    assert.equal(await page.locator(".ny-reply-features button").count(), 4, "extras survive a page reload");
    assert.match(await page.evaluate(async () => window.EPhoneNY.prompt(await window.db.chats.get("native-a"))), /完整总结一/);
    const memory = await page.evaluate(async () => (await window.db.chats.get("native-a")).longTermMemory); assert.equal(memory[0].content, "EXISTING_MEMORY_UNCHANGED");
    const beforeEditor = calls.length;
    await page.evaluate(() => window.EPhoneNY.open("native-a"));
    assert.equal(await page.locator("#ny-summary-content").inputValue(), auxText, "native settings show the complete saved summary");
    assert.equal(await page.locator("#ny-summary-content").isEditable(), true);
    await page.locator("#ny-summary-content").fill("手动修正总结：明天散步。"); await page.locator("#ny-save-summary").click();
    await until(async () => (await row()).content === "手动修正总结：明天散步。", "summary editor commits manual correction");
    assert.equal(calls.length, beforeEditor, "viewing and editing a summary needs no API request");
    assert.match(await page.evaluate(async () => window.EPhoneNY.prompt(await window.db.chats.get("native-a"))), /手动修正总结：明天散步/);
    await openChat("native-a");
    const beforeDedup = calls.length; await append("NEW_HISTORY_ONLY：又商量了集合地点。"); auxText = "完整总结二：保留旧约定并补充集合地点。";
    await page.evaluate(() => Promise.all([window.EPhoneNYFeatures.afterReply("native-a"), window.EPhoneNYFeatures.afterReply("native-a")]));
    assert.equal(calls.length, beforeDedup + 1, "concurrent duplicate summary notifications share one auxiliary request");
    const incremental = JSON.parse(calls.at(-1).body.messages.at(-1).content); assert.equal(incremental.previous, "手动修正总结：明天散步。");
    assert.equal(incremental.messages.length, 1); assert.match(incremental.messages[0].content, /NEW_HISTORY_ONLY/);
    assert.equal((await row()).content, auxText);
    const beforeQueue = calls.length;
    await append("QUEUE_ONE：第一轮的新情节。"); hold = true;
    await page.evaluate(() => { window.nativeSummaryPromise = window.EPhoneNYFeatures.afterReply("native-a"); });
    await until(() => held.length > 0, "older summary held while next round completes");
    await append("QUEUE_TWO：第二轮的新情节。");
    await page.evaluate(() => { window.nativeSummaryNext = window.EPhoneNYFeatures.afterReply("native-a"); });
    hold = false; auxText = "完整总结三：包括先后两轮的新情节。";
    for (const route of held.splice(0)) await route.fulfill({ contentType: "application/json", body: JSON.stringify(openai(JSON.stringify({ summary: "第一轮总结已完成。" }))) });
    await page.evaluate(() => Promise.all([window.nativeSummaryPromise, window.nativeSummaryNext]));
    assert.equal(calls.length, beforeQueue + 2, "a newer completed round queues its own auxiliary summary");
    const queued = JSON.parse(calls.at(-1).body.messages.at(-1).content);
    assert.equal(queued.previous, "第一轮总结已完成。"); assert.equal(queued.messages.length, 1); assert.match(queued.messages[0].content, /QUEUE_TWO/);
    assert.equal((await row()).content, auxText);
    // Failed/stopped generations leave the existing summary intact.
    await append("AFTER_FAILURE：随后补充一条消息。"); fail = true; const previous = (await row()).content;
    await page.evaluate(() => window.EPhoneNYFeatures.afterReply("native-a")); assert.equal((await row()).content, previous); fail = false;
    hold = true; await page.evaluate(() => { window.nativeSummaryPromise = window.EPhoneNYFeatures.afterReply("native-a"); });
    await until(() => held.length > 0, "summary request held");
    await append("AFTER_STOP_QUEUED：停止前另一轮完成。");
    await page.evaluate(() => { window.nativeSummaryNext = window.EPhoneNYFeatures.afterReply("native-a"); });
    const beforeStop = calls.length;
    await page.evaluate(() => window.EPhoneNY.open("native-a"));
    assert.match(await page.locator("#ny-feature-summary h3").textContent(), /正在生成/);
    assert.equal(await page.locator("#ny-summary-content").isEditable(), false);
    assert.equal(await page.locator("#ny-summary-stop").isEnabled(), true);
    await page.locator("#ny-summary-stop").click();
    await page.evaluate(() => Promise.all([window.nativeSummaryPromise, window.nativeSummaryNext])); assert.equal((await row()).content, previous);
    assert.equal(calls.length, beforeStop, "stopping also cancels a queued newer-round summary");
    for (const route of held.splice(0)) await route.abort().catch(() => {}); hold = false;
    await openChat("native-a");
    // Edited/deleted source invalidates automatic injection and cannot be replaced
    // by an in-flight result for the former source.
    hold = true; await page.evaluate(() => { window.nativeSummaryPromise = window.EPhoneNYFeatures.afterReply("native-a"); });
    await until(() => held.length > 0, "second held summary");
    await page.evaluate(async () => { const chat = await window.db.chats.get("native-a"); chat.history[0].content = "SOURCE_EDITED"; await window.db.chats.put(chat); });
    for (const route of held.splice(0)) await route.fulfill({ contentType: "application/json", body: JSON.stringify(openai(JSON.stringify({ summary: "STALE_RESULT" }))) });
    await page.evaluate(() => window.nativeSummaryPromise); hold = false;
    assert.equal((await row()).content, previous); assert.equal((await row()).valid, false);
    assert.doesNotMatch(await page.evaluate(async () => window.EPhoneNY.prompt(await window.db.chats.get("native-a"))), /完整总结三|STALE_RESULT/);
    hold = true; await page.evaluate(() => { window.nativeSummaryPromise = window.EPhoneNYFeatures.afterReply("native-a"); });
    await until(() => held.length > 0, "settings-change held summary");
    await page.evaluate(() => window.EPhoneNY.configure("native-a", { promptOverrides: { summary: false } }));
    for (const route of held.splice(0)) await route.fulfill({ contentType: "application/json", body: JSON.stringify(openai(JSON.stringify({ summary: "DISABLED_WHILE_IN_FLIGHT" }))) });
    await page.evaluate(() => window.nativeSummaryPromise); hold = false;
    assert.equal((await row()).content, previous, "changed feature settings reject an in-flight summary");
    assert.equal(await page.evaluate(async () => {
      const isolated = new Dexie("NYFeaturesIsolatedSpace"); isolated.version(1).stores({ chats: "id", spaceProfiles: "id" }); await isolated.open();
      await isolated.chats.put({ id: "native-a", history: [] });
      const result = await window.EPhoneNYFeatures.readSummary("native-a", isolated); await isolated.delete(); return result;
    }), null, "same chat ID in another persona space has no inherited summary");
    await page.evaluate(() => { const chat = window.EPhoneNyAdapter.currentChat(); chat.history.findLast((m) => m.nyFeatures).content = "正文已经编辑"; window.EPhoneNYFeatures.paint(); });
    await until(() => page.locator(".ny-reply-features").count().then((n) => n === 0), "stale presentation removed after editing its source");
    await page.evaluate(() => window.EPhoneNY.configure("native-watch", { enabled: false }));
    const disabledBefore = calls.length; await append("FEATURE_DISABLED", "native-watch"); await page.evaluate(() => window.EPhoneNYFeatures.afterReply("native-watch"));
    assert.equal(calls.length, disabledBefore, "disabled feature cannot call either API");
    assert.deepEqual(await page.evaluate(async (extra) => { const c = new AbortController(); await window.EPhoneNYFeatures.capture(c, JSON.stringify([{ type: "narration", content: "off", ny_extra: extra }]), "native-watch"); return c.nyExtra; }, extra), {}, "hallucinated extras cannot activate disabled features");
    // A stopped round never attaches unseen end-of-round choices or panels.
    assert.equal(await page.evaluate(async () => { const c = new AbortController(); c.ephoneRoundId = "stopped"; c.nyPlaybackComplete = true; await window.EPhoneNYFeatures.capture(c, JSON.stringify([{ type: "narration", content: "later", ny_extra: { options: ["future choice"] } }]), "native-a"); if (!c.nyExtra.options?.length) throw new Error("enabled choice should be captured first"); c.abort(); const chat = { id: "native-a", history: [{ content: "partial", ephoneReplyRoundId: "stopped" }] }; window.EPhoneNYFeatures.finish(chat, c); return !!chat.history[0].nyFeatures; }), false);
    assert.deepEqual(await page.evaluate(async () => { const c = new AbortController(); c.ephoneRoundId = "incomplete"; await window.EPhoneNYFeatures.capture(c, JSON.stringify([{ type: "narration", content: "later", ny_extra: { options: ["future choice"] } }]), "native-a"); const chat = { id: "native-a", history: [{ content: "partial", ephoneReplyRoundId: "incomplete" }] }; window.EPhoneNYFeatures.finish(chat, c); const partial = !!chat.history[0].nyFeatures; c.nyPlaybackComplete = true; window.EPhoneNYFeatures.finish(chat, c); return { partial, complete: !!chat.history[0].nyFeatures }; }), { partial: false, complete: true }, "non-aborted but incomplete playback cannot expose unseen extras");
    assert.deepEqual(errors, []);
    console.log("NY native options, translation, isolated interface and auxiliary summaries: passed");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
