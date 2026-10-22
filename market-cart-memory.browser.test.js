const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const calls = [], unexpected = [], errors = [];
  let responses = [];
  const book = "购物车限定薄荷笔记本", meal = "购物车限定香菇鸡饭", shelf = "不应被读入货架的陶杯";
  const header = { type: "narration", content: "2026年10月22日，10点00分，星期四，地点：客厅" };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://cart-memory-test.invalid/")) {
        const body = route.request().postDataJSON(); calls.push(body);
        const raw = responses.shift();
        assert.ok(raw, "only the explicitly requested single reply may call this fake provider");
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: "stop" }], usage: { prompt_tokens: 1234, completion_tokens: 80 } }) });
      }
      if (/chat\/completions|generateContent|images\/generations/.test(url)) unexpected.push(url);
      return route.abort(); // Local fixtures only; never use an account, key or real provider.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async ({ book, meal, shelf }) => {
      const config = await window.db.apiConfig.get("main") || { id: "main" };
      await window.db.apiConfig.put({ ...config, proxyUrl: "https://cart-memory-test.invalid/v1", apiKey: "isolated-test-placeholder", model: "cart-memory-fixture", secondaryProxyUrl: "", secondaryApiKey: "", secondaryModel: "" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const members = ["甲", "乙", "丙"].map((name, index) => ({ id: "cart-role" + index, originalName: name, groupNickname: name, persona: "普通成年角色，独立生活。", avatar }));
      for (const member of members) await window.db.chats.put({ id: member.id, name: member.originalName, originalName: member.originalName, avatar, settings: { aiPersona: member.persona, aiAvatar: avatar, maxMemory: 1 }, history: [{ role: "user", content: "继续交流。", timestamp: 1 }] });
      for (const [id, watch] of [["cart-watch", true], ["cart-group", false], ["cart-unrelated", true]]) await window.db.chats.put({ id, name: id, isGroup: true, isSpectatorGroup: watch, avatar, members: id === "cart-unrelated" ? members.slice(1) : members,
        settings: { maxMemory: 1, myNickname: "我", linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [] });
      await window.ephonePlayerIdentity.save(window.db, "chat:cart-role0");
      await window.db.userWallet.put({ id: "main", balance: 1000, kinshipCards: [] });
      await window.db.marketState.put({ ...window.ephoneLifeMarketCore.blank(), items: [
        { id: "memory-book", name: book, merchant: "薄荷书店", kind: "goods", category: "文具", department: "图书文具", price: 19.9, emoji: "📗", reason: "购物车不应传输的推荐理由", description: "仅供货架的完整推荐描述", image: "data:image/png;base64,cart-memory-private-image" },
        { id: "memory-meal", name: meal, merchant: "香菇饭店", kind: "food", category: "正餐", department: "家常饭菜", price: 16.5, deliveryFee: 2.5, deliveryMinutes: 25, emoji: "🍱", reason: "仅货架生成原因" },
        { id: "memory-shelf", name: shelf, merchant: "陶杯店", kind: "goods", category: "家居", department: "家居清洁", price: 40, emoji: "☕", reason: "只供货架推荐的隐藏reason" },
      ] });
    }, { book, meal, shelf });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function openChat(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active");
    }
    async function generate(id) {
      await openChat(id); const before = calls.length;
      responses.push([header, { type: "text", name: id === "cart-unrelated" ? "乙" : "甲", content: "继续安排今天的事情。" }]);
      await page.locator(id === "cart-watch" || id === "cart-unrelated" ? "#spectator-propel-btn" : "#wait-reply-btn").click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      assert.equal(responses.length, 0); assert.equal(calls.length, before + 1, "cart awareness is part of the one reply, not a separate API request");
      const prompt = calls.at(-1).messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
      for (const excluded of [shelf, "购物车不应传输的推荐理由", "仅供货架的完整推荐描述", "只供货架推荐的隐藏reason", "data:image/png;base64,cart-memory-private-image"]) assert.equal(prompt.includes(excluded), false, "only compact cart facts may be sent: " + excluded);
      return prompt;
    }
    function snapshot(prompt) {
      const line = prompt.split("\n").find((row) => row.includes('"status":"cart_unpaid"'));
      assert.ok(line, "the actual final provider prompt includes a private unpaid cart snapshot"); return JSON.parse(line.slice(line.indexOf("{")));
    }
    async function market(tab) {
      await page.evaluate(() => window.EPhoneLifeMarket.open());
      await page.locator(`[data-tab="${tab}"]`).click();
    }
    async function waitMarket() { await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy()); }
    const beforeCart = await page.evaluate(async () => ({ chats: await window.db.chats.toArray(), wallet: await window.db.userWallet.get("main"), orders: await window.db.marketOrders.toArray() }));
    await market("goods");
    await page.locator('[data-item="memory-book"][data-delta="1"]').click(); await waitMarket();
    await page.locator('[data-item="memory-book"][data-delta="1"]').click(); await waitMarket();
    await page.locator('[data-tab="food"]').click(); await page.locator('[data-item="memory-meal"][data-delta="1"]').click(); await waitMarket();
    await page.locator('[data-tab="cart"]').click(); await page.locator('[data-cart-check="memory-meal"]').uncheck(); await waitMarket();
    assert.match(await page.locator(".market-cart-memory").innerText(), /甲.*下一轮聊天读取购物车/);
    const layout = await page.locator(".market-content").evaluate((el) => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
    assert.ok(layout.scrollWidth <= layout.width + 1, "cart memory notice stays within the mobile content area");
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-cart-memory-v17112.png") });
    assert.equal(calls.length, 0, "opening and changing a cart never generates a reply");
    assert.deepEqual(await page.evaluate(async () => ({ chats: await window.db.chats.toArray(), wallet: await window.db.userWallet.get("main"), orders: await window.db.marketOrders.toArray() })), beforeCart, "cart changes do not create chat cards, orders or debits");
    for (const id of ["cart-watch", "cart-group", "cart-role0"]) {
      const prompt = await generate(id), data = snapshot(prompt);
      assert.equal(data.ownerKey, "chat:cart-role0"); assert.equal(data.ownerName, "甲");
      assert.equal(data.ownerOnlyDetails.items.length, 2);
      assert.deepEqual(data.ownerOnlyDetails.items.find((item) => item.name === book), { name: book, merchant: "薄荷书店", kind: "goods", unitPrice: 19.9, quantity: 2, lineTotal: 39.8, selected: true });
      assert.deepEqual(data.ownerOnlyDetails.items.find((item) => item.name === meal), { name: meal, merchant: "香菇饭店", kind: "food", unitPrice: 16.5, quantity: 1, lineTotal: 16.5, selected: false });
      assert.deepEqual(data.ownerOnlyDetails.allItems, { subtotal: 56.3, delivery: 2.5, total: 58.8 });
      assert.deepEqual(data.ownerOnlyDetails.selectedItems, { subtotal: 39.8, delivery: 0, total: 39.8 });
      assert.match(prompt, /未付款|未支付/); assert.match(prompt, /不是.*订单|不等于.*下单|尚未下单/);
      assert.match(prompt, /告知/); assert.match(prompt, /(?:查看|打开).*(?:手机|购物车)|查手机/);
    }
    let prompt = await generate("cart-unrelated"); assert.equal(prompt.includes(book), false); assert.equal(prompt.includes(meal), false, "unrelated characters cannot inspect an absent owner's private cart");
    await market("cart"); await page.locator('[data-item="memory-book"][data-delta="1"]').click(); await waitMarket();
    const count = calls.length;
    await page.evaluate(async () => {
      const state = await window.db.marketState.get("main");
      await window.db.marketState.put({ ...state, items: [{ id: "replacement", name: "换新货架的枕头", kind: "goods", price: 90, merchant: "新店" }], revision: (state.revision || 0) + 1 });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    assert.equal(calls.length, count, "reload and shelf replacement do not query an API");
    prompt = await generate("cart-watch"); let data = snapshot(prompt);
    assert.equal(data.ownerOnlyDetails.items.find((item) => item.name === book).quantity, 3);
    assert.equal(prompt.includes("换新货架的枕头"), false, "a new shelf does not overwrite the immutable pending cart snapshot");
    await market("cart"); await page.locator('[data-item="memory-meal"][data-delta="-1"]').click(); await waitMarket();
    prompt = await generate("cart-watch"); data = snapshot(prompt);
    assert.equal(data.ownerOnlyDetails.items.length, 1); assert.equal(data.ownerOnlyDetails.allItems.total, 59.7); assert.equal(prompt.includes(meal), false, "removed cart lines must not survive in a stale prompt");
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 1000);
    assert.equal(await page.evaluate(() => window.db.marketOrders.count()), 0);
    // A real partial checkout removes only the selected cart line. The still-
    // unpaid line and the paid order must remain distinct in the next prompt.
    await page.evaluate(async ({ meal }) => {
      const store = new window.ephoneLifeMarketCore.Store(window.db), state = await store.load();
      await window.db.marketState.put({ ...state, items: [...state.items, { id: "memory-meal", name: meal, merchant: "香菇饭店", kind: "food", price: 16.5, deliveryFee: 2.5 }] });
      await store.changeCart("memory-meal", 1); await store.selectCart("memory-meal", false);
    }, { meal });
    await market("cart"); await page.locator("#market-card-destination").selectOption("none");
    await page.locator('[data-action="checkout"]').click(); await page.locator('[data-action="pay"]').click(); await waitMarket();
    assert.match(await page.locator(".market-message").innerText(), /下单成功/);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 940.3);
    prompt = await generate("cart-watch"); data = snapshot(prompt);
    assert.equal(data.ownerOnlyDetails.items.length, 1); assert.equal(data.ownerOnlyDetails.items[0].name, meal); assert.equal(data.ownerOnlyDetails.items[0].selected, false);
    assert.equal(data.ownerOnlyDetails.allItems.total, 19); assert.equal(data.ownerOnlyDetails.selectedItems.total, 0);
    assert.equal(data.ownerOnlyDetails.items.some((item) => item.name === book), false, "paid goods are in the order section, never still pending in the cart snapshot");
    assert.match(prompt, /实际订单账本/);
    const beforeSwitchCalls = calls.length;
    await page.evaluate(async () => {
      const spaces = JSON.parse(localStorage.getItem("ephone-persona-spaces-v1"));
      localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([...spaces, { id: "cart-isolated", name: "隔离购物车空间" }]));
      await window.EPhoneSpaces.switchSpace("cart-isolated");
    });
    assert.equal(await page.evaluate(() => window.db.marketState.count()), 0);
    assert.equal(await page.evaluate(() => window.db.marketOrders.count()), 0);
    assert.equal(await page.evaluate(() => window.ephonePlayerIdentity.load(window.db)), null);
    await page.evaluate(() => window.EPhoneSpaces.switchSpace("default"));
    assert.equal(calls.length, beforeSwitchCalls, "space switching never generates cart memory through an API");
    prompt = await generate("cart-watch"); assert.equal(snapshot(prompt).ownerOnlyDetails.items[0].name, meal);
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log("PASS: mobile real-cart actions, live unpaid owner memory in watch/normal/private final requests, no-order and partial-checkout snapshots, exact item/selected totals, no shelf/private leak, reload/space isolation and one reply API only");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
