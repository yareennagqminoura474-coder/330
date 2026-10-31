// Isolated mobile reader/IndexedDB; only one fake generation request is made.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core"), core = require("./novel-chapters.js");
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(__dirname, "." + (new URL(req.url, "http://localhost").pathname === "/" ? "/index.html" : new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const generated = '林澈停下来，回头说：“这回让我把话说完。”\n门外的脚步声慢了下来。', calls = [], errors = [], alerts = [];
  let pending;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => { alerts.push(dialog.message()); return dialog.accept(); });
    await page.route("**/*", route => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://chapter-test.invalid/")) { calls.push(route.request().postDataJSON()); pending = route; return; }
      return route.abort();
    });
    const until = async (predicate, message) => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error(message); };
    const ready = async () => { await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); };
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    const seed = [
      { title: "旧的一章", content: "ORIGINAL_FIRST_BODY。\n这是原来的第一章。", summary: "STALE_FIRST_SUMMARY", timestamp: 1 },
      { title: "要删的中间章", content: "DELETED_MIDDLE_BODY。", summary: "DELETED_MIDDLE_SUMMARY", timestamp: 2 },
      { title: "保留的末章", content: "RETAINED_TAIL_BODY。", summary: "RETAINED_TAIL_SUMMARY", timestamp: 3 }
    ];
    const id = await page.evaluate(async chapters => {
      const config = await window.db.apiConfig.get("main") || { id: "main" };
      await window.db.apiConfig.put({ ...config, proxyUrl: "https://chapter-test.invalid/v1", apiKey: "fake-test", model: "fake-novel-model" });
      await window.db.chats.put({ id: "chapter-role", name: "林澈", settings: { aiPersona: "成年教师，有独立生活。", myPersona: "成年同事。", myNickname: "我" }, history: [] });
      const authorId = await window.db.grAuthors.add({ name: "章节测试作者", style: "自然" });
      return window.db.grStories.add({ title: "章节管理", authorId, settings: { charIds: ["chapter-role"], bookIds: [], outputLength: 5000, generationApi: "primary", streamOutput: true }, chapters, lastUpdated: Date.now() });
    }, seed);
    const story = () => page.evaluate(id => window.db.grStories.get(id), id);
    const open = async () => { await page.evaluate(() => window.openGreenRiverScreen()); await page.locator("#gr-book-list .gr-book-card").filter({ hasText: "章节管理" }).click(); await page.waitForSelector("#gr-reader-screen.active"); };
    const catalog = async () => { await page.evaluate(() => window.openChapterList()); await page.waitForSelector("#gr-chapter-sidebar.visible"); };
    await ready(); await open(); await catalog();
    assert.deepEqual(await page.locator(".gr-catalog-count").allTextContents(), seed.map(ch => core.count(ch.content).toLocaleString() + " 字"));
    await page.locator(".gr-catalog-edit").first().click(); await page.waitForSelector("#gr-chapter-edit-modal.visible");
    const edited = 'EDITED_FIRST_BODY_ONLY。\n林澈说：“先把门关上，我们再慢慢说。”\n<img src=x onerror="window.__chapterInjected=true">';
    await page.locator("#gr-edit-chapter-content").fill(edited); await page.locator("#gr-title-from-body-btn").click();
    assert.equal(await page.locator("#gr-edit-chapter-title").inputValue(), "先把门关上，我们再慢慢说。");
    assert.equal(await page.locator("#gr-edit-chapter-count").textContent(), core.count(edited).toLocaleString() + " 字");
    await page.locator("#gr-edit-chapter-title").fill("手动标题 <标签>");
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-novel-chapter-editor-mobile.png") });
    await page.locator("#gr-edit-chapter-save").click(); await page.waitForSelector("#gr-chapter-edit-modal.visible", { state: "hidden" });
    assert.equal((await story()).chapters[0].content, edited); assert.equal((await story()).chapters[0].summaryStale, true);
    assert.equal((await story()).chapters[0].summary, "STALE_FIRST_SUMMARY"); assert.equal((await story()).chapters[0].wordCount, core.count(edited));
    assert.equal(await page.locator("#gr-reader-content img").count(), 0); assert.equal(await page.evaluate(() => !!window.__chapterInjected), false);
    assert.equal(calls.length, 0, "editing, counting and extracting a title do not use an API");
    await catalog(); await page.locator(".gr-sidebar-item").last().click(); await page.locator("#gr-next-chapter-btn").click();
    await page.locator("#gr-generate-btn").click(); await until(() => !!pending, "generation not sent");
    await catalog(); assert.equal(await page.locator(".gr-catalog-edit").first().isDisabled(), true); assert.equal(await page.locator(".gr-catalog-delete").first().isDisabled(), true);
    const prompt = JSON.stringify(calls[0]); assert.match(prompt, /EDITED_FIRST_BODY_ONLY/); assert.doesNotMatch(prompt, /STALE_FIRST_SUMMARY|ORIGINAL_FIRST_BODY/);
    await pending.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: '<novel_title>虚构的浮世辉光</novel_title><novel_content>' + generated + '</novel_content><novel_summary>他们决定把话说清楚。</novel_summary>' }, finish_reason: "stop" }] }) }); pending = null;
    await until(async () => (await story()).chapters.length === 4 && !await page.locator("#gr-generate-btn").isDisabled(), "generation not committed");
    assert.equal((await story()).chapters.at(-1).title, "这回让我把话说完。"); assert.equal((await story()).chapters.at(-1).wordCount, core.count(generated));
    await page.evaluate(() => window.closeChapterList()); await catalog();
    await page.locator(".gr-sidebar-item").first().click();
    await page.locator("#gr-reader-content textarea").fill("已更新的第一章接续摘要"); await page.locator("#gr-reader-content .save-summary-btn").click();
    await until(async () => (await story()).chapters[0].summaryStale === false, "inline summary save did not validate the edited chapter's checkpoint");
    assert.equal((await story()).chapters[1].prevSummary, "已更新的第一章接续摘要");
    await catalog();
    await page.locator(".gr-catalog-delete").nth(1).click(); await page.waitForSelector("#gr-chapter-delete-modal.visible");
    await page.locator("#gr-delete-chapter-cancel").click(); assert.equal((await story()).chapters.length, 4);
    await page.locator(".gr-catalog-delete").nth(1).click(); await page.waitForSelector("#gr-chapter-delete-modal.visible"); await page.locator("#gr-delete-chapter-confirm").click();
    await page.waitForSelector("#gr-chapter-delete-modal.visible", { state: "hidden" });
    assert.deepEqual((await story()).chapters.map(ch => ch.content), [edited, seed[2].content, generated]);
    assert.equal((await story()).lastGeneration.chapterIndex, 2); assert.equal(await page.locator(".gr-sidebar-item").count(), 3);
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-novel-chapter-catalog-mobile.png") });
    await ready(); await open(); await catalog();
    assert.deepEqual(await page.locator(".gr-catalog-count").allTextContents(), [edited, seed[2].content, generated].map(body => core.count(body).toLocaleString() + " 字"));
    await page.locator(".gr-catalog-edit").first().click(); await page.waitForSelector("#gr-chapter-edit-modal.visible");
    await page.evaluate(async id => { const book = await window.db.grStories.get(id); book.chapters[0].title = "另一个页面已修改"; await window.db.grStories.put(book); }, id);
    await page.locator("#gr-edit-chapter-title").fill("不得覆盖的新标题"); await page.locator("#gr-edit-chapter-save").click();
    await until(() => page.locator("#gr-edit-chapter-status").textContent().then(text => text.includes("章节已在其他位置改变")), "a stale editor overwrote a concurrent change");
    assert.equal((await story()).chapters[0].title, "另一个页面已修改"); await page.locator("#gr-edit-chapter-cancel").click();
    await page.context().setOffline(true);
    while ((await story()).chapters.length) {
      await catalog(); await page.locator(".gr-catalog-delete").last().click(); await page.waitForSelector("#gr-chapter-delete-modal.visible"); await page.locator("#gr-delete-chapter-confirm").click(); await page.waitForSelector("#gr-chapter-delete-modal.visible", { state: "hidden" });
    }
    assert.equal((await story()).lastGeneration, null); assert.equal(await page.locator("#gr-chapter-tools").isVisible(), false);
    assert.equal(await page.locator(".gr-sidebar-item").count(), 0); assert.match(await page.locator("#gr-reader-content").textContent(), /故事尚未开始/);
    assert.equal(calls.length, 1); assert.deepEqual(errors, []); assert.deepEqual(alerts, []);
    console.log("PASS: mobile chapter editing/deletion/count persistence, literal safe prose, local title extraction, stale-summary exclusion, actual generated title validation, busy/conflict guards, retained later chapters and offline empty-book deletion without extra API calls");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
