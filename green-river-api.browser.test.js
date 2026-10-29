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
  const calls = [], errors = [], dialogs = [], held = []; let failPrimary = false, invalidPrimary = "", lengthReason = false, holdPrimary = false, serial = 0;
  const chapter = (n) => ({ title: "第" + n + "章 <约定>", content: "完整小说正文" + n + "：\n" + "日常散步和整理旧书的完整细节。".repeat(80) + '\n<约定>照旧。<img src=x onerror="window.__greenRiverInjected=true">' + "CHAPTER_END_" + n, summary: "本章总结" + n + '：</textarea><img src=x onerror="window.__greenRiverInjected=true">' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message)); page.on("dialog", (dialog) => { dialogs.push(dialog.message()); return dialog.accept(); });
    await page.route("**/*", async (route) => {
      const request = route.request(), url = request.url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      const native = url.startsWith("https://generativelanguage.googleapis.com/"), primary = native || url.startsWith("https://gr-primary.invalid/");
      if (!primary && !url.startsWith("https://gr-auxiliary.invalid/")) return route.abort();
      const body = request.postDataJSON(), prompt = JSON.stringify(body); calls.push({ primary, native, url, body, prompt });
      if (native) { assert.ok(url.includes("novel-native-model")); assert.equal(new URL(url).searchParams.get("key"), "fake-native-primary"); }
      else { assert.equal(body.model, primary ? "novel-primary-model" : "auxiliary-model"); assert.equal(request.headers().authorization, primary ? "Bearer fake-primary" : "Bearer fake-auxiliary"); }
      if (primary && failPrimary) return route.fulfill({ status: 503, body: "isolated novel provider failure" });
      if (primary && holdPrimary) { held.push({ route, native }); return; }
      const raw = primary && invalidPrimary === "malformed" ? "这是一段没有完整JSON结构的中断回复" : JSON.stringify(primary ? invalidPrimary === "missing" ? { title: "缺少正文", summary: "不应覆盖旧章" } : chapter(++serial) : { result: "auxiliary remains independent" });
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
    const reroll = async (expected = true) => { const before = JSON.stringify((await stories())[0].chapters), n = dialogs.length; await page.locator("#gr-reroll-btn").click(); await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click(); await finish(before, expected, n); };
    const config = async (patch) => { await page.evaluate(async (patch) => window.db.apiConfig.update("main", patch), patch); await ready(); await openBook(); };
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
    await page.locator("#gr-story-title").fill("旧书店的一天"); await page.locator('#gr-char-list input[value="gr-group"]').check(); await page.locator("#gr-macro-world-view").fill("现代日常故事，人物保持真实关系。");
    await page.locator("#gr-save-story-btn").click(); await page.waitForSelector("#gr-reader-screen.active"); assert.equal(calls.length, 0, "creating and reviewing story settings does not call a provider");
    await generate("三人在旧书店重逢。"); assert.equal(calls.length, 1); assert.equal(calls.at(-1).primary, true);
    assert.equal((await stories())[0].chapters[0].content, chapter(1).content);
    assert.equal(await page.locator("#gr-reader-content .gr-chapter-text").textContent(), chapter(1).content, "novel text including literal angle brackets remains complete on screen");
    assert.equal(await page.locator("#gr-reader-content textarea").first().inputValue(), chapter(1).summary, "summary text cannot close its textarea or inject markup");
    assert.equal(await page.locator("#gr-reader-content img").count(), 0); assert.equal(await page.evaluate(() => !!window.__greenRiverInjected), false);
    const firstPrompt = calls.at(-1).prompt;
    for (const marker of ["NEW_MENTOR_PROFILE", "NEW_PLAYER_PROFILE", "FULL_NPC_PROFILE", "RELATION_ONLY_DIRECTORY", "SELECTED_GROUP_MEMORY", "FULL_HISTORY_TAIL"]) assert.ok(firstPrompt.includes(marker), "novel must include " + marker);
    assert.doesNotMatch(firstPrompt, /OUTSIDER_NOT_SELECTED/);
    await generate("接着一起整理旧书。"); assert.equal(calls.length, 2); assert.equal(calls.at(-1).primary, true);
    assert.ok(calls.at(-1).prompt.includes("CHAPTER_END_1"), "continuation reads complete prior chapter, not just its summary");
    assert.deepEqual((await stories())[0].chapters.map((c) => c.content), [chapter(1).content, chapter(2).content]);
    await reroll(); assert.equal(calls.length, 3); assert.equal(calls.at(-1).primary, true);
    assert.deepEqual((await stories())[0].chapters.map((c) => c.content), [chapter(1).content, chapter(3).content], "reroll replaces the last chapter once");
    assert.ok(calls.at(-1).prompt.includes("CHAPTER_END_1")); assert.doesNotMatch(calls.at(-1).prompt, /CHAPTER_END_2/, "reroll excludes the chapter being replaced");
    await page.locator('#gr-reader-screen [title="设定"]').click(); await page.waitForSelector("#gr-settings-modal.visible");
    await page.locator("#gr-user-persona-select").selectOption("7"); await page.locator('#gr-worldbook-list input[value="9"]').check(); await page.locator("#gr-save-story-btn").click(); await page.waitForSelector("#gr-reader-screen.active");
    const beforeMissingAux = calls.length; await config({ secondaryApiKey: "", secondaryModel: "" }); await generate("这一章没有副API也能创作。");
    assert.equal(calls.length, beforeMissingAux + 1); assert.equal(calls.at(-1).primary, true);
    assert.match(calls.at(-1).prompt, /EXPLICIT_USER_PRESET_COMPLETE/); assert.match(calls.at(-1).prompt, /EXPLICIT_WORLD_BOOK_COMPLETE/); assert.doesNotMatch(calls.at(-1).prompt, /DISABLED_WORLD_BOOK_ENTRY/);
    const preserved = (await stories())[0].chapters;
    failPrimary = true; await reroll(false); failPrimary = false; assert.deepEqual((await stories())[0].chapters, preserved, "failed reroll preserves existing complete chapters");
    for (const invalid of ["malformed", "missing"]) {
      invalidPrimary = invalid; const beforeInvalid = calls.length; await reroll(false); invalidPrimary = "";
      assert.equal(calls.length, beforeInvalid + 1, "invalid output uses one main request without automatic retry"); assert.equal(calls.at(-1).primary, true);
      assert.deepEqual((await stories())[0].chapters, preserved, "malformed or missing novel body cannot replace the old chapter");
    }
    await config({ apiKey: "" }); const beforeMissingMain = calls.length; await reroll(false);
    assert.equal(calls.length, beforeMissingMain, "missing primary credentials do not spend on auxiliary API"); assert.deepEqual((await stories())[0].chapters, preserved, "missing main configuration must not remove the last chapter");
    assert.ok(dialogs.some((s) => s.includes("主 API")));
    await config({ apiKey: "fake-primary" });
    await page.evaluate(async () => { const story = (await window.db.grStories.toArray())[0]; await window.db.grStories.update(story.id, { settings: { ...story.settings, referenceSpaceDatabase: "another-persona-space" } }); });
    const beforeForeignSpace = calls.length; await reroll(false); assert.equal(calls.length, beforeForeignSpace, "foreign-space references must stop before any request"); assert.deepEqual((await stories())[0].chapters, preserved); assert.match(dialogs.at(-1), /另一个空间/);
    await page.evaluate(async () => { const story = (await window.db.grStories.toArray())[0]; await window.db.grStories.update(story.id, { settings: { ...story.settings, referenceSpaceDatabase: window.db.spaceProfiles.db.name } }); });
    await config({ proxyUrl: "https://generativelanguage.googleapis.com/v1beta/models", apiKey: "fake-native-primary", model: "novel-native-model", secondaryApiKey: "fake-auxiliary", secondaryModel: "auxiliary-model" });
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
    assert.deepEqual(errors, []);
    console.log("PASS: Green River creation/continuation/reroll use one primary compatible/native request; complete group/NPC/bound-player profiles, relations, history, numeric explicit identity/worldbook and prior chapter retained; literal markup safe; failed/malformed/missing-primary rerolls preserve chapters; duplicate pending tap and work navigation isolated; cross-space refs rejected; auxiliary remains independent");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
