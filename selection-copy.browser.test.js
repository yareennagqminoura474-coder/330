const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname, file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const errors = [], requests = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message)); page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (/chat\/completions|generateContent/.test(url)) requests.push(url);
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([{ id: "other", name: "测试目标空间" }]));
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      await window.db.chats.put({ id: "copy-owner", name: "甲", originalName: "甲", avatar, history: [{ role: "user", content: "旧的聊天内容", timestamp: 1 }], longTermMemory: ["旧总结"], settings: { aiPersona: "普通家庭成年人，甲是乙的同事", aiAvatar: avatar, myPersona: "原私聊用户", maxMemory: 20 } });
      await window.db.chats.put({ id: "copy-watch", name: "观看测试群", isGroup: true, isSpectatorGroup: true, history: [{ role: "user", content: "旧群消息", timestamp: 2 }], settings: { myPersona: "旧对象", maxMemory: 20 }, members: [{ id: "copy-owner", originalName: "甲", groupNickname: "甲同事", persona: "旧资料", ephonePersonaOverride: false }] });
      await window.db.userWallet.put({ id: "main", balance: 200, kinshipCards: [] });
      const cart = [
        { item: { id: "tea", name: "原味奶茶", kind: "food", price: 10.15, deliveryFee: 2.35, deliveryMinutes: 30, merchant: "茶饮店", emoji: "🍵" }, quantity: 2 },
        { item: { id: "snack", name: "芋泥点心", kind: "food", price: 5.2, deliveryFee: 4, deliveryMinutes: 30, merchant: "茶饮店", emoji: "🍰" }, quantity: 1 },
        { item: { id: "book", name: "随身笔记本", kind: "goods", price: 9.99, merchant: "文具店", emoji: "📘" }, quantity: 3 },
      ];
      await window.db.marketState.put({ ...window.ephoneLifeMarketCore.blank(), cart });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#life-market-home").click(); await page.locator('[data-tab="cart"]').click();
    assert.equal(await page.locator("[data-cart-check]:checked").count(), 3);
    await page.locator('[data-cart-check="snack"]').uncheck(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    await page.locator('[data-cart-check="book"]').uncheck(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.match(await page.locator(".market-checkout").innerText(), /22\.65/);
    assert.equal(await page.locator("#market-select-all").evaluate((e) => e.indeterminate), true);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#life-market-home").click(); await page.locator('[data-tab="cart"]').click();
    assert.equal(await page.locator("[data-cart-check]:checked").count(), 1, "selection persists across reload");
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-selection-v1799.png") });
    await page.locator('[data-action="checkout"]').click(); await page.locator('[data-action="pay"]').click();
    await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(await page.locator(".market-order-line").count(), 1);
    assert.match(await page.locator(".market-order").innerText(), /原味奶茶/); assert.doesNotMatch(await page.locator(".market-order").innerText(), /芋泥点心|随身笔记本/);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 177.35);
    await page.locator('[data-tab="cart"]').click(); assert.equal(await page.locator(".market-cart-line").count(), 2);
    assert.equal(await page.locator('[data-action="checkout"]').isDisabled(), true);
    await page.locator("#market-select-all").check(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.match(await page.locator(".market-checkout").innerText(), /39\.17/);
    await page.locator('[data-action="checkout"]').click(); await page.locator('[data-action="pay"]').click();
    await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(await page.locator(".market-order").count(), 2);
    assert.equal(await page.evaluate(async () => window.db.userTransactions.count()), 5);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 138.18);
    // Exercise the real long-press menu, not only the data-copy API.
    await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
    const row = page.locator('.chat-list-item[data-chat-id="copy-watch"]');
    const box = await row.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.waitForSelector("#chat-list-actions-modal.visible"); await page.mouse.up();
    await page.locator("#chat-list-action-copy").click();
    await page.waitForSelector("#ephone-persona-spaces-modal.visible");
    assert.match(await page.locator("#ephone-spaces-description").innerText(), /不会复制聊天、记忆、钱包/);
    await page.locator(".ephone-space-option").filter({ hasText: "测试目标空间" }).click();
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-copy-v1799.png") });
    await page.locator(".ephone-spaces-move-button").click(); await page.waitForSelector("#ephone-persona-spaces-modal.visible", { state: "hidden" });
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("copy-watch")).history.length), 1);
    await page.evaluate(() => window.EPhoneSpaces.switchSpace("other"));
    const copied = await page.evaluate(async () => ({ chats: await window.db.chats.toArray(), memories: await window.db.memories.count(), balance: (await window.db.userWallet.get("main"))?.balance || 0, binding: await window.ephonePlayerIdentity.load(window.db) }));
    assert.equal(copied.chats.length, 2); assert.equal(copied.memories, 0); assert.equal(copied.balance, 0); assert.equal(copied.binding, null);
    const group = copied.chats.find((c) => c.isSpectatorGroup), role = copied.chats.find((c) => !c.isGroup);
    assert.equal(group.members[0].id, role.id); assert.equal(group.members[0].persona, role.settings.aiPersona);
    assert.ok(copied.chats.every((c) => !c.history.length && !c.longTermMemory.length));
    assert.notEqual(group.id, "copy-watch"); assert.notEqual(role.id, "copy-owner");
    await page.locator('.nav-item[data-view="messages-view"]').click(); await page.locator(`.chat-list-item[data-chat-id="${group.id}"]`).click();
    await page.waitForSelector("#chat-interface-screen.active");
    await page.evaluate(() => window.showScreen("chat-list-screen"));
    await page.locator(`.chat-list-item[data-chat-id="${role.id}"]`).click();
    await page.waitForSelector("#chat-interface-screen.active");
    await page.evaluate(() => window.EPhoneSpaces.switchSpace("default"));
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("copy-owner")).history.length), 1);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 138.18);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    console.log("PASS: mobile persistent selection, partial/all/separate checkout and per-item bills, actual long-press copy UI, member profiles, empty history/memory/balance/binding, copied spectator opens, switching preserves original space, no API calls or page errors");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
