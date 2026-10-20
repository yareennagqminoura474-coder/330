const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
const { marketBatch: batch } = require("./market-test-fixtures");
(async () => {
  const root = __dirname;
  const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, "." + (relative === "/" ? "/index.html" : relative));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  let calls = 0, failure = false, duplicate = false; const prompts = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://market-test.invalid/")) {
        calls++; const body = route.request().postDataJSON(); prompts.push(body.messages[0].content);
        assert.equal(body.model, "auxiliary-test-model", "shopping always uses the saved secondary API");
        if (failure) return route.fulfill({ status: 503, body: "Test unavailable" });
        const catalog = batch(`批${duplicate ? 4 : calls}`);
        if (duplicate) for (const item of [...catalog.goods, ...catalog.food]) { item.name = "精选" + item.name + "家庭装500g"; item.merchant = "换名店"; }
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(catalog) } }] }) });
      }
      return route.abort(); // No real API, credentials, payments, or user data.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main") || { id: "main" };
      await window.db.apiConfig.put({ ...config, proxyUrl: "https://market-test.invalid/v1", apiKey: "test-placeholder", model: "test-model", secondaryProxyUrl: "https://market-test.invalid/v1", secondaryApiKey: "test-aux-placeholder", secondaryModel: "auxiliary-test-model" });
      await window.db.userWallet.put({ id: "main", balance: 200, kinshipCards: [] });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      await window.db.chats.put({ id: "market-role", name: "林", originalName: "林", isGroup: false, avatar,
        settings: { aiPersona: "喜欢书法。家境优渥，但消费节俭。", myPersona: "喜欢园艺。家庭经济条件普通，每月零花钱800元。", aiAvatar: avatar, linkedWorldBookIds: [987], maxMemory: 20 }, history: [{ role: "user", type: "text", content: "想买新文具", timestamp: 1 }] });
      await window.db.worldBooks.put({ id: 987, name: "学校", content: [{ title: "校园", content: "山海书院", enabled: true }] });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#life-market-home").click();
    await page.waitForSelector("#life-market-screen.active");
    await page.waitForFunction(() => document.querySelector(".market-content")?.textContent.includes("尚未刷新"));
    assert.equal(calls, 0); assert.match(await page.locator(".market-content").innerText(), /尚未刷新/);
    await page.locator("#market-refresh").click();
    await page.waitForFunction(() => document.querySelector(".market-message")?.textContent.includes("已全部更新"));
    assert.equal(calls, 1); assert.equal(await page.locator(".market-card").count(), 24);
    assert.equal(await page.locator("[data-category]").count(), 13);
    await page.locator('[data-selection="personal"]').click(); assert.equal(await page.locator(".market-card").count(), 6);
    await page.locator('[data-selection="everyday"]').click(); assert.equal(await page.locator(".market-card").count(), 12);
    await page.locator('[data-selection="discovery"]').click(); assert.equal(await page.locator(".market-card").count(), 6);
    await page.locator('[data-selection="全部"]').click();
    await page.locator('[data-category="生鲜食材"]').click(); assert.equal(await page.locator(".market-card").count(), 2);
    await page.locator('[data-category="全部"]').click();
    assert.match(prompts[0], /喜欢书法/); assert.doesNotMatch(prompts[0], /想买新文具|200\.00|山海书院/);
    assert.match(prompts[0], /家境优渥，但消费节俭/);
    assert.match(prompts[0], /家庭经济条件普通，每月零花钱800元/);
    assert.match(prompts[0], /实际选品与定价/);
    await page.locator('[data-tab="food"]').click(); assert.equal(await page.locator(".market-card").count(), 16);
    assert.equal(await page.locator("[data-category]").count(), 9);
    await page.locator('[data-tab="goods"]').click();
    await page.locator('.market-card [data-delta="1"]').first().click();
    await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    await page.locator(".market-back").click(); await page.locator("#life-market-home").click();
    assert.equal(calls, 1); assert.equal(await page.locator(".market-card").count(), 24);
    await page.locator("#market-refresh").click();
    await page.waitForFunction(async () => (await window.db.marketState.get("main"))?.revision === 2);
    await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(calls, 2); assert.match(await page.locator(".market-products").innerText(), /批2物/); assert.doesNotMatch(await page.locator(".market-products").innerText(), /批1物/);
    failure = true; await page.locator("#market-refresh").click();
    await page.waitForFunction(() => document.querySelector(".market-message")?.textContent.includes("刷新失败"));
    assert.equal(calls, 3); assert.equal(await page.evaluate(async () => (await window.db.marketState.get("main")).revision), 2);
    await page.locator('[data-tab="cart"]').click();
    assert.match(await page.locator(".market-content").innerText(), /批1物0/);
    await page.locator("#market-recipient").selectOption({ label: "林 · 林" });
    await page.locator('[data-action="checkout"]').click(); await page.locator('[data-action="pay"]').click();
    await page.waitForFunction(() => document.querySelector(".market-message")?.textContent.includes("下单成功"));
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 189.85);
    assert.match(await page.locator(".market-order").innerText(), /林/);
    assert.match(await page.evaluate(async () => (await window.db.chats.get("market-role")).history.at(-1).content), /已为林下单/);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#life-market-home").click(); assert.equal(calls, 3);
    assert.match(await page.locator(".market-products").innerText(), /批2物/);
    await page.evaluate(async () => {
      const spaces = JSON.parse(localStorage.getItem("ephone-persona-spaces-v1"));
      localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([...spaces, { id: "market-other", name: "另一空间" }]));
      await window.EPhoneSpaces.switchSpace("market-other"); await window.EPhoneLifeMarket.open();
    });
    assert.equal(calls, 3); assert.match(await page.locator(".market-account").innerText(), /另一空间.*0.00/);
    assert.match(await page.locator(".market-content").innerText(), /尚未刷新/);
    await page.evaluate(async () => { await window.EPhoneSpaces.switchSpace("default"); await window.EPhoneLifeMarket.open(); });
    assert.match(await page.locator(".market-products").innerText(), /批2物/);
    await page.locator('[data-tab="orders"]').click(); assert.equal(await page.locator(".market-order").count(), 1);
    await page.locator('[data-tab="goods"]').click();
    await page.evaluate(async () => {
      const chat = await window.db.chats.get("market-role");
      chat.settings.myPersona = "喜欢园艺。家庭条件富裕，但每月零用钱有限，偏爱实用耐用品。";
      await window.db.chats.put(chat);
    });
    await page.locator(".market-back").click(); await page.locator("#life-market-home").click();
    assert.equal(calls, 3, "Editing family conditions must not automatically replace the old catalog");
    assert.match(await page.locator(".market-products").innerText(), /批2物/);
    failure = false; await page.locator("#market-refresh").click();
    await page.waitForFunction(() => document.querySelector(".market-message")?.textContent.includes("已全部更新"));
    assert.equal(calls, 4);
    assert.match(prompts.at(-1), /家庭条件富裕，但每月零用钱有限/);
    assert.doesNotMatch(prompts.at(-1), /每月零花钱800元|想买新文具|山海书院|189\.85/);
    assert.equal(await page.evaluate(async () => (await window.db.marketOrders.count())), 1);
    const layout = await page.evaluate(() => {
      const scroll = document.querySelector(".market-content"), nav = document.querySelector(".market-nav");
      scroll.scrollTop = 300;
      return { scroll: scroll.scrollTop, bottom: nav.getBoundingClientRect().bottom, width: document.getElementById("life-market-screen").scrollWidth };
    });
    assert.ok(layout.scroll > 0); assert.ok(layout.bottom <= 901); assert.ok(layout.width <= 420);
    await page.evaluate(() => { document.querySelector(".market-content").scrollTop = 0; });
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-market-v1.7.60.png") });
    const beforeDuplicate = await page.evaluate(async () => window.db.marketState.get("main"));
    duplicate = true; await page.locator("#market-refresh").click();
    await page.waitForFunction(() => document.querySelector(".market-message")?.textContent.includes("商品重复"));
    assert.deepEqual(await page.evaluate(async () => window.db.marketState.get("main")), beforeDuplicate, "renamed/repackaged duplicate catalog never replaces the saved list");
    assert.equal(calls, 6, "at most one repair for invalid catalog, both on auxiliary model");
    await page.locator(".market-back").click(); await page.locator("#life-market-home").click();
    assert.equal(calls, 6, "even after rejected refresh, opening must not generate or retry");
    assert.deepEqual(errors, []);
    console.log("PASS: actual mobile app, personality/family/consumption prompt grounding, profile edits only applied on manual refresh, both lists, no history/wallet assumptions, payment/order preservation, space isolation, scrolling, zero page errors");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
