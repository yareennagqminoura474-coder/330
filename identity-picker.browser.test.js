// Mobile identity selection with many roles. Isolated data; no AI/API calls.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname), file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const members = Array.from({ length: 36 }, (_, i) => ({ id: "picker-role-" + i, originalName: "角色" + String(i + 1).padStart(2, "0") + (i === 3 ? "（这是一个用于检查换行的较长角色名字）" : ""), avatar, persona: "有独立性格的成年人。" }));
      const history = Array.from({ length: 80 }, (_, i) => ({ role: "assistant", senderName: members[i % members.length].originalName, type: "text", content: "用于检查关闭列表后仍能正常滑动的聊天消息 " + i, timestamp: 1000 + i }));
      for (const [id, watch] of [["picker-watch", true], ["picker-group", false]]) await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: watch, members, history, settings: { myNickname: "我", maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] } });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    const cdp = await page.context().newCDPSession(page);
    async function swipe(scroller, direction) {
      const b = await scroller.boundingBox(), x = b.x + b.width / 2, start = b.y + b.height * (direction === "down" ? .8 : .2), end = b.y + b.height * (direction === "down" ? .2 : .8);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: start }] });
      for (let step = 1; step <= 10; step++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: start + (end - start) * step / 10 }] }); await page.waitForTimeout(20); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(180);
    }
    async function openChat(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click(); await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active");
    }
    async function checkTop(list, label) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await list.evaluate((el) => { el.scrollTop = 0; });
      const geometry = await list.evaluate((el) => {
        const first = el.querySelector(".payment-option-item"), r = el.getBoundingClientRect(), f = first.getBoundingClientRect();
        const css = getComputedStyle(el);
        return { top: r.top, firstTop: f.top, firstBottom: f.bottom, height: r.height, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, justify: css.justifyContent, align: css.alignItems, wrap: css.flexWrap, direction: css.flexDirection, overflow: css.overflowY };
      });
      assert.ok(geometry.firstTop >= geometry.top - 1 && geometry.firstBottom <= geometry.top + geometry.height + 1, label + ": first role must be fully reachable at scrollTop=0 " + JSON.stringify(geometry));
      const r = await page.locator("#custom-modal-overlay > #custom-modal").boundingBox();
      assert.ok(r.y >= -1 && r.y + r.height <= page.viewportSize().height + 1, label + ": modal stays inside the viewport");
    }
    // Opening an input dialog leaves bottom-aligned footer styling on the shared modal.
    // The identity list must start at the top regardless of its previous use.
    await page.evaluate(() => window.showScreen("api-settings-screen")); await page.locator("#save-api-preset-btn").click();
    await page.locator("#custom-modal-overlay.visible #custom-modal-cancel").click();
    for (const [id, watch] of [["picker-watch", true], ["picker-group", false]]) {
      await openChat(id);
      const previousStyle = await page.locator("#custom-modal > .custom-modal-footer").first().getAttribute("style");
      const trigger = page.locator(watch ? '[data-spectator-action="identity"]' : "#send-as-character-btn");
      await trigger.click(); await page.waitForSelector("#custom-modal-overlay.visible");
      const list = page.locator("#custom-modal > .custom-modal-footer").first();
      await checkTop(list, id + " initial");
      while (await list.getByRole("button", { name: /加载更多/ }).isVisible()) {
        await list.getByRole("button", { name: /加载更多/ }).click();
        await checkTop(list, id + " after loading more");
      }
      assert.equal(await list.locator(".payment-option-item").count(), watch ? 36 : 37);
      await swipe(list, "down"); assert.ok(await list.evaluate((el) => el.scrollTop) > 0, "touch can scroll towards later roles");
      await list.evaluate((el) => { el.scrollTop = 70; }); await swipe(list, "up");
      assert.ok(await list.evaluate((el) => el.scrollTop) < 70, "touch can return towards the first roles");
      await checkTop(list, id + " after touch back to top");
      await list.getByRole("button", { name: watch ? "以 角色01 的身份说话" : "以 角色01 的身份发送", exact: true }).click();
      await page.waitForSelector("#custom-modal-overlay.visible", { state: "hidden" });
      assert.match(await trigger.innerText(), /角色01/);
      await trigger.click(); await page.waitForSelector("#custom-modal-overlay.visible"); await checkTop(list, id + " reopened");
      await page.setViewportSize({ width: 390, height: 420 }); await checkTop(list, id + " keyboard-sized viewport");
      if (watch) {
        const screenshot = path.join(require("node:os").tmpdir(), "ephone-identity-picker-v187.png"); await page.screenshot({ path: screenshot }); console.log("SCREENSHOT " + screenshot);
      }
      await list.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(await list.getAttribute("style"), previousStyle, "other dialogs recover their original footer layout");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { document.activeElement?.blur(); }); await page.waitForTimeout(250);
      const messages = page.locator("#chat-messages"), beforeScroll = await messages.evaluate((el) => { el.scrollTop = (el.scrollHeight - el.clientHeight) / 2; return el.scrollTop; }); await swipe(messages, "up");
      const chatScroll = await messages.evaluate((el) => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight, box: el.getBoundingClientRect().toJSON(), hit: document.elementFromPoint(el.getBoundingClientRect().x + el.clientWidth / 2, el.getBoundingClientRect().y + el.clientHeight / 2)?.outerHTML.slice(0, 220), css: getComputedStyle(el).touchAction }));
      assert.ok(chatScroll.top < beforeScroll, "chat stays touch-scrollable after closing identity picker " + JSON.stringify(chatScroll));
      await trigger.click(); await page.waitForSelector("#custom-modal-overlay.visible");
      await page.locator("#custom-modal-overlay").click({ position: { x: 5, y: 5 } });
      await page.waitForSelector("#custom-modal-overlay.visible", { state: "hidden" });
      assert.equal(await page.locator("#custom-modal-overlay").evaluate((el) => el.classList.contains("ephone-choice-open")), false, "backdrop dismissal cleans up choice layout too");
    }
    assert.deepEqual(errors, []);
    console.log("PASS: many-role watch/normal identity pickers, first-role reachability after loading/reopening, native touch scrolling, short viewport and chat scrolling after close");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
