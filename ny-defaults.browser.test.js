// Space defaults, per-chat reports and complete prompt previews in the real app.
// All network access beyond the local app and Dexie fixture is intercepted.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
const { dailyReply } = require("./browser-test-fixtures.js");

const bundlePath = path.join(__dirname, "..", "NY小手机配置_20261029", "NY_Claude_Gemini_本地导入包.json");
const presetDirectory = process.env.EPHONE_NY_PRESETS_DIR || path.resolve(__dirname, "../..");
const bundle = fs.existsSync(bundlePath) ? JSON.parse(fs.readFileSync(bundlePath, "utf8")) : {
  ephoneNySources: ["Ny-Claude-1.6.8_SogonSigon.json", "Ny-Gemini-1.4.3_SogonSigon_2.json"]
    .map((filename) => ({ filename, data: JSON.parse(fs.readFileSync(path.join(presetDirectory, filename), "utf8")) }))
};
const source = bundle.ephoneNySources.find((entry) => /claude/i.test(entry.filename)) || bundle.ephoneNySources[0];
const sigonTags = ["Matrix", "summary", "WritingStyle", "剧情建议"];
const response = (marker) => sigonTags.map((tag) => `[${tag}]${marker}:${tag}[/${tag}]`).join("\n");
const openai = (content) => ({ choices: [{ message: { content }, finish_reason: "stop" }] });
const hash = (value) => { let h = 2166136261; for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(16); };
const packId = "ny:pack:" + hash(JSON.stringify(source.data));
const runtimeKeys = ["result", "lastCount", "lastRound", "lastError", "lastRunFloor"];

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
  const browser = await chromium.launch({ executablePath: process.env.EPHONE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const calls = [], errors = [];
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
      const body = request.postDataJSON(), prompt = (body.messages || []).map((message) => message.content || "").join("\n");
      const daily = dailyReply(prompt);
      if (daily) return route.fulfill({ contentType: "application/json", body: JSON.stringify(daily) });
      calls.push({ primary, prompt, body, url });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(openai(response("GENERATED_PRIVATE_B"))) });
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady && window.EPhoneNY);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async ({ source, packId }) => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://ny-main.invalid/v1", apiKey: "fake-ny-primary", model: "claude-ny-reply-model",
        secondaryProxyUrl: "https://ny-aux.invalid/v1", secondaryApiKey: "fake-ny-auxiliary", secondaryModel: "ny-analysis-model" });
      const pack = window.EPhoneNyCore.parsePreset(source.data, source.filename);
      await window.db.spaceProfiles.put({ ...pack, id: packId, kind: "ny-pack" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      for (const id of ["ny-defaults-a", "ny-defaults-b", "ny-defaults-new", "ny-defaults-custom"]) await window.db.chats.put({ id, name: id,
        originalName: id, avatar, settings: { aiPersona: "独立生活的成年人角色。", maxMemory: 30, linkedWorldBookIds: [] },
        history: [{ role: "user", content: "NY_DEFAULT_SOURCE_" + id, timestamp: 100, vts: new Date(2026, 2, 5, 9).getTime() }], longTermMemory: [] });
      const promptOverrides = Object.fromEntries(pack.prompts.filter((entry) => /\{\{\s*xbgetvar::/i.test(entry.content)).map((entry) => [entry.id, true]));
      for (const [chatId, interval, count, marker] of [["ny-defaults-a", 13, 71, "LEGACY_PRIVATE_A"], ["ny-defaults-b", 41, 29, "LEGACY_PRIVATE_B"], ["ny-defaults-custom", 39, 93, "CUSTOM_PRIVATE_C"]]) {
        const state = window.EPhoneNyCore.defaults(pack);
        state.enabled = true; state.packId = packId; state.promptOverrides = promptOverrides;
        for (const kind of ["sigon", "sogon", "archive"]) if (state.tasks[kind]) {
          state.tasks[kind].enabled = true; state.tasks[kind].auto = false; state.tasks[kind].interval = interval;
        }
        state.tasks.sigon.prefs.historyDepth = 9;
        state.tasks.sigon.prefs.userPref = { enabled: true, text: "LEGACY_PREFERENCE_" + chatId };
        state.tasks.sigon.result = { tags: { summary: marker }, all: "[summary]" + marker + "[/summary]", packId, timestamp: 1 };
        state.tasks.sigon.lastCount = count; state.tasks.sigon.lastRound = count + 1000; state.tasks.sigon.lastError = "PRIVATE_ERROR_" + chatId;
        await window.db.spaceProfiles.put({ ...state, id: "ny:chat:" + chatId, chatId });
      }
    }, { source, packId });
    // The app caches provider settings on startup; load the seeded fake connection.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady && window.EPhoneNY);

    async function state(chatId) { return page.evaluate((id) => window.EPhoneNY.getState(id), chatId); }
    async function raw(chatId) { return page.evaluate((id) => window.db.spaceProfiles.get("ny:chat:" + id), chatId); }
    async function defaults() { return page.evaluate(() => window.db.spaceProfiles.get("ny:defaults")); }
    async function configureDefaults(patch) { return page.evaluate((value) => window.EPhoneNY.configureDefaults(value), patch); }
    async function prompt(chatId) { return page.evaluate(async (id) => window.EPhoneNY.prompt(await window.db.chats.get(id)), chatId); }
    async function until(predicate, description) {
      const deadline = Date.now() + 15000;
      while (!(await predicate())) { assert.ok(Date.now() < deadline, description); await page.waitForTimeout(25); }
    }
    async function selectAndRender(selector, value) {
      if (await page.locator(selector).inputValue() === value) return;
      const previous = await page.locator("#ny-interval").elementHandle();
      await page.locator(selector).selectOption(value);
      await page.waitForFunction((element) => !element.isConnected, previous);
      await page.waitForSelector("#ny-interval");
    }
    async function clickAndRender(selector) {
      const previous = await page.locator("#ny-interval").elementHandle();
      await page.locator(selector).click();
      await page.waitForFunction((element) => !element.isConnected, previous);
      await page.waitForSelector("#ny-interval");
    }
    function assertConfigOnly(value) {
      assert.ok(value, "space defaults should be stored");
      for (const task of Object.values(value.tasks || {})) for (const key of runtimeKeys) assert.equal(Object.hasOwn(task, key), false, "defaults must not contain per-chat " + key);
      assert.doesNotMatch(JSON.stringify(value), /LEGACY_PRIVATE_|CUSTOM_PRIVATE_C|GENERATED_PRIVATE_B|PRIVATE_ERROR_|POISON_DEFAULT_RESULT/);
    }
    async function assertReportsIsolated(aMarker = "LEGACY_PRIVATE_A", bMarker = "LEGACY_PRIVATE_B") {
      const a = await state("ny-defaults-a"), b = await state("ny-defaults-b"), fresh = await state("ny-defaults-new");
      assert.equal(a.tasks.sigon.result.tags.summary, aMarker);
      assert.equal(b.tasks.sigon.result.tags.summary, bMarker);
      assert.ok(!fresh.tasks.sigon.result, "a new chat inherits settings without another chat's report");
      assert.ok(!fresh.tasks.sigon.lastCount && !fresh.tasks.sigon.lastRound, "a new chat cannot inherit scheduling cursors");
      assert.doesNotMatch(await prompt("ny-defaults-a"), new RegExp(bMarker));
      assert.doesNotMatch(await prompt("ny-defaults-b"), new RegExp(aMarker));
      assertConfigOnly(await defaults());
    }

    const legacyA = await raw("ny-defaults-a"), legacyB = await raw("ny-defaults-b"), legacyC = await raw("ny-defaults-custom");
    // Select the existing configured chat before importing the actual local bundle.
    await page.evaluate(() => window.EPhoneNY.open("ny-defaults-a"));
    await page.locator("#ny-file").setInputFiles(fs.existsSync(bundlePath) ? bundlePath : {
      name: "NY_Claude_Gemini_本地导入包.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bundle))
    });
    await until(() => page.locator("#ny-notice").textContent().then((value) => value.includes("已导入")), "the actual combined bundle should finish importing");
    assert.equal(calls.length, 0, "opening and importing cannot call either provider");
    assert.equal(await page.locator("#ny-scope").inputValue(), "space", "settings open in the space-wide scope");
    for (const chatId of ["ny-defaults-a", "ny-defaults-b", "ny-defaults-new"]) {
      const resolved = await state(chatId);
      assert.equal(resolved.enabled, true);
      assert.equal(resolved.packId, packId);
      assert.equal(resolved.tasks.sigon.interval, 13, "legacy settings selected at import become shared defaults");
      assert.equal(resolved.tasks.sigon.prefs.userPref.text, "LEGACY_PREFERENCE_ny-defaults-a");
    }
    assert.equal((await raw("ny-defaults-b")).tasks.sigon.interval, 41, "migration preserves the legacy row instead of copying settings into every chat");
    assert.deepEqual((await raw("ny-defaults-a")).tasks.sigon.result, legacyA.tasks.sigon.result);
    assert.deepEqual((await raw("ny-defaults-b")).tasks.sigon.result, legacyB.tasks.sigon.result);
    assert.equal((await state("ny-defaults-a")).tasks.sigon.lastCount, 71);
    assert.equal((await state("ny-defaults-b")).tasks.sigon.lastCount, 29);
    await assertReportsIsolated();

    // Every active and disabled entry exposes its complete original text.
    const previews = await page.evaluate(() => ({
      expected: [], actual: [...document.querySelectorAll(".ny-prompt-details [data-ny-content]")].map((entry) => entry.textContent),
      elements: document.querySelectorAll(".ny-prompt-details script, .ny-prompt-details img").length
    }));
    previews.expected = await page.evaluate(async (id) => (await window.db.spaceProfiles.get(id)).prompts.filter((entry) => entry.content).map((entry) => entry.content), packId);
    assert.equal(previews.actual.length, previews.expected.length, "every source prompt receives a complete-content preview");
    previews.expected.forEach((text, index) => assert.ok(previews.actual[index] === text, "prompt preview " + index + " must preserve complete source text, whitespace and literal markup"));
    assert.equal(previews.elements, 0, "source HTML is previewed as text");
    const disabledPreview = page.locator(".ny-prompt-row").filter({ has: page.locator("input[data-ny-prompt]:disabled") }).first().locator(".ny-prompt-details");
    await disabledPreview.evaluate((entry) => { for (let node = entry; node; node = node.parentElement) if (node.tagName === "DETAILS") node.open = true; });
    await disabledPreview.locator("[data-ny-content]").scrollIntoViewIfNeeded();
    assert.equal(await disabledPreview.locator("[data-ny-content]").isVisible(), true, "disabled entries still expose their full content");
    assert.ok(previews.expected.some((text) => text.includes("<script>")), "the real source fixture includes literal script markup");
    const escapedFixture = "\nFULL_PREVIEW_START<script>window.__nyPreviewExecuted=true</script><img src=x onerror=window.__nyPreviewExecuted=true>\nFULL_PREVIEW_END";
    await page.evaluate(async ({ id, text }) => {
      const pack = await window.db.spaceProfiles.get(id);
      pack.prompts.push({ id: "ny-preview-literal", name: "完整原文安全预览", content: text, nativeEnabled: true, sourceEnabled: false });
      await window.db.spaceProfiles.put(pack); await window.EPhoneNY.open("ny-defaults-a");
    }, { id: packId, text: escapedFixture });
    assert.equal(await page.locator(".ny-prompt-details [data-ny-content]").last().textContent(), escapedFixture);
    assert.equal(await page.locator(".ny-prompt-details script, .ny-prompt-details img").count(), 0);
    assert.equal(await page.evaluate(() => window.__nyPreviewExecuted), undefined);
    assert.equal(calls.length, 0, "reading and expanding complete prompt content cannot call a provider");

    await configureDefaults({ tasks: { sigon: { interval: 17, prefs: { historyDepth: 11, userPref: { enabled: true, text: "SPACE_DEFAULT_V1" } },
      result: { tags: { summary: "POISON_DEFAULT_RESULT" } }, lastCount: 999, lastRound: 999, lastError: "POISON_DEFAULT_RESULT" } } });
    assertConfigOnly(await defaults());
    for (const chatId of ["ny-defaults-a", "ny-defaults-b", "ny-defaults-new"]) assert.equal((await state(chatId)).tasks.sigon.interval, 17);
    await page.evaluate(({ chatId, patch }) => window.EPhoneNY.configure(chatId, patch), { chatId: "ny-defaults-custom", patch: {
      enabled: true, packId, tasks: { sigon: { enabled: true, auto: false, interval: 33, prefs: { historyDepth: 6, userPref: { enabled: true, text: "CUSTOM_ONLY" } } } }
    } });
    assert.equal((await raw("ny-defaults-custom")).settingsMode, "custom", "public chat configure opts that chat into a personal configuration");
    assert.deepEqual((await state("ny-defaults-custom")).tasks.sigon.result, legacyC.tasks.sigon.result);

    // Saving the shared form changes every inheriting chat, preserving custom settings.
    await page.evaluate(() => window.EPhoneNY.open("ny-defaults-a"));
    await selectAndRender("#ny-scope", "space");
    await selectAndRender("#ny-kind", "sigon");
    await page.locator("#ny-interval").fill("23");
    await page.locator("#ny-prefs").fill("SPACE_DEFAULT_FROM_UI");
    await clickAndRender("#ny-save");
    await until(async () => (await defaults()).tasks.sigon.interval === 23, "space form save should finish writing");
    for (const chatId of ["ny-defaults-a", "ny-defaults-b", "ny-defaults-new"]) {
      assert.equal((await state(chatId)).tasks.sigon.interval, 23);
      assert.equal((await state(chatId)).tasks.sigon.prefs.userPref.text, "SPACE_DEFAULT_FROM_UI");
    }
    assert.equal((await state("ny-defaults-custom")).tasks.sigon.interval, 33);
    assert.equal((await state("ny-defaults-custom")).tasks.sigon.prefs.userPref.text, "CUSTOM_ONLY");
    await assertReportsIsolated();
    assert.equal(calls.length, 0, "API and UI settings saves cannot call either provider");

    await page.evaluate(() => window.EPhoneNY.useDefaults("ny-defaults-custom"));
    assert.equal((await state("ny-defaults-custom")).tasks.sigon.interval, 23);
    assert.deepEqual((await state("ny-defaults-custom")).tasks.sigon.result, legacyC.tasks.sigon.result, "following defaults preserves the custom chat's own report");
    assert.equal((await state("ny-defaults-custom")).tasks.sigon.lastCount, 93);
    assert.notEqual((await raw("ny-defaults-custom")).settingsMode, "custom");

    // The chat form can opt out and return to shared settings without touching reports.
    await selectAndRender("#ny-chat", "ny-defaults-b");
    await selectAndRender("#ny-scope", "chat");
    await selectAndRender("#ny-mode", "custom");
    await page.locator("#ny-interval").fill("37");
    await clickAndRender("#ny-save");
    await until(async () => (await state("ny-defaults-b")).tasks.sigon.interval === 37, "per-chat UI override should finish saving");
    assert.equal((await defaults()).tasks.sigon.interval, 23);
    assert.equal((await state("ny-defaults-a")).tasks.sigon.interval, 23);
    assert.deepEqual((await state("ny-defaults-b")).tasks.sigon.result, legacyB.tasks.sigon.result);
    await clickAndRender("#ny-follow");
    await until(async () => (await state("ny-defaults-b")).tasks.sigon.interval === 23, "follow-space UI should restore inherited settings");
    assert.deepEqual((await state("ny-defaults-b")).tasks.sigon.result, legacyB.tasks.sigon.result);
    assert.equal(calls.length, 0, "changing scope, overriding and following defaults never starts an analysis");

    // Even while editing space defaults, analysis targets only the selected chat.
    await selectAndRender("#ny-scope", "space");
    await page.locator("#ny-run").click();
    await until(async () => (await state("ny-defaults-b")).tasks.sigon.result?.tags.summary === "GENERATED_PRIVATE_B:summary", "selected-chat analysis should finish saving").catch(async (error) => {
      const diagnostic = await page.evaluate(async () => {
        const state = await window.EPhoneNY.getState("ny-defaults-b");
        return { notice: document.getElementById("ny-notice")?.textContent, enabled: state.enabled, mode: state.settingsMode,
          taskEnabled: state.tasks.sigon.enabled, summary: state.tasks.sigon.result?.tags.summary, busy: window.EPhoneNY.isBusy() };
      });
      throw new Error(error.message + " " + JSON.stringify({ ...diagnostic, calls: calls.map((call) => ({ primary: call.primary, url: call.url })) }), { cause: error });
    });
    await page.waitForFunction(() => !window.EPhoneNY.isBusy());
    assert.equal(calls.length, 1, "one manual analysis makes one auxiliary request");
    assert.equal(calls[0].primary, false);
    assert.match(calls[0].prompt, /NY_DEFAULT_SOURCE_ny-defaults-b/);
    assert.doesNotMatch(calls[0].prompt, /NY_DEFAULT_SOURCE_ny-defaults-a|LEGACY_PRIVATE_A|CUSTOM_PRIVATE_C/);
    assert.equal((await state("ny-defaults-a")).tasks.sigon.lastCount, 71);
    assert.equal((await state("ny-defaults-b")).tasks.sigon.lastCount, 1);
    assert.notEqual((await raw("ny-defaults-b")).settingsMode, "custom", "saving an inherited analysis cannot turn inherited settings into a custom snapshot");
    await assertReportsIsolated("LEGACY_PRIVATE_A", "GENERATED_PRIVATE_B:summary");
    await configureDefaults({ tasks: { sigon: { interval: 29 } } });
    assert.equal((await state("ny-defaults-b")).tasks.sigon.interval, 29, "report writes cannot freeze inherited settings");
    const generatedB = (await state("ny-defaults-b")).tasks.sigon.result;
    await page.evaluate(({ chatId, tags }) => window.EPhoneNY.saveReport(chatId, "sigon", tags), {
      chatId: "ny-defaults-b", tags: { ...generatedB.tags, summary: "MANUALLY_EDITED_PRIVATE_B" }
    });
    await configureDefaults({ tasks: { sigon: { interval: 31 } } });
    assert.equal((await state("ny-defaults-b")).tasks.sigon.interval, 31, "manual report saves also preserve inheritance");
    await assertReportsIsolated("LEGACY_PRIVATE_A", "MANUALLY_EDITED_PRIVATE_B");
    assert.equal(calls.length, 1, "report edits and subsequent shared saves make no provider requests");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady && window.EPhoneNY);
    for (const chatId of ["ny-defaults-a", "ny-defaults-b", "ny-defaults-new", "ny-defaults-custom"]) assert.equal((await state(chatId)).tasks.sigon.interval, 31, "shared configuration persists across reload");
    await assertReportsIsolated("LEGACY_PRIVATE_A", "MANUALLY_EDITED_PRIVATE_B");
    await page.evaluate(() => window.EPhoneNY.open("ny-defaults-b"));
    const screenshot = path.join(process.env.TEMP || __dirname, "ephone-ny-defaults-mobile.png");
    await page.screenshot({ path: screenshot });
    assert.deepEqual(errors, []);
    console.log("SCREENSHOT " + screenshot);
    console.log("PASS: real bundle migration to shared defaults, complete escaped active/disabled prompt previews, config-only storage, legacy/custom/new-chat isolation, shared and per-chat form saves, follow-defaults report preservation, selected-chat analysis and report edits preserving inheritance, no provider traffic on settings/review, reload persistence");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
