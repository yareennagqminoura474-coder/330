// Real mobile app/UI and IndexedDB; all provider traffic is intercepted.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname), file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const calls = [], errors = [], dialogs = [], held = []; let failPrimary = false, invalidPrimary = "", responseFormat = "json", lengthReason = false, holdPrimary = false, serial = 0;
  const chapter = (n) => ({ title: "第" + n + "章 <约定>", content: "完整小说正文" + n + "：\n" + (n === 1 ? "陈安正在整理书架。" : n === 2 ? "林澈把旧书摆上柜台。" : "") + "日常散步和整理旧书的完整细节。".repeat(80) + '\n<约定>照旧。<img src=x onerror="window.__greenRiverInjected=true">' + "CHAPTER_END_" + n + "，数学符号（$\\in$ 与 $\\notin$）。", summary: "本章总结" + n + '：</textarea><img src=x onerror="window.__greenRiverInjected=true">' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message)); page.on("dialog", (dialog) => { dialogs.push(dialog.message()); return dialog.accept(); });
    await page.route("**/*", async (route) => {
      const request = route.request(), url = request.url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      const native = url.startsWith("https://generativelanguage.googleapis.com/"), primary = native ? new URL(url).searchParams.get("key") === "fake-native-primary" : url.startsWith("https://gr-primary.invalid/");
      if (!native && !primary && !url.startsWith("https://gr-auxiliary.invalid/")) return route.abort();
      const body = request.postDataJSON(), prompt = JSON.stringify(body), novel = prompt.includes("写作任务");
      const call = { primary, native, novel, url, body, prompt }; calls.push(call);
      if (native) { assert.ok(url.includes(primary ? "novel-native-model" : "novel-native-aux-model")); assert.equal(new URL(url).searchParams.get("key"), primary ? "fake-native-primary" : "fake-native-secondary"); }
      else { assert.equal(body.model, primary ? "novel-primary-model" : "auxiliary-model"); assert.equal(request.headers().authorization, primary ? "Bearer fake-primary" : "Bearer fake-auxiliary"); }
      if (novel && failPrimary) return route.fulfill({ status: 503, body: "isolated novel provider failure" });
      if (novel && holdPrimary) { held.push({ route, native }); return; }
      let raw;
      if (!novel) raw = JSON.stringify({ result: "auxiliary remains independent" });
      else if (invalidPrimary === "malformed") raw = '{"title":"结构无效，无可恢复的正文", "summary":';
      else if (invalidPrimary === "missing") raw = JSON.stringify({ title: "缺少正文", summary: "不应覆盖旧章" });
      else {
        const result = chapter(++serial); call.expected = result;
        if (responseFormat === "plain") raw = result.content;
        else if (responseFormat === "tags") raw = '<novel_title>' + result.title + '</novel_title>\n<novel_content>' + result.content + '</novel_content>\n<novel_summary>' + result.summary + '</novel_summary>';
        else if (responseFormat === "loose-json") raw = '{"title":' + JSON.stringify(result.title) + ',"content":"' + result.content + '","summary":' + JSON.stringify(result.summary) + '}';
        else if (responseFormat === "partial-tags") raw = '<novel_title>' + result.title + '</novel_title>\n<novel_content>' + result.content;
        else raw = JSON.stringify(result);
      }
      call.raw = raw;
      const response = native ? { candidates: [{ content: { parts: [{ text: raw }] }, finishReason: lengthReason ? "MAX_TOKENS" : "STOP" }] } : { choices: [{ message: { content: raw }, finish_reason: lengthReason ? "length" : "stop" }] };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
    });
    const ready = async () => { await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); };
    const stories = () => page.evaluate(() => window.db.grStories.toArray());
    const openBook = async () => { await page.evaluate(() => window.openGreenRiverScreen()); await page.locator("#gr-book-list .gr-book-card").first().click(); await page.waitForSelector("#gr-reader-screen.active"); await page.evaluate(() => window.openChapterList()); await page.locator("#gr-chapter-list-content .gr-sidebar-item").last().click(); await page.waitForSelector("#gr-writing-controls:visible"); };
    const settle = () => page.waitForFunction(() => !document.getElementById("gr-generate-btn").disabled);
    const finish = async (before, expected, beforeDialogs) => {
      if (expected) await page.waitForFunction(async (before) => !document.getElementById("gr-generate-btn").disabled && JSON.stringify((await window.db.grStories.toArray())[0].chapters) !== before, before);
      else { const deadline = Date.now() + 10000; while (dialogs.length === beforeDialogs && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20)); assert.ok(dialogs.length > beforeDialogs, "failed generation must explain failure"); }
      await settle();
    };
    const generate = async (direction) => { const before = JSON.stringify((await stories())[0].chapters), n = dialogs.length; await page.locator("#gr-direction-input").fill(direction); await page.locator("#gr-generate-btn").click(); await finish(before, true, n); };
    const reroll = async (expected = true) => { const before = JSON.stringify((await stories())[0].chapters), n = dialogs.length; await page.locator("#gr-reroll-btn").click(); await page.locator("#gr-rewrite-modal.visible #gr-rewrite-direct").click(); await finish(before, expected, n); };
    const config = async (patch) => { await page.evaluate(async (patch) => window.db.apiConfig.update("main", patch), patch); await ready(); await openBook(); };
    const chooseApi = async (value) => {
      const before = calls.length;
      await page.locator('#gr-reader-screen [title="设定"]').click(); await page.waitForSelector("#gr-settings-modal.visible");
      await page.locator("#gr-generation-api").selectOption(value); await page.locator("#gr-save-story-btn").click(); await page.waitForSelector("#gr-reader-screen.active");
      assert.equal((await stories())[0].settings.generationApi, value); assert.equal(calls.length, before, "choosing an API must not send a generation request");
    };
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main") || { id: "main" };
      await window.db.apiConfig.put({ ...config, proxyUrl: "https://gr-primary.invalid/v1", apiKey: "fake-primary", model: "novel-primary-model", secondaryProxyUrl: "https://gr-auxiliary.invalid/v1", secondaryApiKey: "fake-auxiliary", secondaryModel: "auxiliary-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const base = { avatar, history: [], settings: { aiAvatar: avatar, myNickname: "原用户", myPersona: "OLD_DEFAULT_USER", maxMemory: 20 }, longTermMemory: [] };
      await window.db.chats.put({ ...base, id: "gr-mentor", name: "林清洲", originalName: "林清洲", settings: { ...base.settings, aiPersona: "NEW_MENTOR_PROFILE：成年教师，喜欢旧书，不擅长烹饪，沉静认真。" } });
      await window.db.chats.put({ ...base, id: "gr-player", name: "林澈", originalName: "林澈", settings: { ...base.settings, aiPersona: "NEW_PLAYER_PROFILE：成年研究助理，开朗好奇，家境普通，有独立生活。" } });
      await window.db.chats.put({ ...base, id: "gr-outsider", name: "无关角色", originalName: "无关角色", settings: { ...base.settings, aiPersona: "OUTSIDER_NOT_SELECTED" } });
      await window.db.npcs.put({ id: 501, name: "陈安", persona: "FULL_NPC_PROFILE：成年书店店长，耐心细致，有自己的工作与朋友。", avatar });
      await window.db.chats.put({ ...base, id: "gr-group", name: "旧书群", isGroup: true, isSpectatorGroup: true,
        members: [{ id: "gr-mentor", originalName: "林清洲", groupNickname: "老师", persona: "OLD_MENTOR_SNAPSHOT", ephonePersonaOverride: false, avatar },
          { id: "gr-player", originalName: "林澈", groupNickname: "小林", persona: "OLD_PLAYER_SNAPSHOT", ephonePersonaOverride: false, avatar },
          { id: "npc_501", originalName: "陈安", isNpc: true, persona: "OLD_NPC_SNAPSHOT", ephonePersonaOverride: false, avatar }],
        settings: { ...base.settings, aiPersona: "PLACEHOLDER_GROUP_ONLY", linkedMemoryChatIds: [], linkedWorldBookIds: [] },
        history: [{ role: "assistant", type: "text", senderName: "林澈", timestamp: 100, vts: new Date(2026, 2, 5, 10).getTime(), content: "他拿起手机核对藏书目录。" + "这段真正的聊天内容必须完整保留。".repeat(12) + "FULL_HISTORY_TAIL" }],
        longTermMemory: [{ content: "SELECTED_GROUP_MEMORY：三人约好了周末在旧书店整理书架。", timestamp: 99 }] });
      await window.db.spaceProfiles.put({ id: "player", key: "chat:gr-player", name: "林澈" });
      await window.db.characterRelations.put({ id: JSON.stringify(["chat:gr-mentor", "chat:gr-player"].sort()), a: "chat:gr-mentor", b: "chat:gr-player", aToB: "师弟", bToA: "师兄", detail: "RELATION_ONLY_DIRECTORY：这是同门师兄弟，双方没有父子关系。", source: "manual", revision: 1 });
      await window.db.personaPresets.put({ id: 7, name: "明确指定的身份", persona: "EXPLICIT_USER_PRESET_COMPLETE：成年修复师，独立生活的身份设定。" });
      await window.db.worldBooks.put({ id: 9, name: "旧书店设定", content: [{ comment: "营业时间", content: "EXPLICIT_WORLD_BOOK_COMPLETE：旧书店周六上午十点营业。", enabled: true }, { content: "DISABLED_WORLD_BOOK_ENTRY", enabled: false }] });
    });
    await ready(); await page.evaluate(() => window.openGreenRiverScreen());
    await page.locator('#green-river-screen [title="新建作品"]').click(); await page.waitForSelector("#gr-settings-modal.visible");
    assert.equal(await page.locator("#gr-generation-api").inputValue(), "primary", "new and legacy works default to the previously selected primary API");
    await page.locator("#gr-story-title").fill("旧书店的一天"); await page.locator('#gr-char-list input[value="gr-group"]').check(); await page.locator("#gr-macro-world-view").fill("现代日常故事，人物保持真实关系。");
    await page.locator("#gr-save-story-btn").click(); await page.waitForSelector("#gr-reader-screen.active"); assert.equal(calls.length, 0, "creating and reviewing story settings does not call a provider");
    await generate("三人在旧书店重逢。"); assert.equal(calls.length, 1); assert.equal(calls.at(-1).primary, true);
    assert.equal((await stories())[0].chapters[0].content, chapter(1).content);
    assert.equal((await stories())[0].lastGeneration.http.transport, "browser xhr", "public direct novel requests use progress-preserving HTTP reception");
    assert.ok((await page.locator("#gr-reader-content .gr-chapter-text").textContent()).startsWith(chapter(1).content.split("数学符号")[0]), "novel prose including literal angle brackets remains complete on screen");
    assert.equal(await page.locator("#gr-reader-content .gr-chapter-text .katex").count(), 2, "saved formulas are typeset from their original source");
    assert.equal(await page.locator("#gr-reader-content textarea").first().inputValue(), chapter(1).summary, "summary text cannot close its textarea or inject markup");
    assert.equal(await page.locator("#gr-reader-content img").count(), 0); assert.equal(await page.evaluate(() => !!window.__greenRiverInjected), false);
    const firstPrompt = calls.at(-1).prompt;
    for (const marker of ["NEW_MENTOR_PROFILE", "NEW_PLAYER_PROFILE", "FULL_NPC_PROFILE", "RELATION_ONLY_DIRECTORY", "SELECTED_GROUP_MEMORY", "FULL_HISTORY_TAIL"]) assert.ok(firstPrompt.includes(marker), "novel must include " + marker);
    assert.doesNotMatch(firstPrompt, /OUTSIDER_NOT_SELECTED/);
    await generate("接着一起整理旧书。"); assert.equal(calls.length, 2); assert.equal(calls.at(-1).primary, true);
    assert.ok(calls.at(-1).prompt.includes("CHAPTER_END_1"), "continuation reads complete prior chapter, not just its summary");
    assert.match(calls.at(-1).prompt, /陈安：首次文字线索在第1章，最近在第1章/, "a character mentioned in an older body is not lost when the summary omits their name");
    assert.match(calls.at(-1).prompt, /人设是人物理解事情、取舍和行动的背景/);
    assert.deepEqual((await stories())[0].chapters.map((c) => c.content), [chapter(1).content, chapter(2).content]);
    await reroll(); assert.equal(calls.length, 3); assert.equal(calls.at(-1).primary, true);
    assert.deepEqual((await stories())[0].chapters.map((c) => c.content), [chapter(1).content, chapter(3).content], "reroll replaces the last chapter once");
    assert.ok(calls.at(-1).prompt.includes("CHAPTER_END_1")); assert.doesNotMatch(calls.at(-1).prompt, /CHAPTER_END_2/, "reroll excludes the chapter being replaced");
    assert.doesNotMatch(calls.at(-1).prompt, /林澈：首次文字线索/, "a discarded rewrite chapter cannot establish a character's prior appearance");
    assert.deepEqual(await page.locator("#gr-reader-content .gr-chapter-text annotation").allTextContents(), ["\\in", "\\notin"]);
    const beforeChoice = calls.length, beforeChoiceChapters = (await stories())[0].chapters;
    await page.locator("#gr-direction-input").fill("DO_NOT_USE_NEXT_CHAPTER_DRAFT");
    await page.locator("#gr-reroll-btn").click(); await page.waitForSelector("#gr-rewrite-modal.visible");
    assert.equal(await page.locator("#gr-rewrite-described").isDisabled(), true);
    await page.locator("#gr-rewrite-cancel").click(); assert.equal(calls.length, beforeChoice);
    assert.deepEqual((await stories())[0].chapters, beforeChoiceChapters);
    await reroll(); assert.equal(calls.length, beforeChoice + 1);
    assert.doesNotMatch(calls.at(-1).prompt, /DO_NOT_USE_NEXT_CHAPTER_DRAFT/);
    assert.match(calls.at(-1).prompt, /接着一起整理旧书/);
    assert.equal(await page.locator("#gr-direction-input").inputValue(), "DO_NOT_USE_NEXT_CHAPTER_DRAFT");
    const beforeDescribed = JSON.stringify((await stories())[0].chapters), describedCalls = calls.length;
    await page.locator("#gr-reroll-btn").click(); await page.locator("#gr-rewrite-description").fill("让店长先解释旧书来历，保留原来人物关系。DESCRIBED_REWRITE");
    await page.locator("#gr-rewrite-described").click(); await finish(beforeDescribed, true, dialogs.length);
    assert.equal(calls.length, describedCalls + 1); assert.match(calls.at(-1).prompt, /DESCRIBED_REWRITE/);
    assert.doesNotMatch(calls.at(-1).prompt, /DO_NOT_USE_NEXT_CHAPTER_DRAFT/);
    assert.equal((await stories())[0].chapters.length, beforeChoiceChapters.length);
    assert.match((await stories())[0].chapters.at(-1).generationDirection, /DESCRIBED_REWRITE/);
    await page.locator('#gr-reader-screen [title="设定"]').click(); await page.waitForSelector("#gr-settings-modal.visible");
    await page.locator("#gr-user-persona-select").selectOption("7"); await page.locator('#gr-worldbook-list input[value="9"]').check(); await page.locator("#gr-save-story-btn").click(); await page.waitForSelector("#gr-reader-screen.active");
    const beforeMissingAux = calls.length; await config({ secondaryApiKey: "", secondaryModel: "" }); await generate("这一章没有副API也能创作。");
    assert.equal(calls.length, beforeMissingAux + 1); assert.equal(calls.at(-1).primary, true);
    assert.match(calls.at(-1).prompt, /EXPLICIT_USER_PRESET_COMPLETE/); assert.match(calls.at(-1).prompt, /EXPLICIT_WORLD_BOOK_COMPLETE/); assert.doesNotMatch(calls.at(-1).prompt, /DISABLED_WORLD_BOOK_ENTRY/);
    const preserved = (await stories())[0].chapters;
    failPrimary = true; await reroll(false); failPrimary = false; assert.deepEqual((await stories())[0].chapters, preserved, "failed reroll preserves existing complete chapters");
    assert.equal((await stories())[0].lastGeneration.http.status, 503);
    assert.equal((await stories())[0].lastGeneration.raw, "", "a failed new HTTP response cannot keep displaying the prior generation's paid result as its own diagnostics");
    for (const invalid of ["malformed", "missing"]) {
      invalidPrimary = invalid; const beforeInvalid = calls.length; await reroll(false); invalidPrimary = "";
      assert.equal(calls.length, beforeInvalid + 1, "invalid output uses one main request without automatic retry"); assert.equal(calls.at(-1).primary, true);
      assert.deepEqual((await stories())[0].chapters, preserved, "malformed or missing novel body cannot replace the old chapter");
      const savedReturn = (await stories())[0].lastGeneration;
      assert.equal(savedReturn.status, "error"); assert.equal(savedReturn.raw, calls.at(-1).raw, "an unsuccessful parse retains the complete paid provider output locally");
      if (invalid === "malformed") await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-green-river-return-mobile.png") });
      const beforeView = calls.length; await page.locator("#gr-last-response-btn").click(); await page.waitForSelector("#gr-last-response-modal.visible");
      assert.equal(await page.locator("#gr-last-response-content").inputValue(), calls.at(-1).raw);
      await page.locator("#gr-last-response-close").click(); assert.equal(calls.length, beforeView, "reviewing the saved output makes no API request");
    }
    await config({ apiKey: "" }); const beforeMissingMain = calls.length; await reroll(false);
    assert.equal(calls.length, beforeMissingMain, "missing primary credentials do not spend on auxiliary API"); assert.deepEqual((await stories())[0].chapters, preserved, "missing main configuration must not remove the last chapter");
    assert.ok(dialogs.some((s) => s.includes("主 API")));
    await config({ apiKey: "fake-primary" });
    await page.evaluate(async () => { const story = (await window.db.grStories.toArray())[0]; await window.db.grStories.update(story.id, { settings: { ...story.settings, referenceSpaceDatabase: "another-persona-space" } }); });
    const beforeForeignSpace = calls.length; await reroll(false); assert.equal(calls.length, beforeForeignSpace, "foreign-space references must stop before any request"); assert.deepEqual((await stories())[0].chapters, preserved); assert.match(dialogs.at(-1), /另一个空间/);
    await page.evaluate(async () => { const story = (await window.db.grStories.toArray())[0]; await window.db.grStories.update(story.id, { settings: { ...story.settings, referenceSpaceDatabase: window.db.spaceProfiles.db.name } }); });
    for (const format of ["tags", "loose-json", "plain", "partial-tags"]) {
      responseFormat = format; const beforeRecovery = calls.length; await generate("检查完整正文格式兼容：" + format);
      assert.equal(calls.length, beforeRecovery + 1, "format recovery is entirely local and must not call a second API");
      const latest = (await stories())[0], expected = calls.at(-1).expected;
      assert.equal(latest.chapters.at(-1).content, expected.content, "recover all prose from " + format);
      assert.equal(latest.lastGeneration.raw, calls.at(-1).raw, "retain the exact provider return for " + format);
      assert.equal(latest.lastGeneration.status, "saved");
      if (format === "partial-tags") assert.equal(latest.lastGeneration.partial, true, "a missing closing tag is marked partial rather than pretending the chapter completed");
    }
    responseFormat = "json";
    await chooseApi("secondary"); await ready(); await openBook();
    await page.locator('#gr-reader-screen [title="设定"]').click(); await page.waitForSelector("#gr-settings-modal.visible");
    assert.equal(await page.locator("#gr-generation-api").inputValue(), "secondary", "the per-work selection survives reload and reopening settings");
    await page.locator("#gr-cancel-settings-btn").click();
    await config({ apiKey: "", secondaryApiKey: "fake-auxiliary", secondaryModel: "auxiliary-model" });
    const beforeSecondary = calls.length; await generate("这个作品明确使用副API写正文。");
    assert.equal(calls.length, beforeSecondary + 1); assert.equal(calls.at(-1).primary, false); assert.equal(calls.at(-1).novel, true);
    assert.equal((await stories())[0].lastGeneration.api, "secondary");
    const secondaryPreserved = (await stories())[0].chapters;
    await config({ apiKey: "fake-primary", secondaryApiKey: "" });
    const beforeMissingSecondary = calls.length; await reroll(false);
    assert.equal(calls.length, beforeMissingSecondary, "a missing selected auxiliary API must not fall back to an available primary API");
    assert.deepEqual((await stories())[0].chapters, secondaryPreserved); assert.match(dialogs.at(-1), /副 API/);
    await config({ secondaryProxyUrl: "https://generativelanguage.googleapis.com/v1beta/models", secondaryApiKey: "fake-native-secondary", secondaryModel: "novel-native-aux-model" });
    const beforeNativeSecondary = calls.length; await generate("原生Gemini副API写作。");
    assert.equal(calls.length, beforeNativeSecondary + 1); assert.equal(calls.at(-1).native, true); assert.equal(calls.at(-1).primary, false);
    await chooseApi("primary");
    await config({ proxyUrl: "https://generativelanguage.googleapis.com/v1beta/models", apiKey: "fake-native-primary", model: "novel-native-model", secondaryProxyUrl: "https://gr-auxiliary.invalid/v1", secondaryApiKey: "fake-auxiliary", secondaryModel: "auxiliary-model" });
    lengthReason = true; const beforeNative = calls.length; await generate("原生Gemini继续这个故事。"); lengthReason = false;
    assert.equal(calls.length, beforeNative + 1); assert.equal(calls.at(-1).native, true); assert.equal(calls.at(-1).primary, true);
    assert.equal((await stories())[0].chapters.at(-1).content, chapter(serial).content, "a provider length flag alone cannot discard valid complete returned content");
    const beforeAuxiliary = calls.length; assert.match(await page.evaluate(() => window.EPhoneMarketAdapter.generate("OTHER_AUXILIARY_TASK")), /auxiliary remains independent/);
    assert.equal(calls.length, beforeAuxiliary + 1); assert.equal(calls.at(-1).primary, false); assert.equal(calls.at(-1).body.model, "auxiliary-model");
    // A second tap while a request is pending cannot spend twice; navigating to
    // another work cannot redirect the first work's result into that new work.
    holdPrimary = true; const beforeHeld = calls.length, source = (await stories())[0], sourceCount = source.chapters.length;
    await page.locator("#gr-direction-input").fill("继续原来的旧书店故事。"); await page.locator("#gr-generate-btn").evaluate((button) => { button.click(); button.click(); });
    const deadline = Date.now() + 10000; while (!held.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(held.length, 1); assert.equal(calls.length, beforeHeld + 1);
    const otherId = await page.evaluate(async () => { const story = structuredClone((await window.db.grStories.toArray())[0]); delete story.id; return window.db.grStories.add({ ...story, title: "导航测试另一作品", chapters: [], lastUpdated: Date.now() + 1 }); });
    await page.evaluate(() => window.openGreenRiverScreen()); await page.locator("#gr-book-list .gr-book-card").filter({ hasText: "导航测试另一作品" }).click(); await page.waitForSelector("#gr-reader-screen.active");
    assert.equal(await page.locator("#gr-book-name-display").textContent(), "导航测试另一作品");
    holdPrimary = false;
    for (const { route, native } of held.splice(0)) { const raw = JSON.stringify(chapter(++serial)); await route.fulfill({ contentType: "application/json", body: JSON.stringify(native ? { candidates: [{ content: { parts: [{ text: raw }] }, finishReason: "STOP" }] } : { choices: [{ message: { content: raw }, finish_reason: "stop" }] }) }); }
    await page.waitForFunction(async ({ id, count }) => (await window.db.grStories.get(id)).chapters.length === count, { id: source.id, count: sourceCount + 1 });
    await settle();
    assert.equal((await page.evaluate((id) => window.db.grStories.get(id), otherId)).chapters.length, 0); assert.equal(calls.length, beforeHeld + 1);
    assert.equal(await page.locator("#gr-book-name-display").textContent(), "导航测试另一作品", "background completion does not switch the visible work");
    holdPrimary = true; const beforeStop = calls.length;
    await page.locator("#gr-direction-input").fill("等待时可以由用户停止，不付费重试。"); await page.locator("#gr-generate-btn").click();
    const stopDeadline = Date.now() + 10000; while (!held.length && Date.now() < stopDeadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(held.length, 1); assert.equal(calls.length, beforeStop + 1);
    assert.equal(await page.locator("#gr-stop-generation-btn").isVisible(), true, "a slow pending request exposes a stop action");
    assert.ok((await page.locator("#gr-generation-status-text").textContent()).trim());
    await page.locator("#gr-stop-generation-btn").click(); await settle();
    assert.equal((await page.evaluate((id) => window.db.grStories.get(id), otherId)).chapters.length, 0, "stopping cannot create a fake chapter");
    assert.equal(calls.length, beforeStop + 1, "stopping does not retry or switch provider");
    for (const { route } of held.splice(0)) await route.abort().catch(() => {}); holdPrimary = false;
    assert.deepEqual(errors, []);
    console.log("PASS: Green River saved primary/auxiliary choices and compatible/native routing, complete character/relationship/history context, local JSON/tag/plaintext recovery and exact retained output, safe literal prose, failure preservation, no fallback or retries, pending stop/duplicate-tap/navigation isolation");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
