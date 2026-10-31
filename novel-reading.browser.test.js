// Complete app in an isolated mobile viewport and IndexedDB. No paid requests.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(__dirname, "." + (name === "/" ? "/index.html" : name));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const errors = [], apiCalls = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await context.route("**/*", route => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (/\/chat\/completions/.test(url)) apiCalls.push(url);
      return route.abort();
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    const until = async (predicate, message) => { const end = Date.now() + 10000; while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(message); };
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    const ids = await page.evaluate(async () => {
      const chapters = [1, 2, 3].map(timestamp => ({ title: "章节" + timestamp, timestamp, summary: "摘要" + timestamp,
        content: (timestamp === 2 ? "公式 $\\frac{1}{2}$。\n\n" : "") + Array.from({ length: 120 }, (_, i) => "第" + timestamp + "章第" + i + "段：他从窗边走回书桌，认真看完手里的信，又把它折好放回信封。\n\n").join("") }));
      return [await window.db.grStories.add({ title: "书甲", chapters, lastUpdated: 100, settings: {} }),
        await window.db.grStories.add({ title: "书乙", chapters: structuredClone(chapters), lastUpdated: 200, settings: {} })];
    });
    const book = id => page.evaluate(id => window.db.grStories.get(id), id);
    const host = page.locator("#gr-reader-content");
    const open = async title => { await page.evaluate(() => window.openGreenRiverScreen()); await page.locator("#gr-book-list .gr-book-card").filter({ hasText: title }).click(); await page.waitForSelector("#gr-reader-screen.active"); await page.evaluate(() => document.fonts.ready); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
    const choose = async index => { await page.evaluate(() => window.openChapterList()); await page.locator(".gr-sidebar-item").nth(index).click(); await until(() => page.locator("#gr-chapter-title-display").textContent().then(value => value.includes("章节" + (index + 1))), "selected chapter not opened"); await page.evaluate(() => document.fonts.ready); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
    const scroll = async ratio => { const top = await host.evaluate((node, ratio) => { node.dispatchEvent(new Event("touchstart")); node.scrollTop = (node.scrollHeight - node.clientHeight) * ratio; return node.scrollTop; }, ratio); await page.waitForTimeout(400); return top; };
    const near = async top => assert.ok(Math.abs(await host.evaluate(node => node.scrollTop) - top) < 5, "restored the same reading coordinate");
    await open("书甲"); await choose(1); let aTop = await scroll(.43);
    const textOffset = () => host.evaluate(node => node.querySelector(".gr-chapter-text").getBoundingClientRect().top - node.getBoundingClientRect().top);
    await until(async () => (await book(ids[0])).readingPosition?.scrollTop > 100, "A position not saved");
    assert.equal((await book(ids[0])).readingPosition.chapterIndex, 1);
    await open("书乙"); const bTop = await scroll(.21);
    await until(async () => (await book(ids[1])).readingPosition?.scrollTop > 100, "B position not saved");
    await open("书甲"); await near(aTop); assert.match(await page.locator("#gr-chapter-title-display").textContent(), /章节2/);
    assert.equal((await book(ids[0])).lastUpdated, 100, "reading progress cannot alter writing or bookshelf chronology");
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await open("书乙"); await near(bTop); await open("书甲"); await near(aTop);
    const beforeRename = await textOffset();
    await page.locator("#gr-edit-chapter-btn").click(); await page.waitForSelector("#gr-chapter-edit-modal.visible");
    await page.locator("#gr-edit-chapter-title").fill("只是改标题"); await page.locator("#gr-edit-chapter-save").click(); await page.waitForSelector("#gr-chapter-edit-modal.visible", { state: "hidden" }); await page.waitForTimeout(100);
    assert.ok(Math.abs(await textOffset() - beforeRename) < 5, "renaming preserves the same body line even if the heading wraps");
    aTop = await host.evaluate(node => node.scrollTop);
    await page.evaluate(() => window.openChapterList()); await page.locator(".gr-catalog-delete").first().click(); await page.locator("#gr-delete-chapter-confirm").click(); await page.waitForSelector("#gr-chapter-delete-modal.visible", { state: "hidden" });
    await page.waitForTimeout(100); await near(aTop); assert.equal((await book(ids[0])).readingPosition.chapterIndex, 0);
    assert.match(await page.locator("#gr-chapter-title-display").textContent(), /只是改标题/);
    await page.evaluate(() => window.closeChapterList()); await page.locator("#gr-delete-chapter-btn").click(); await page.locator("#gr-delete-chapter-confirm").click(); await page.waitForSelector("#gr-chapter-delete-modal.visible", { state: "hidden" });
    await page.waitForTimeout(100); await near(0); assert.match(await page.locator("#gr-chapter-title-display").textContent(), /章节3/);
    await open("书乙"); await near(bTop); await choose(2); await near(0); const nextTop = await scroll(.35);
    await open("书甲"); await open("书乙"); await near(nextTop); assert.match(await page.locator("#gr-chapter-title-display").textContent(), /章节3/);
    // Close/reload immediately after a real scroll notification, before the
    // debounced IndexedDB save. The tiny pending-coordinate journal recovers it.
    const immediateTop = await host.evaluate(node => { node.dispatchEvent(new Event("touchstart")); node.scrollTop = (node.scrollHeight - node.clientHeight) * .58; node.dispatchEvent(new Event("scroll")); return node.scrollTop; });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await open("书乙"); await near(immediateTop);
    await page.evaluate(() => window.openGreenRiverScreen()); const retained = (await book(ids[1])).readingPosition.scrollTop; await page.waitForTimeout(500);
    assert.equal((await book(ids[1])).readingPosition.scrollTop, retained, "hidden reader dimensions never overwrite progress with zero");
    assert.equal(apiCalls.length, 0); assert.deepEqual(errors, []);
    console.log("PASS: mobile full-app per-book chapter/scroll restoration, reload, fonts, rename, preceding/current chapter deletion, explicit navigation, hidden-page safety and no API requests");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
