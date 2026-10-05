const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
function batch(prefix) {
  const make = (kind, count) => Array.from({ length: count }, (_, i) => ({ name: `${prefix}${kind}${i}`, category: `类别${i % 4}`,
    merchant: `店${i % 3}`, description: "日常好物", reason: "呼应书法爱好与近期学习需求", price: 10.15 + i, deliveryFee: 2.35, deliveryMinutes: 30, emoji: kind === "餐" ? "🍱" : "🛍" }));
  return { headline: `${prefix} · 新生活`, goods: make("物", 12), food: make("餐", 8) };
}
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
  let calls = 0, failure = false; const prompts = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://market-test.invalid/")) {
        calls++; const body = route.request().postDataJSON(); prompts.push(body.messages[0].content);
        if (failure) return route.fulfill({ status: 503, body: "Test unavailable" });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(batch(`批${calls}`)) } }] }) });
      }
      return route.abort(); // No real API, credentials, payments, or user data.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.db && window.EPhoneMarketAdapter);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main") || { id: "main" };
      await window.db.apiConfig.put({ ...config, proxyUrl: "https://market-test.invalid/v1", apiKey: "test-placeholder", model: "test-model", secondaryProxyUrl: "", secondaryApiKey: "", secondaryModel: "" });
      await window.db.userWallet.put({ id: "main", balance: 200, kinshipCards: [] });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      await window.db.chats.put({ id: "market-role", name: "林", originalName: "林", isGroup: false, avatar,
        settings: { aiPersona: "喜欢书法", aiAvatar: avatar, linkedWorldBookIds: [987], maxMemory: 20 }, history: [{ role: "user", type: "text", content: "想买新文具", timestamp: 1 }] });
      await window.db.worldBooks.put({ id: 987, name: "学校", content: [{ title: "校园", content: "山海书院", enabled: true }] });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.db && window.EPhoneMarketAdapter);
    await page.locator("#life-market-home").click();
    await page.waitForSelector("#life-market-screen.active");
    assert.equal(calls, 0); assert.match(await page.locator(".market-content").innerText(), /尚未刷新/);
    await page.locator("#market-refresh").click();
    await page.waitForFunction(() => document.querySelector(".market-message")?.textContent.includes("已全部更新"));
    assert.equal(calls, 1); assert.equal(await page.locator(".market-card").count(), 12);
    assert.match(prompts[0], /喜欢书法/); assert.match(prompts[0], /想买新文具/); assert.match(prompts[0], /200.00/); assert.match(prompts[0], /山海书院/);
    await page.locator('[data-tab="food"]').click(); assert.equal(await page.locator(".market-card").count(), 8);
    await page.locator('[data-tab="goods"]').click();
    await page.locator('.market-card [data-delta="1"]').first().click();
    await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    await page.locator(".market-back").click(); await page.locator("#life-market-home").click();
    assert.equal(calls, 1); assert.equal(await page.locator(".market-card").count(), 12);
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
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.db && window.EPhoneMarketAdapter);
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
    const layout = await page.evaluate(() => {
      const scroll = document.querySelector(".market-content"), nav = document.querySelector(".market-nav");
      scroll.scrollTop = 300;
      return { scroll: scroll.scrollTop, bottom: nav.getBoundingClientRect().bottom, width: document.getElementById("life-market-screen").scrollWidth };
    });
    assert.ok(layout.scroll > 0); assert.ok(layout.bottom <= 901); assert.ok(layout.width <= 420);
    await page.evaluate(() => { document.querySelector(".market-content").scrollTop = 0; });
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-market-v1.7.60.png") });
    assert.deepEqual(errors, []);
    console.log("PASS: actual mobile app, real API adapter with fake provider, both lists manual refresh, prompt grounding, failure preservation, reopen/reload, cart/order payment, space isolation, scroll layout, zero page errors");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
