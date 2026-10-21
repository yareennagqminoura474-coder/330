const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http"), os = require("node:os");
const { chromium } = require("playwright-core"), { marketBatch } = require("./market-test-fixtures");
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(__dirname, "." + (new URL(req.url, "http://localhost").pathname === "/" ? "/index.html" : new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const requests = [], errors = []; let fail = false;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.stack));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://search-aux.invalid/")) {
        const body = route.request().postDataJSON(); requests.push(body);
        if (fail) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "isolated search failure" } }) });
        const data = marketBatch("搜索新品"); data.goods[0] = { ...data.goods[0], name: "草莓酸奶180g", productIdentity: "草莓酸奶" }; data.food[0] = { ...data.food[0], name: "牛肉面", productIdentity: "牛肉面" };
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] }) });
      }
      if (url.startsWith("https://never-primary.invalid/")) { errors.push("unexpected primary API"); return route.abort(); }
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    const old = marketBatch("旧货架"); old.goods[0] = { ...old.goods[0], name: "现有燕麦", productIdentity: "现有燕麦" };
    await page.evaluate(async (catalog) => {
      const config = await window.db.apiConfig.get("main") || { id: "main" };
      await window.db.apiConfig.put({ ...config, proxyUrl: "https://never-primary.invalid/v1", apiKey: "test-primary", model: "primary-only", secondaryProxyUrl: "https://search-aux.invalid/v1", secondaryApiKey: "test-aux", secondaryModel: "auxiliary-shopping" });
      const core = window.ephoneLifeMarketCore, state = { ...core.blank(), ...core.parseBatch(catalog, undefined, "old"), seenNames: ["草莓酸奶180g"] };
      state.cart = [{ item: state.items[2], quantity: 2, selected: true }];
      await window.db.marketState.put(state); await window.db.userWallet.put({ id: "main", balance: 1000 });
    }, old);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.evaluate(() => window.EPhoneLifeMarket.open()); await page.waitForSelector("#market-search-submit");
    assert.equal(requests.length, 0);
    await page.locator("#market-search").fill("现有燕麦"); assert.equal(requests.length, 0);
    await page.locator("#market-search-submit").click(); await page.waitForFunction(() => document.querySelector(".market-message").textContent.includes("无需调用API"));
    assert.equal(requests.length, 0);
    await page.locator("#market-search").fill("现有燕麦，草莓酸奶\n牛肉面"); assert.equal(requests.length, 0);
    await page.locator("#market-search").press("Enter"); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(requests.length, 1); assert.equal(requests[0].model, "auxiliary-shopping");
    assert.match(requests[0].messages[0].content, /"missingQueries":\["草莓酸奶","牛肉面"\]/);
    assert.match(await page.locator(".market-message").innerText(), /3\/3项需求/);
    assert.equal(await page.locator(".market-card").count(), 2);
    assert.equal(await page.locator("#market-search").inputValue(), "现有燕麦，草莓酸奶\n牛肉面");
    await page.screenshot({ path: path.join(os.tmpdir(), "ephone-market-multi-search-v17107.png") });
    await page.locator('.market-nav [data-tab="food"]').click(); assert.match(await page.locator(".market-products").innerText(), /牛肉面/);
    await page.locator("#market-search-submit").click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy()); assert.equal(requests.length, 1);
    await page.locator("#market-search").fill(""); await page.locator('.market-nav [data-tab="goods"]').click();
    assert.ok(await page.locator(".market-card").count() >= 24);
    const saved = await page.evaluate(() => window.db.marketState.get("main"));
    assert.equal(saved.cart[0].quantity, 2); assert.equal(saved.cart[0].item.name, "旧货架物2");
    assert.ok(!saved.items.some((i) => i.name === "旧货架物3"));
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 1000);
    assert.equal(await page.evaluate(() => window.db.userTransactions.count()), 0);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.evaluate(() => window.EPhoneLifeMarket.open());
    await page.waitForSelector("#market-search-submit"); assert.equal(requests.length, 1);
    assert.deepEqual(await page.evaluate(() => window.db.marketState.get("main")), saved);
    fail = true; await page.locator("#market-search").fill("咖啡机、洗衣机"); await page.locator("#market-search-submit").click();
    await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(requests.length, 2); assert.match(await page.locator(".market-message").innerText(), /失败.*保留/);
    assert.deepEqual(await page.evaluate(() => window.db.marketState.get("main")), saved); assert.deepEqual(errors, []);
    console.log("PASS: mobile multi-query textarea/Enter/button, typing and all-found search make no API calls, one auxiliary mixed-list generation, existing target/cart/wallet preserved, query result tabs and full shelf, reopen/reload persistence, failure retains old state; SCREENSHOT ephone-market-multi-search-v17107.png");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
