// Real NY packages, mobile UI and IndexedDB. All provider traffic is intercepted.
// Set EPHONE_NY_PRESETS_DIR when the two user-supplied packages live elsewhere.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
const { dailyReply } = require("./browser-test-fixtures.js");

const presetDirectory = process.env.EPHONE_NY_PRESETS_DIR || path.resolve(__dirname, "../..");
const packages = ["Ny-Claude-1.6.8_SogonSigon.json", "Ny-Gemini-1.4.3_SogonSigon_2.json"]
  .map((filename) => ({ filename, data: JSON.parse(fs.readFileSync(path.join(presetDirectory, filename), "utf8")) }));
const tags = {
  sigon: ["Matrix", "summary", "WritingStyle", "剧情建议"],
  sogon: ["summary", "角色大五人格画像", "OOC风险与修正", "依恋模式分析", "情绪调节模式分析", "核心关系图式分析", "爱的三角结构分析", "防御机制分析", "角色补丁", "状态贴片", "关系进展"],
  archive: ["世界观", "main_char", "support_chars", "主线剧情", "支线剧情", "当前主线进度", "设定偏离与修正"]
};
const response = (kind, marker) => tags[kind].map((tag) => `[${tag}]${marker}:${tag}[/${tag}]`).join("\n");
const openai = (text) => ({ choices: [{ message: { content: text }, finish_reason: "stop" }] });
const promptOverrides = (data) => Object.fromEntries(data.prompts.filter((p) => /\{\{xbgetvar::NY-/.test(p.content || "")).map((p) => [p.identifier, true]));
function sourceSnippets(data, kind) {
  const name = { sigon: "NY-Sigon主程序", sogon: "NY-Sogon主程序", archive: "NY-档案馆主程序" }[kind];
  const task = data.prompt_order.find((entry) => Number(entry.character_id) === 100000).xiaobai_ext.scheduledTasks.find((entry) => entry.name === name);
  return task.x.LittleWhiteBox.tpl.scaffold.map((entry) => ({ role: entry.role === "sys" ? "system" : entry.role,
    snippet: (String(entry.text || "").match(/[^{}]{70,}/g) || []).map((s) => s.trim()).find((s) => s.length >= 70)?.slice(0, 120) }))
    .filter((entry) => entry.snippet).slice(0, 3);
}

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const calls = [], errors = [];
  let auxiliaryText = response("sigon", "SIGON_INITIAL"), auxiliaryQueue = [], failAuxiliary = false, holdAuxiliary = false, heldRoute = null;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/*", async (route) => {
      const request = route.request(), url = request.url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      const primary = url.startsWith("https://ny-main.invalid/"), auxiliary = url.startsWith("https://ny-aux.invalid/");
      if (!primary && !auxiliary) return route.abort();
      const body = request.postDataJSON(), prompt = (body.messages || []).map((m) => m.content || "").join("\n");
      const daily = dailyReply(prompt);
      if (daily) return route.fulfill({ contentType: "application/json", body: JSON.stringify(daily) });
      calls.push({ primary, body, prompt, url, headers: request.headers() });
      if (auxiliary && holdAuxiliary) { heldRoute = route; return; }
      if (auxiliary && failAuxiliary) return route.fulfill({ status: 503, body: "isolated NY auxiliary failure" });
      const text = primary ? JSON.stringify([
        { type: "narration", content: "2026年3月5日，10点00分，星期四，地点：图书馆" },
        { type: "text", name: "林", content: "继续记得约定，明天再一起整理资料。" }
      ]) : auxiliaryQueue.length ? auxiliaryQueue.shift() : auxiliaryText;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(openai(text)) });
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady && window.EPhoneNY);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://ny-main.invalid/v1", apiKey: "fake-ny-primary", model: "ny-reply-model",
        secondaryProxyUrl: "https://ny-aux.invalid/v1", secondaryApiKey: "fake-ny-auxiliary", secondaryModel: "ny-analysis-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "ny-a", originalName: "林", groupNickname: "林", persona: "林是成年人，是保持独立生活的教师。NY_CHARACTER_PROFILE。", avatar };
      for (const id of ["ny-a", "ny-b", "ny-c"]) await window.db.chats.put({ id, name: id === "ny-a" ? "林" : "另一聊天", originalName: id === "ny-a" ? "林" : "另一聊天", avatar,
        settings: { aiPersona: member.persona, aiAvatar: avatar, maxMemory: 30, linkedWorldBookIds: [] },
        history: [{ role: "user", content: "NY_SOURCE_HISTORY_" + id + "：约定明天到图书馆见面。", timestamp: 100, vts: new Date(2026, 2, 5, 9).getTime() }],
        longTermMemory: [{ content: "NY_EXISTING_MEMORY_" + id, timestamp: 1 }] });
      await window.db.chats.put({ id: "ny-watch", name: "旁观讨论", avatar, isGroup: true, isSpectatorGroup: true, members: [member],
        settings: { myNickname: "我", maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [] });
    });
    async function ready() { await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady && window.EPhoneNY); }
    async function state(id) { return page.evaluate((chatId) => window.EPhoneNY.getState(chatId), id); }
    async function configure(id, patch) { return page.evaluate(({ chatId, patch }) => window.EPhoneNY.configure(chatId, patch), { chatId: id, patch }); }
    async function prompt(id) { return page.evaluate(async (chatId) => window.EPhoneNY.prompt(await window.db.chats.get(chatId)), id); }
    async function until(predicate, description) {
      const deadline = Date.now() + 15000;
      while (!(await predicate())) { assert.ok(Date.now() < deadline, description); await page.waitForTimeout(25); }
    }
    // waitForFunction treats a Promise object as truthy; poll its resolved value
    // explicitly for IndexedDB predicates instead of passing an async function.
    async function waitState(predicate, description) { return until(() => page.evaluate(predicate), description); }
    async function openChat(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen"));
      await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click();
      await page.waitForSelector("#chat-interface-screen.active");
    }
    async function caughtRun(kind, chatId) {
      return page.evaluate(async ({ kind, chatId }) => { try { return { value: await window.EPhoneNY.run(kind, chatId) }; } catch (error) { return { error: error.message }; } }, { kind, chatId });
    }
    await ready();
    const originalSpace = await page.evaluate(() => window.EPHONE_SPACE_ID);
    const originalChats = await page.evaluate(() => window.db.chats.bulkGet(["ny-a", "ny-b"]));
    const packIds = [];
    for (const source of packages) {
      const imported = await page.evaluate(async ({ data, filename }) => {
        const before = new Set((await window.db.spaceProfiles.toArray()).map((row) => row.id));
        await window.EPhoneNY.importPreset(data, filename);
        const added = (await window.db.spaceProfiles.toArray()).filter((row) => row.id.startsWith("ny:pack:") && !before.has(row.id));
        return added;
      }, source);
      assert.equal(imported.length, 1, "each real user package imports as one source pack");
      packIds.push(imported[0].id);
      const stored = JSON.stringify(imported[0]);
      for (const kind of Object.keys(tags)) for (const entry of sourceSnippets(source.data, kind)) assert.ok(stored.includes(JSON.stringify(entry.snippet).slice(1, -1)), "persist the original " + kind + " analysis scaffold");
      assert.doesNotMatch(stored, /fake-ny-(?:primary|auxiliary)|<<taskjs>>/, "a pack stores prompt configuration, without credentials or executable imported task code");
    }
    assert.notEqual(packIds[0], packIds[1]);
    await page.evaluate((source) => window.EPhoneNY.importPreset(source.data, source.filename), packages[0]);
    assert.equal(await page.evaluate(async () => (await window.db.spaceProfiles.toArray()).filter((row) => row.id.startsWith("ny:pack:")).length), 2, "reimporting the same source updates its stable pack");
    assert.equal(calls.length, 0, "import never calls either provider");
    // Exercise the delivered combined bundle through the real file input.
    await page.evaluate(() => window.showScreen("chat-list-screen"));
    await page.locator('.nav-item[data-view="me-view"]').click();
    await page.locator("#me-ny-button").click();
    await page.waitForSelector("#ny-engine-screen.active");
    await page.locator("#ny-chat").selectOption("ny-a");
    const bundlePath = path.join(__dirname, "..", "NY小手机配置_20261029", "NY_Claude_Gemini_本地导入包.json");
    const bundleInput = fs.existsSync(bundlePath) ? bundlePath : { name: "NY_Claude_Gemini_本地导入包.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ephoneNySources: packages })) };
    await page.locator("#ny-file").setInputFiles(bundleInput);
    await page.waitForFunction(() => document.getElementById("ny-notice")?.textContent.includes("已导入"));
    assert.equal(await page.evaluate(async () => (await window.db.spaceProfiles.toArray()).filter((row) => row.id.startsWith("ny:pack:")).length), 2, "the combined UI import updates both existing sources without duplicates");
    assert.equal(await page.locator("#ny-pack option").count(), 3, "the selector contains automatic choice and exactly two imported packs");
    const uiImported = await state("ny-a");
    assert.equal(uiImported.enabled, true); assert.equal(await page.locator("#ny-enabled").isChecked(), true);
    for (const kind of Object.keys(tags)) { assert.equal(uiImported.tasks[kind].enabled, true); assert.equal(uiImported.tasks[kind].auto, false); }
    assert.equal(calls.length, 0, "opening and importing the actual local bundle cannot make an analysis or main reply request");
    const engineSettings = Object.fromEntries(Object.keys(tags).map((kind) => [kind, { enabled: true, auto: false, interval: 20 }]));
    await configure("ny-a", { packId: packIds[0], enabled: true, promptOverrides: promptOverrides(packages[0].data), tasks: engineSettings });
    await configure("ny-b", { packId: packIds[1], enabled: true, promptOverrides: promptOverrides(packages[1].data), tasks: engineSettings });

    for (const kind of Object.keys(tags)) {
      auxiliaryText = response(kind, "CLAUDE_" + kind.toUpperCase());
      const before = calls.length, result = await caughtRun(kind, "ny-a");
      assert.equal(result.error, undefined, kind + ": " + result.error);
      assert.equal(calls.length, before + 1, "complete " + kind + " analysis needs one auxiliary request");
      const call = calls.at(-1);
      assert.equal(call.primary, false); assert.equal(call.body.model, "ny-analysis-model"); assert.equal(call.headers.authorization, "Bearer fake-ny-auxiliary");
      for (const entry of sourceSnippets(packages[0].data, kind)) assert.ok(call.body.messages.some((m) => m.role === entry.role && String(m.content).includes(entry.snippet)), "send original " + kind + " messages with their source roles");
      assert.match(call.prompt, /NY_SOURCE_HISTORY_ny-a/); assert.doesNotMatch(call.prompt, /NY_SOURCE_HISTORY_ny-b/);
      assert.doesNotMatch(call.prompt, /\{\{(?:xbgetvar::|user\}\}|char\}\}|persona\}\})|\{\$worldInfo\}/, "expand source macros before the auxiliary request");
      const saved = (await state("ny-a")).tasks[kind].result;
      for (const tag of tags[kind]) assert.equal(saved.tags[tag], "CLAUDE_" + kind.toUpperCase() + ":" + tag);
      assert.equal(saved.complete, true);
    }
    auxiliaryText = response("sigon", "GEMINI_SIGON");
    const geminiBefore = calls.length;
    assert.equal((await caughtRun("sigon", "ny-b")).error, undefined);
    assert.equal(calls.length, geminiBefore + 1);
    for (const entry of sourceSnippets(packages[1].data, "sigon")) assert.ok(calls.at(-1).body.messages.some((m) => m.role === entry.role && String(m.content).includes(entry.snippet)));
    assert.doesNotMatch(calls.at(-1).prompt, /CLAUDE_SIGON:summary|NY_SOURCE_HISTORY_ny-a/);
    assert.equal((await state("ny-b")).tasks.sigon.result.tags.summary, "GEMINI_SIGON:summary");
    const afterAnalysis = await page.evaluate(() => window.db.chats.bulkGet(["ny-a", "ny-b"]));
    for (let i = 0; i < originalChats.length; i++) {
      assert.deepEqual(afterAnalysis[i].history, originalChats[i].history, "analysis preserves full chat histories");
      assert.deepEqual(afterAnalysis[i].longTermMemory, originalChats[i].longTermMemory, "analysis preserves existing memories");
    }
    const archiveBook = await page.evaluate(() => window.EPhoneNY.getArchiveBook("ny-a"));
    assert.equal(archiveBook.nyChatId, "ny-a");
    assert.ok(archiveBook.content.some((row) => row.content === "CLAUDE_ARCHIVE:世界观"));

    // Open from the real mobile navigation, edit a report and apply it to replies.
    await page.evaluate(() => window.showScreen("chat-list-screen"));
    await page.locator('.nav-item[data-view="me-view"]').click();
    await page.locator("#me-ny-button").click();
    await page.waitForSelector("#ny-engine-screen.active");
    await page.locator("#ny-chat").selectOption("ny-a");
    await page.locator("#ny-kind").selectOption("sogon");
    await page.locator('textarea[data-ny-tag="角色补丁"]').fill("REPORT_MANUAL_EDIT_A");
    await page.locator("#ny-save-report").click();
    await waitState(async () => (await window.EPhoneNY.getState("ny-a")).tasks.sogon.result.tags["角色补丁"] === "REPORT_MANUAL_EDIT_A", "the edited report should finish saving");
    assert.match(await prompt("ny-a"), /REPORT_MANUAL_EDIT_A/);
    assert.doesNotMatch(await prompt("ny-b"), /REPORT_MANUAL_EDIT_A|CLAUDE_/);
    await configure("ny-a", { enabled: false });
    assert.equal(await prompt("ny-a"), "", "the chat-level switch stops saved reports from entering replies");
    await configure("ny-a", { enabled: true, tasks: { sogon: { enabled: false } } });
    assert.doesNotMatch(await prompt("ny-a"), /REPORT_MANUAL_EDIT_A/, "an individual engine can be disabled without deleting its report");
    assert.equal((await state("ny-a")).tasks.sogon.result.tags["角色补丁"], "REPORT_MANUAL_EDIT_A");
    await configure("ny-a", { tasks: { sogon: { enabled: true } } });
    const screenshot = path.join(require("node:os").tmpdir(), "ephone-ny-engine-mobile.png");
    await page.screenshot({ path: screenshot });
    await configure("ny-watch", { packId: packIds[0], enabled: true, promptOverrides: promptOverrides(packages[0].data), tasks: engineSettings });
    auxiliaryText = response("sogon", "WATCH_SOGON");
    assert.equal((await caughtRun("sogon", "ny-watch")).error, undefined);
    for (const id of ["ny-a", "ny-watch"]) {
      await openChat(id);
      await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
      await page.evaluate(() => { const notice = document.getElementById("daily-schedule-status"); if (notice) notice.hidden = true; });
      const before = calls.length;
      await page.locator(id === "ny-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      const added = calls.slice(before);
      assert.equal(added.length, 1); assert.equal(added[0].primary, true); assert.equal(added[0].body.model, "ny-reply-model");
      assert.match(added[0].prompt, id === "ny-a" ? /REPORT_MANUAL_EDIT_A/ : /WATCH_SOGON:角色补丁/);
      if (id === "ny-a") assert.match(added[0].prompt, /CLAUDE_ARCHIVE:世界观/);
    }

    // Real after-reply scheduling runs one enabled engine once per new floor.
    // Reload after the preceding manual replies so their asynchronous disabled
    // after-reply notifications have no overlap with enabling this new policy.
    await ready();
    await openChat("ny-a");
    await page.evaluate(() => {
      const afterReply = window.EPhoneNY.afterReply;
      window.__nyAutoHookCompletions = 0;
      window.EPhoneNY.afterReply = async (...args) => { try { return await afterReply(...args); } finally { if (args[0] === "ny-a") window.__nyAutoHookCompletions++; } };
    });
    auxiliaryText = response("sigon", "AUTO_SIGON");
    const autoBefore = calls.length;
    await configure("ny-a", { tasks: { sigon: { auto: true, interval: 1 } } });
    await page.locator("#wait-reply-btn").click();
    await page.waitForFunction(() => window.__nyAutoHookCompletions >= 1);
    await waitState(async () => (await window.EPhoneNY.getState("ny-a")).tasks.sigon.result.tags.summary === "AUTO_SIGON:summary", "automatic analysis should finish saving its new report");
    await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.equal(calls.slice(autoBefore).filter((call) => call.primary).length, 1);
    assert.equal(calls.slice(autoBefore).filter((call) => !call.primary).length, 1);
    const dedupeBefore = calls.length;
    await page.evaluate(() => window.EPhoneNY.afterReply("ny-a"));
    assert.equal(calls.length, dedupeBefore, "replaying an after-reply notification cannot charge twice for the same floor");
    await configure("ny-a", { tasks: { sigon: { auto: false } } });

    // Save settings, start and stop from real buttons while the API is held.
    await page.evaluate(() => window.EPhoneNY.open("ny-a"));
    if (await page.locator("#ny-kind").inputValue() !== "sigon") {
      await page.locator("#ny-kind").selectOption("sigon");
      await page.locator('textarea[data-ny-tag="Matrix"]').waitFor();
    }
    await page.locator("#ny-prefs").fill("UI_SAVED_ANALYSIS_PREFERENCE：保留既定人物边界。");
    await page.locator("#ny-interval").fill("7");
    const uiSaveBefore = calls.length;
    await page.locator("#ny-save").click();
    await waitState(async () => {
      const task = (await window.EPhoneNY.getState("ny-a")).tasks.sigon;
      return task.interval === 7 && task.prefs.userPref.enabled && task.prefs.userPref.text.includes("UI_SAVED_ANALYSIS_PREFERENCE");
    }, "UI preferences and interval should finish saving");
    await page.waitForFunction(() => document.getElementById("ny-notice")?.textContent.includes("设置已保存") && document.getElementById("ny-prefs")?.value.includes("UI_SAVED_ANALYSIS_PREFERENCE"));
    assert.equal(calls.length, uiSaveBefore, "saving analysis preferences does not call an API");
    let preserved = (await state("ny-a")).tasks.sigon.result;
    holdAuxiliary = true; heldRoute = null;
    const uiRunBefore = calls.length;
    await page.locator("#ny-run").click();
    await until(() => heldRoute !== null, "NY analysis should reach the held fake auxiliary API");
    await page.waitForFunction(() => document.getElementById("ny-run")?.disabled && document.getElementById("ny-save")?.disabled && !document.getElementById("ny-stop")?.disabled);
    assert.equal(await page.evaluate(() => window.EPhoneNY.isBusy()), true);
    assert.equal(calls.length, uiRunBefore + 1); assert.equal(calls.at(-1).primary, false);
    assert.ok(calls.at(-1).prompt.includes("UI_SAVED_ANALYSIS_PREFERENCE"), "the saved UI preference must appear in the actual auxiliary messages: " + JSON.stringify(await page.evaluate(async () => {
      const state = await window.EPhoneNY.getState("ny-a"), pack = await window.db.spaceProfiles.get(state.packId);
      return { prefs: state.tasks.sigon.prefs, ui: document.getElementById("ny-prefs")?.value, hasRawTemplate: !!pack.tasks.sigon.config.tplRaw };
    })));
    await page.locator("#ny-stop").click();
    await page.waitForFunction(() => !window.EPhoneNY.isBusy() && !document.getElementById("ny-run")?.disabled && !document.getElementById("ny-save")?.disabled && document.getElementById("ny-stop")?.disabled);
    assert.match(await page.locator("#ny-notice").innerText(), /已停止|原报告保留/);
    await heldRoute.fulfill({ contentType: "application/json", body: JSON.stringify(openai(response("sigon", "LATE_STOPPED"))) }).catch(() => {});
    holdAuxiliary = false;
    assert.deepEqual((await state("ny-a")).tasks.sigon.result, preserved);
    // Failure cannot replace a saved report or spend on the main API.
    failAuxiliary = true;
    const failedBefore = calls.length;
    await caughtRun("sigon", "ny-a");
    assert.equal(calls.length, failedBefore + 1); assert.equal(calls.at(-1).primary, false);
    assert.deepEqual((await state("ny-a")).tasks.sigon.result, preserved);
    failAuxiliary = false;
    await ready();
    assert.deepEqual((await state("ny-a")).tasks.sigon.result, preserved);
    assert.equal((await state("ny-a")).tasks.sogon.result.tags["角色补丁"], "REPORT_MANUAL_EDIT_A");
    assert.equal((await state("ny-b")).tasks.sigon.result.tags.summary, "GEMINI_SIGON:summary");

    await page.evaluate(() => window.showScreen("api-settings-screen"));
    await page.locator("#secondary-api-key").fill("");
    await waitState(async () => !(await window.db.apiConfig.get("main")).secondaryApiKey, "clearing the auxiliary credential should finish saving");
    const missingBefore = calls.length;
    await caughtRun("sigon", "ny-a");
    assert.equal(calls.length, missingBefore, "missing auxiliary credentials never fall back to the valid main connection");
    assert.deepEqual((await state("ny-a")).tasks.sigon.result, preserved);
    await page.locator("#secondary-api-key").fill("fake-ny-auxiliary");
    await waitState(async () => (await window.db.apiConfig.get("main")).secondaryApiKey === "fake-ny-auxiliary", "restoring the fake auxiliary credential should finish saving");

    // Two starts for the same chat/engine share the one paid request and result.
    await configure("ny-c", { packId: packIds[0], enabled: true, promptOverrides: promptOverrides(packages[0].data), tasks: engineSettings });
    holdAuxiliary = true; heldRoute = null;
    const concurrentBefore = calls.length;
    await page.evaluate(() => {
      window.__nyConcurrentRuns = Promise.all([window.EPhoneNY.run("sigon", "ny-c"), window.EPhoneNY.run("sigon", "ny-c")]);
    });
    await until(() => heldRoute !== null, "concurrent NY starts should reach one held auxiliary request");
    assert.equal(calls.length, concurrentBefore + 1);
    await heldRoute.fulfill({ contentType: "application/json", body: JSON.stringify(openai(response("sigon", "CONCURRENT_SIGON"))) });
    holdAuxiliary = false;
    const concurrentResults = await page.evaluate(() => window.__nyConcurrentRuns);
    assert.equal(calls.length, concurrentBefore + 1, "a second same-engine start cannot create a second paid request");
    assert.deepEqual(concurrentResults[0], concurrentResults[1]);
    assert.equal(concurrentResults[0].tags.summary, "CONCURRENT_SIGON:summary");

    // A tag split across responses is completed using only the auxiliary API.
    const firstFragment = "[Matrix]FRAGMENT_MATRIX[/Matrix]\n[summary]FRAGMENT_SUMMARY[/summary]\n[WritingStyle]FRAGMENT_FIRST_HALF";
    const secondFragment = "FRAGMENT_SECOND_HALF[/WritingStyle]\n[剧情建议]FRAGMENT_PLOT[/剧情建议]";
    auxiliaryQueue = [firstFragment, secondFragment];
    const continuationBefore = calls.length, continued = await caughtRun("sigon", "ny-c");
    assert.equal(continued.error, undefined);
    assert.equal(auxiliaryQueue.length, 0);
    const continuationCalls = calls.slice(continuationBefore);
    assert.equal(continuationCalls.length, 2);
    assert.ok(continuationCalls.every((call) => !call.primary && call.body.model === "ny-analysis-model"));
    assert.ok(continuationCalls[1].body.messages.some((m) => m.role === "assistant" && m.content === firstFragment), "continuation includes the full received first response");
    assert.match(continuationCalls[1].body.messages.at(-1).content, /WritingStyle.*剧情建议/);
    const completedFragment = (await state("ny-c")).tasks.sigon.result;
    assert.equal(completedFragment.complete, true); assert.equal(completedFragment.requests, 2);
    assert.equal(completedFragment.tags.Matrix, "FRAGMENT_MATRIX");
    assert.equal(completedFragment.tags.summary, "FRAGMENT_SUMMARY");
    assert.equal(completedFragment.tags.WritingStyle, "FRAGMENT_FIRST_HALF\nFRAGMENT_SECOND_HALF");
    assert.equal(completedFragment.tags["剧情建议"], "FRAGMENT_PLOT");
    assert.ok(completedFragment.raw.includes(firstFragment) && completedFragment.raw.includes(secondFragment), "both original fragments remain available in the stored report");

    // Editing a source message while an analysis is in flight rejects that result.
    const sourceHistory = await page.evaluate(async () => (await window.db.chats.get("ny-c")).history);
    holdAuxiliary = true; heldRoute = null;
    await page.evaluate(() => { window.__nySourceChangedRun = window.EPhoneNY.run("sigon", "ny-c").then(() => ({ ok: true }), (error) => ({ error: error.message })); });
    await until(() => heldRoute !== null, "source-edit fixture should enter the held auxiliary API");
    await page.evaluate(async () => {
      const chat = await window.db.chats.get("ny-c"); chat.history[0].content = "EDITED_WHILE_ANALYSIS_WAS_RUNNING";
      await window.db.chats.put(chat);
    });
    await heldRoute.fulfill({ contentType: "application/json", body: JSON.stringify(openai(response("sigon", "INVALIDATED_IN_FLIGHT"))) });
    holdAuxiliary = false;
    const invalidated = await page.evaluate(() => window.__nySourceChangedRun);
    assert.match(invalidated.error || "", /修改|删除|未覆盖/);
    assert.deepEqual((await state("ny-c")).tasks.sigon.result, completedFragment, "an obsolete response cannot overwrite the previous report");
    assert.doesNotMatch(await prompt("ny-c"), /FRAGMENT_SUMMARY|FRAGMENT_FIRST_HALF|INVALIDATED_IN_FLIGHT/, "saved reports from the edited source stop entering replies");
    await page.evaluate(async (history) => { await window.db.chats.update("ny-c", { history }); }, sourceHistory);

    // Historical edits invalidate all dependent reports, including the archive.
    assert.match(await prompt("ny-a"), /AUTO_SIGON:summary/);
    assert.match(await prompt("ny-a"), /REPORT_MANUAL_EDIT_A/);
    assert.match(await prompt("ny-a"), /CLAUDE_ARCHIVE:世界观/);
    await page.evaluate(async () => {
      const chat = await window.db.chats.get("ny-a"); chat.history[0].content = "NY_MAIN_HISTORY_EDITED：改约下周到博物馆见面。";
      await window.db.chats.put(chat);
    });
    const stalePrompt = await prompt("ny-a");
    assert.doesNotMatch(stalePrompt, /AUTO_SIGON:summary|REPORT_MANUAL_EDIT_A|CLAUDE_ARCHIVE:/, "old analysis and worldbook facts cannot survive a source-history edit in the native prompt");
    assert.deepEqual((await state("ny-a")).tasks.sigon.result, preserved, "stale suppression keeps the old report available for review");
    assert.deepEqual(await page.evaluate(() => window.EPhoneNY.getArchiveBook("ny-a")), archiveBook, "invalidating source history does not erase the editable archive");
    await ready();
    await openChat("ny-a");
    await page.evaluate(() => { const notice = document.getElementById("daily-schedule-status"); if (notice) notice.hidden = true; });
    const editedReplyBefore = calls.length;
    await page.locator("#wait-reply-btn").click();
    await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    const editedReplyCalls = calls.slice(editedReplyBefore);
    assert.equal(editedReplyCalls.length, 1); assert.equal(editedReplyCalls[0].primary, true);
    assert.match(editedReplyCalls[0].prompt, /NY_MAIN_HISTORY_EDITED/);
    assert.doesNotMatch(editedReplyCalls[0].prompt, /AUTO_SIGON:summary|REPORT_MANUAL_EDIT_A|CLAUDE_ARCHIVE:/, "the actual main reply cannot retrieve stale archive content through another worldbook path");
    auxiliaryText = response("sigon", "AFTER_HISTORY_EDIT");
    const regenerationBefore = calls.length;
    assert.equal((await caughtRun("sigon", "ny-a")).error, undefined);
    assert.equal(calls.length, regenerationBefore + 1);
    assert.match(calls.at(-1).prompt, /NY_MAIN_HISTORY_EDITED/);
    assert.doesNotMatch(calls.at(-1).prompt, /AUTO_SIGON:summary|REPORT_MANUAL_EDIT_A|CLAUDE_ARCHIVE:/, "new analysis does not recycle stale prior reports");
    preserved = (await state("ny-a")).tasks.sigon.result;
    assert.match(await prompt("ny-a"), /AFTER_HISTORY_EDIT:summary/);
    assert.doesNotMatch(await prompt("ny-a"), /REPORT_MANUAL_EDIT_A|CLAUDE_ARCHIVE:/);

    // A space switch either waits for stopping or rejects an old-space completion.
    await page.evaluate(() => {
      const spaces = JSON.parse(localStorage.getItem("ephone-persona-spaces-v1") || "[]");
      localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([...spaces, { id: "ny-other-space", name: "NY隔离空间" }]));
    });
    holdAuxiliary = true; heldRoute = null;
    await page.evaluate(() => { window.__nyBrowserRun = window.EPhoneNY.run("sigon", "ny-a").then(() => "done", (error) => error.message); });
    await until(() => heldRoute !== null, "space-switch fixture should enter auxiliary API");
    const switched = await page.evaluate(async () => { try { await window.EPhoneSpaces.switchSpace("ny-other-space"); return true; } catch { return false; } });
    if (!switched) await page.evaluate(() => window.EPhoneNY.stop("sigon"));
    await heldRoute.fulfill({ contentType: "application/json", body: JSON.stringify(openai(response("sigon", "OTHER_SPACE_LATE"))) }).catch(() => {});
    await page.evaluate(() => window.__nyBrowserRun);
    holdAuxiliary = false;
    if (!switched) await page.evaluate(() => window.EPhoneSpaces.switchSpace("ny-other-space"));
    assert.equal(await page.evaluate(async () => (await window.db.spaceProfiles.toArray()).filter((row) => row.id.startsWith("ny:pack:")).length), 0);
    const isolated = await state("ny-a");
    assert.ok(!isolated.tasks?.sigon?.result, "an old-space response cannot create a report in the new space");
    // Shared worldbook storage still uses a concrete persona database + chat ID.
    await page.evaluate(async () => {
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightgreen"/></svg>');
      await window.db.chats.put({ id: "ny-a", name: "另一空间的林", originalName: "林", avatar,
        settings: { aiPersona: "另一空间的成年人角色", maxMemory: 30, linkedWorldBookIds: [] },
        history: [{ role: "user", content: "OTHER_SPACE_ARCHIVE_SOURCE", timestamp: 100 }] });
    });
    await page.evaluate((source) => window.EPhoneNY.importPreset(source.data, source.filename), packages[0]);
    await configure("ny-a", { packId: packIds[0], enabled: true, promptOverrides: promptOverrides(packages[0].data), tasks: engineSettings });
    auxiliaryText = response("archive", "OTHER_SPACE_ARCHIVE");
    const newArchiveBefore = calls.length;
    assert.equal((await caughtRun("archive", "ny-a")).error, undefined);
    assert.equal(calls.length, newArchiveBefore + 1); assert.equal(calls.at(-1).primary, false);
    assert.match(calls.at(-1).prompt, /OTHER_SPACE_ARCHIVE_SOURCE/);
    assert.doesNotMatch(calls.at(-1).prompt, /NY_MAIN_HISTORY_EDITED|CLAUDE_ARCHIVE:|AFTER_HISTORY_EDIT:/);
    const otherArchive = await page.evaluate(() => window.EPhoneNY.getArchiveBook("ny-a"));
    assert.notEqual(otherArchive.id, archiveBook.id); assert.notEqual(otherArchive.nyDatabase, archiveBook.nyDatabase);
    assert.equal(otherArchive.nyChatId, "ny-a");
    assert.ok(otherArchive.content.some((row) => row.content === "OTHER_SPACE_ARCHIVE:世界观"));
    assert.match(await prompt("ny-a"), /OTHER_SPACE_ARCHIVE:世界观/);
    assert.doesNotMatch(await prompt("ny-a"), /CLAUDE_ARCHIVE:|REPORT_MANUAL_EDIT_A|AFTER_HISTORY_EDIT:/);
    await page.evaluate((spaceId) => window.EPhoneSpaces.switchSpace(spaceId), originalSpace);
    assert.deepEqual((await state("ny-a")).tasks.sigon.result, preserved);
    assert.equal((await state("ny-b")).tasks.sigon.result.tags.summary, "GEMINI_SIGON:summary");
    assert.deepEqual(await page.evaluate(() => window.EPhoneNY.getArchiveBook("ny-a")), archiveBook, "another space's same-chat-ID archive never overwrites the original book");
    assert.doesNotMatch(await prompt("ny-a"), /OTHER_SPACE_ARCHIVE:/);
    assert.deepEqual(errors, []);
    console.log("SCREENSHOT " + screenshot);
    console.log("PASS: actual local bundle UI import, source pack dedupe, UI save/start/stop busy states, exact Claude/Gemini auxiliary scaffolds/roles, all three reports, mobile editing and normal/watch injection, automatic floor dedupe, concurrent-run dedupe, fragmented-tag continuation, edited-source invalidation, main/aux routing, reload and same-chat-ID archive isolation across spaces");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
