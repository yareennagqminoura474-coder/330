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
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (/chat\/completions|generateContent/.test(url)) requests.push(url);
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([{ id: "other", name: "另一空间" }]));
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      await window.db.chats.put({ id: "owner", name: "甲", originalName: "甲", avatar, history: [], settings: { aiPersona: "普通家庭成年人", aiAvatar: avatar, maxMemory: 20 } });
      for (const [id, name, watch] of [["watch", "观看群", true], ["normal", "普通群", false]]) await window.db.chats.put({ id, name, avatar, isGroup: true, isSpectatorGroup: watch,
        history: [], settings: { maxMemory: 20, myNickname: "我" }, members: [{ id: "owner", originalName: "甲", groupNickname: "甲", persona: "成年人", avatar }] });
      await window.ephonePlayerIdentity.save(window.db, "chat:owner"); await window.db.userWallet.put({ id: "main", balance: 200, kinshipCards: [] });
      await window.db.marketState.put({ ...window.ephoneLifeMarketCore.blank(), cart: [
        { item: { id: "book", name: "练习册", kind: "goods", price: 7.5, merchant: "书店", emoji: "📘" }, quantity: 2 },
        { item: { id: "rice", name: "盖浇饭", kind: "food", price: 8, merchant: "饭店", deliveryFee: 2, deliveryMinutes: 30, emoji: "🍚" }, quantity: 1 },
      ] });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
    await page.locator('.chat-list-item[data-chat-id="owner"]').click(); await page.waitForSelector("#chat-interface-screen.active");
    await page.evaluate(() => window.EPhoneLifeMarket.open()); await page.locator('[data-tab="cart"]').click();
    assert.equal(await page.locator('#market-card-destination option').count(), 4, "auto, none, normal and spectator groups");
    await page.locator("#market-card-destination").selectOption(JSON.stringify({ chatId: "watch" }));
    await page.locator("#market-card-destination").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-order-destination-v17102.png") });
    await page.locator('[data-action="checkout"]').click(); await page.locator('[data-action="pay"]').click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(await page.locator(".market-order").count(), 1);
    const old = await page.evaluate(async () => (await window.db.marketOrders.toArray())[0]);
    assert.equal(old.chatId, "watch"); assert.equal(old.recipientChatId, "owner"); assert.equal(old.total, 25);
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("owner")).history.length), 0);
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("watch")).history.length), 1);
    assert.equal(await page.locator('[data-action="post-order"]').isDisabled(), true);
    await page.locator('[data-order-destination]').selectOption(JSON.stringify({ chatId: "normal" }));
    await page.locator('[data-action="post-order"]').click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    await page.locator('[data-action="post-order"]').click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("normal")).history.length), 1);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 175);
    assert.match(await page.locator(".market-message").innerText(), /已有.*没有重复/);
    for (const id of ["watch", "normal"]) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active");
      await page.waitForSelector("#chat-messages .market-chat-card");
      assert.equal(await page.locator(".market-chat-card").count(), 1); assert.match(await page.locator(".market-chat-card").innerText(), /练习册/);
    }
    await page.evaluate(() => window.EPhoneLifeMarket.open({ tab: "orders" }));
    await page.locator('[data-action="buy-again"]').click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(await page.locator(".market-cart-line").count(), 2); assert.match(await page.locator(".market-message").innerText(), /尚未扣款/);
    assert.equal(await page.evaluate(async () => window.db.marketOrders.count()), 1); assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 175);
    assert.deepEqual(await page.evaluate(async (id) => (await window.db.marketOrders.get(id)).items, old.id), old.items);
    await page.locator('.market-cart-line').filter({ hasText: "练习册" }).locator('[data-delta="-1"]').click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.match(await page.locator(".market-checkout").innerText(), /17\.50/);
    await page.locator("#market-card-destination").selectOption("none");
    await page.locator('[data-action="checkout"]').click(); await page.locator('[data-action="pay"]').click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(await page.locator(".market-order").count(), 2); assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 157.5);
    const next = await page.evaluate(async (id) => (await window.db.marketOrders.toArray()).find((o) => o.id !== id), old.id);
    assert.equal(next.chatId, null); assert.equal(next.total, 17.5); assert.equal(next.items[0].quantity, 1);
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("normal")).history.length), 1); assert.equal(await page.evaluate(async () => (await window.db.chats.get("watch")).history.length), 1);
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-order-again-v17102.png") });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.evaluate(() => window.EPhoneLifeMarket.open({ tab: "orders" })); assert.equal(await page.locator('[data-action="buy-again"]').count(), 2);
    await page.evaluate(() => window.EPhoneSpaces.switchSpace("other")); await page.evaluate(() => window.EPhoneLifeMarket.open());
    await page.locator('[data-tab="orders"]').click(); assert.equal(await page.locator(".market-order").count(), 0);
    await page.evaluate(() => window.EPhoneSpaces.switchSpace("default")); await page.evaluate(() => window.EPhoneLifeMarket.open({ tab: "orders" }));
    assert.equal(await page.locator(".market-order").count(), 2); assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 157.5);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    console.log("PASS: mobile checkout group choice independent of recipient, normal/watch card display, existing-order posting and dedupe without charging, buy-again quantity/price review and new checkout, no-card/reload/space isolation, no API calls or page errors");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
