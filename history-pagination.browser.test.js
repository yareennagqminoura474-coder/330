// Real mobile DOM and rendering; test-only hooks never ship in the app.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const lateImages = [];
  const server = http.createServer((req, res) => {
    const file = path.resolve(__dirname, "." + (new URL(req.url, "http://localhost").pathname === "/" ? "/index.html" : new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    let body = fs.readFileSync(file);
    if (file.endsWith(path.sep + "script.js")) body = body.toString().replace("  async function _0x57e676(", `
      window.__historyTest = { render: _0x57e676, append: _0xbb356a, load: _0x1dfcdf,
        state: _0x5ea3c1, busy: () => _0x5baa4a,
        pageSize: (n) => _0x5ea3c1.globalSettings[_0x3ce505(0x180c)] = n };
      async function _0x57e676(`);
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.includes("/late-history.svg")) { lateImages.push(route); return; }
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async (origin) => {
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      for (const id of ["history-watch", "history-normal", "history-private"]) {
        const history = Array.from({ length: 230 }, (_, i) => ({ role: "assistant", type: i % 7 === 0 ? "narration" : "text", senderName: "林", content: `消息${i}：连续的历史记录。`, timestamp: i === 211 ? 99999999 : 100000 + i, vts: 1772676000000, ...(i % 19 === 0 ? { isHidden: true } : {}) }));
        if (id === "history-watch") Object.assign(history[195], { type: "ai_image", imageUrl: origin + "/late-history.svg", content: "延迟加载的图片。" });
        await window.db.chats.put({ id, name: id, originalName: "林", avatar, isGroup: id !== "history-private", isSpectatorGroup: id === "history-watch", members: [{ id: "role", originalName: "林", groupNickname: "林", avatar }], history,
          relationship: { status: "friend" }, settings: { myNickname: "我", aiPersona: "成年人", maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] } });
      }
    }, origin);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function open(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active");
      await page.waitForFunction(() => document.querySelectorAll("#chat-messages .message-wrapper").length >= 20);
      await page.evaluate(() => { window.__historyTest.pageSize(25); return window.__historyTest.render(window.__historyTest.state.activeChatId); });
      await page.waitForTimeout(50);
    }
    const rows = () => page.locator("#chat-messages > .message-wrapper").evaluateAll((nodes) => nodes.map((node) => Number(node.querySelector("[data-timestamp]")?.dataset.timestamp ?? node.dataset.timestamp)).filter(Number.isFinite));
    async function continuous() {
      const actual = await rows();
      const expected = await page.evaluate((first) => {
        const history = window.__historyTest.state.chats[window.__historyTest.state.activeChatId].history;
        return history.slice(history.findIndex((m) => m.timestamp === first)).filter((m) => !m.isHidden).map((m) => m.timestamp);
      }, actual[0]);
      assert.deepEqual(actual, expected, "all displayed records form a continuous suffix, including non-monotonic edited IDs");
    }
    async function load() {
      return page.evaluate(async () => {
        const scroller = document.getElementById("chat-messages");
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
        scroller.scrollTop = 0;
        const node = scroller.querySelector(".message-wrapper"), before = node.getBoundingClientRect().top;
        await Promise.all([window.__historyTest.load(), window.__historyTest.load()]);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { before, after: node.getBoundingClientRect().top };
      });
    }
    for (const id of ["history-watch", "history-normal", "history-private"]) {
      await open(id);
      await page.evaluate(async () => {
        const test = window.__historyTest, chat = test.state.chats[test.state.activeChatId];
        for (let i = 0; i < 80; i++) {
          const message = { role: "assistant", type: "text", senderName: "林", content: `新增${i}`, timestamp: 200000 + i, vts: 1772676000000 };
          chat.history.push(message); await test.append(message, chat);
        }
      });
      assert.ok((await rows()).length > 100, "new replies cannot silently evict already loaded messages");
      await continuous();
      for (let i = 0; i < 10; i++) {
        const anchor = await load(); assert.ok(Math.abs(anchor.after - anchor.before) < 2, `${id} page ${i}: reading anchor moved: ${JSON.stringify(anchor)}`);
        await continuous();
        if (id === "history-watch" && i === 0) {
          await page.waitForFunction(() => !!document.querySelector('img[src$="/late-history.svg"]'));
          const oldRow = page.locator('.message-bubble[data-timestamp="100205"]').locator("..");
          const before = (await oldRow.boundingBox()).y;
          while (lateImages.length === 0) await page.waitForTimeout(20);
          for (const route of lateImages.splice(0)) await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="600"><rect width="200" height="600" fill="lightblue"/></svg>' });
          await page.waitForFunction(() => document.querySelector('img[src$="/late-history.svg"]').complete);
          await page.waitForTimeout(80);
          assert.ok(Math.abs((await oldRow.boundingBox()).y - before) < 2, "late image decoding preserves the same reading anchor");
        }
      }
      assert.equal((await rows())[0], 100001, "pagination reaches the true beginning (first row is hidden)");
      await page.evaluate(() => document.getElementById("chat-messages").scrollTop = 400);
      await page.waitForTimeout(50);
      assert.ok(await page.locator("#chat-messages").evaluate((el) => el.scrollTop > 300), "scroll remains usable after loading all history");
    }
    // Opening a chat or appending an image leaves delayed load callbacks behind.
    // Once the reader starts paging backwards those callbacks must not jump back
    // to the latest reply, even if the image finally arrives much later.
    for (const mode of ["initial", "append"]) {
      await open("history-watch");
      await page.evaluate(async ({ origin, mode }) => {
        const test = window.__historyTest, chat = test.state.chats[test.state.activeChatId];
        const image = { role: "assistant", type: "ai_image", senderName: "林", content: "新图片延迟到达。", imageUrl: origin + "/late-history.svg?" + mode, timestamp: mode === "initial" ? 300000 : 300001 };
        chat.history.push(image);
        if (mode === "initial") await test.render(chat.id);
        else await test.append(image, chat);
      }, { origin, mode });
      await page.waitForTimeout(50);
      await load();
      const anchor = page.locator("#chat-messages > .message-wrapper").filter({ has: page.locator("[data-timestamp]") }).first();
      const before = (await anchor.boundingBox()).y;
      while (lateImages.length === 0) await page.waitForTimeout(20);
      for (const route of lateImages.splice(0)) await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="600"><rect width="200" height="600" fill="lightblue"/></svg>' });
      await page.waitForFunction(() => Array.from(document.querySelectorAll('#chat-messages img[src*="late-history.svg"]')).every((img) => img.complete));
      await page.waitForTimeout(80);
      assert.ok(Math.abs((await anchor.boundingBox()).y - before) < 2, `${mode}: delayed image cannot scroll a reader back to the bottom`);
      await continuous();
    }
    // A loading operation must never prepend rows into a different chat.
    await open("history-watch");
    await page.evaluate(async () => {
      const test = window.__historyTest, loading = test.load();
      test.state.activeChatId = "history-normal";
      await Promise.all([loading, test.render("history-normal")]);
    });
    await continuous();
    assert.deepEqual(errors, []);
    console.log("PASS: mobile watch/normal/private history stays contiguous after long replies, repeated/duplicate loads, hidden rows, edited IDs and chat switches; reading anchor and scrolling preserved");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
