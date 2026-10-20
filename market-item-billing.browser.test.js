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
      return route.abort(); // Isolated IndexedDB only, no real payments or API.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      await window.db.chats.put({ id: "item-owner", name: "甲", originalName: "甲", avatar, history: [], settings: { aiPersona: "普通家庭成年人", aiAvatar: avatar, maxMemory: 20 } });
      await window.ephonePlayerIdentity.save(window.db, "chat:item-owner");
      await window.db.userWallet.put({ id: "main", balance: 200, kinshipCards: [] });
      const cart = [
        { item: { id: "tea", name: "原味奶茶", kind: "food", price: 10.15, deliveryFee: 2.35, deliveryMinutes: 30, merchant: "茶饮店", emoji: "🍵" }, quantity: 2 },
        { item: { id: "snack", name: "芋泥点心", kind: "food", price: 5.2, deliveryFee: 1, deliveryMinutes: 30, merchant: "茶饮店", emoji: "🍰" }, quantity: 1 },
        { item: { id: "book", name: "随身笔记本", kind: "goods", price: 9.99, merchant: "文具店", emoji: "📘" }, quantity: 3 },
      ];
      await window.db.marketState.put({ ...window.ephoneLifeMarketCore.blank(), cart });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#life-market-home").click(); await page.locator('[data-tab="cart"]').click();
    assert.match(await page.locator(".market-checkout").innerText(), /57\.82/);
    await page.locator('[data-action="checkout"]').click(); await page.locator('[data-action="pay"]').click();
    await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(await page.locator(".market-order-line").count(), 3);
    const line = (name) => page.locator(".market-order-line").filter({ hasText: name });
    assert.match(await line("原味奶茶").innerText(), /单价 ¥10\.15 × 2/); assert.match(await line("原味奶茶").innerText(), /¥20\.30/);
    assert.match(await line("芋泥点心").innerText(), /单价 ¥5\.20 × 1/); assert.match(await line("芋泥点心").innerText(), /¥5\.20/);
    assert.match(await line("随身笔记本").innerText(), /单价 ¥9\.99 × 3/); assert.match(await line("随身笔记本").innerText(), /¥29\.97/);
    assert.equal(await page.locator(".market-delivery-line").count(), 1); assert.match(await page.locator(".market-delivery-line").innerText(), /2\.35/);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 142.18);
    const order = await page.evaluate(async () => (await window.db.marketOrders.toArray())[0]);
    assert.equal(await page.evaluate(async () => window.db.userTransactions.count()), 4);
    const layout = await page.evaluate(() => ({ width: document.querySelector(".market-order").scrollWidth, screen: document.getElementById("life-market-screen").clientWidth }));
    assert.ok(layout.width < layout.screen, "per-item price details fit the mobile viewport");
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-item-orders-v1798.png") });
    // Current and snapshot-only chat cards both show prices after purchase.
    await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
    await page.locator('.chat-list-item[data-chat-id="item-owner"]').click(); await page.waitForSelector("#chat-interface-screen.active");
    assert.equal(await page.locator(".market-chat-card .market-order-line").count(), 3);
    assert.match(await page.locator(".market-chat-card").innerText(), /单价 ¥10\.15 × 2/);
    const fallback = await page.evaluate(async () => {
      const notice = (await window.db.chats.get("item-owner")).history[0];
      return (await window.EPhoneLifeMarket.renderOrderMessage({ ...notice, orderId: "snapshot-only-missing-db-record" })).textContent;
    });
    assert.match(fallback, /单价 ¥10\.15 × 2/); assert.match(fallback, /29\.97/);
    // Existing grouped records split read-only in the actual wallet UI too.
    await page.evaluate(async (order) => {
      await window.db.marketOrders.put({ ...order, id: "legacy-display", timestamp: Date.now() - 100 });
      await window.db.userTransactions.add({ timestamp: Date.now() - 100, vts: order.vts, type: "expense", amount: order.total, orderId: "legacy-display", description: "旧合并账单" });
      await window.openAlipayScreen();
    }, order);
    await page.waitForSelector("#alipay-screen.active"); await page.waitForSelector("#bill-scroll-list .bill-item");
    assert.equal(await page.locator("#bill-scroll-list .bill-item").count(), 8);
    assert.equal(await page.locator(".bill-item").filter({ hasText: "原味奶茶" }).count(), 2);
    assert.equal(await page.locator(".bill-item").filter({ hasText: "配送费" }).count(), 2);
    assert.equal(await page.locator(".bill-item").filter({ hasText: "旧合并账单" }).count(), 0);
    assert.equal(await page.evaluate(async () => window.db.userTransactions.count()), 5, "view doesn't rewrite old bills");
    assert.equal(await page.locator("#alipay-balance-display").innerText(), "142.18");
    await page.evaluate(() => window.EPhoneCharacterWallet.open()); await page.waitForSelector("#cw-person");
    await page.locator("#cw-person").selectOption("chat:item-owner"); await page.waitForFunction(() => document.querySelector(".cw-balance")?.textContent.includes("142.18"));
    assert.equal(await page.locator(".cw-entry").filter({ hasText: "原味奶茶" }).count(), 2, "bound role wallet also gets per-item legacy/current entries");
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.evaluate(() => window.EPhoneLifeMarket.open({ tab: "orders" }));
    assert.equal(await page.locator(".market-order-line").count(), 6, "both existing orders retain all unit prices on reload");
    const refunded = await page.evaluate(async (orderId) => {
      const result = await new window.ephoneMarketOrders.Service(window.db).act({ type: "cancel_market_order", name: "甲", order_id: orderId, reason: "取消本次购买" }, { chatId: "item-owner", vts: Date.now() });
      await window.EPhoneMarketAdapter.onPaid(result); return result.balance;
    }, order.id);
    assert.equal(refunded, 200);
    const incomes = await page.evaluate(() => window.db.userTransactions.where("type").equals("income").toArray());
    assert.equal(incomes.length, 4); assert.equal(Math.round(incomes.reduce((sum, row) => sum + row.amount, 0) * 100), 5782);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    console.log("PASS: actual mobile one checkout, per-item order/chat/snapshot prices and shared delivery, current/legacy wallet details, bound character wallet, reload, exact refund, no API or page errors");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
