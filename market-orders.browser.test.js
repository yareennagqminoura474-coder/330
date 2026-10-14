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
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const calls = [], errors = []; let replies = [], shops = 0;
  const header = { type: "narration", content: "2026年3月5日，07点20分，星期四，地点：客厅" };
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://order-test.invalid/")) {
        const body = route.request().postDataJSON(), daily = require("./browser-test-fixtures.js").dailyReply(body.messages[0].content);
        if (daily) return route.fulfill({ contentType: "application/json", body: JSON.stringify(daily) });
        calls.push(body);
        let raw;
        if (body.messages[0].content.includes("虚拟商城的策划")) {
          shops++;
          const list = (kind, count) => Array.from({ length: count }, (_, i) => ({ name: `新${kind}${shops}-${i}`, category: "类别" + i, merchant: "店铺", description: "日常所需", price: 10, deliveryFee: 2, deliveryMinutes: 30, reason: "符合人设" }));
          raw = { headline: "本批", goods: list("物", 12), food: list("餐", 8) };
        } else raw = replies.shift() || [header, { type: "text", name: "甲", content: "继续聊天。" }];
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: "stop" }] }) });
      }
      return route.abort(); // Isolated fixtures only, never a real provider/key/order.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main") || { id: "main" };
      await window.db.apiConfig.put({ ...config, proxyUrl: "https://order-test.invalid/v1", apiKey: "test-placeholder", model: "test-model", secondaryProxyUrl: "https://order-test.invalid/v1", secondaryApiKey: "test-aux-placeholder", secondaryModel: "auxiliary-test-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const members = ["甲", "乙", "丙"].map((name, i) => ({ id: "role" + i, originalName: name, groupNickname: name, persona: name + "喜欢书法。家庭条件普通。", avatar }));
      for (const m of members) await window.db.chats.put({ id: m.id, name: m.originalName, originalName: m.originalName, avatar, settings: { aiPersona: m.persona, aiAvatar: avatar, maxMemory: 1 }, history: [] });
      for (const [id, watch] of [["order-watch", true], ["order-group", false]]) await window.db.chats.put({ id, name: id, isGroup: true, isSpectatorGroup: watch, avatar, members,
        settings: { maxMemory: 1, myNickname: "我", linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [] });
      await window.db.userWallet.put({ id: "main", balance: 100, kinshipCards: [] });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function openChat(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen"));
      await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click();
      await page.waitForSelector("#chat-interface-screen.active");
    }
    await page.evaluate(() => window.showScreen("chat-list-screen"));
    await page.locator('.nav-item[data-view="me-view"]').click();
    await page.waitForFunction(() => document.querySelector('#player-identity-select option[value="chat:role0"]'));
    await page.locator("#player-identity-select").selectOption("chat:role0"); await page.locator("#player-identity-save").click();
    await page.waitForFunction(() => !window.ephonePlayerIdentity.isBusy());
    assert.match(await page.locator("#player-identity-status").innerText(), /已保存|本空间绑定：甲/);
    await openChat("order-watch");
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 7, 20).getTime(), "frozen"));
    await page.evaluate(() => window.EPhoneLifeMarket.open());
    assert.equal(shops, 0); await page.locator("#market-refresh").click();
    await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.match(await page.locator(".market-message").innerText(), /已全部更新/);
    assert.equal(shops, 1); assert.match(calls[0].messages[0].content, /boundPlayer/);
    await page.locator('[data-tab="food"]').click(); await page.locator('.market-card [data-delta="1"]').first().click();
    await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy()); await page.locator('[data-tab="cart"]').click();
    assert.match(await page.locator("#market-recipient").innerText(), /给甲下单/);
    await page.locator('[data-action="checkout"]').click(); await page.locator('[data-action="pay"]').click();
    await page.waitForFunction(() => document.querySelector(".market-message")?.textContent.includes("下单成功"));
    const order = await page.evaluate(async () => (await window.db.marketOrders.toArray())[0]);
    assert.equal(order.ownerKey, "chat:role0"); assert.equal(order.chatId, "order-watch"); assert.deepEqual(order.knownBy.map((p) => p.name), ["甲"]);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 88);
    await openChat("order-watch"); assert.match(await page.locator(".market-chat-card").innerText(), /私有记忆|不代表全群知情/);
    async function generate(id, actions) {
      await openChat(id); replies = [[header, ...actions]];
      await page.locator(id === "order-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy()); assert.equal(replies.length, 0);
      return calls.at(-1).messages[0].content;
    }
    let prompt = await generate("order-watch", [{ type: "cancel_market_order", name: "乙", order_id: order.id, reason: "试图取消" }]);
    assert.match(prompt, /私有与已公开部分严格分开/); assert.match(prompt, new RegExp(order.id));
    assert.equal((await page.evaluate(async (id) => window.db.marketOrders.get(id), order.id)).status, "paid");
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 88);
    assert.ok(await page.evaluate(async () => (await window.db.chats.get("order-watch")).history.some((m) => m.orderOperationFailed)));
    await generate("order-watch", [
      { type: "narration", name: "乙", content: "乙拿过甲的手机打开订单页。" },
      { type: "market_phone_check", name: "乙", order_id: order.id, content: "（已拿过甲的手机打开订单页查看）" },
      { type: "cancel_market_order", name: "乙", order_id: order.id, reason: "改吃家里的饭" },
      { type: "text", name: "乙", content: "订单取消了，钱退回你的钱包。" },
    ]);
    const cancelled = await page.evaluate(async (id) => window.db.marketOrders.get(id), order.id);
    assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.cancelledBy, "乙"); assert.equal(cancelled.knownBy.some((p) => p.name === "丙"), false);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 100);
    assert.equal(await page.locator('.market-chat-card[data-event="cancelled"]').count(), 1);
    assert.equal(await page.locator("#spectator-reroll-btn").isDisabled(), true, "Cannot reroll away an order mutation while keeping its refund");
    assert.match(await page.locator('.market-chat-card[data-event="placed"]').innerText(), /已取消/);
    await page.locator('.market-chat-card[data-event="cancelled"] button').click();
    await page.waitForSelector("#life-market-screen.active"); assert.match(await page.locator(".market-order").innerText(), /已取消.*已退款|已取消·已退款/);
    assert.equal(shops, 1);
    // Same action hooks exist in ordinary groups and private chats, not just watch.
    for (const [chatId, role] of [["order-group", "乙"], ["role0", "甲"]]) {
      await page.evaluate(async ({ chatId, role }) => {
        await window.db.marketOrders.put({ id: chatId, status: "paid", timestamp: Date.now(), vts: 1, ownerKey: "chat:role0", ownerName: "甲", recipientName: "甲", total: 3,
          chatId, items: [{ item: { name: "测试商品", kind: "goods" }, quantity: 1 }], knownBy: [{ key: "chat:role0", name: "甲", level: "details" }], phoneAccess: ["chat:role0"] });
      }, { chatId, role });
      const actions = role === "乙" ? [{ type: "market_phone_check", name: role, order_id: chatId, content: "实际打开甲手机的订单页" }] : [];
      await generate(chatId, [...actions, { type: "cancel_market_order", name: role, order_id: chatId, reason: "取消测试订单" }, { type: "text", name: role, content: "已经处理好了。" }]);
      assert.equal((await page.evaluate(async (id) => window.db.marketOrders.get(id), chatId)).status, "cancelled");
    }
    await page.evaluate(async () => window.db.marketOrders.put({ id: "delivery-case", status: "paid", timestamp: Date.now(), vts: 1,
      ownerKey: "chat:role0", ownerName: "甲", recipientName: "甲", total: 5, chatId: "order-watch",
      items: [{ item: { name: "花束", kind: "goods" }, quantity: 1 }], knownBy: [{ key: "chat:role0", name: "甲", level: "details" }], phoneAccess: ["chat:role0"] }));
    await generate("order-watch", [
      { type: "text", name: "甲", content: "我买了花束。" },
      { type: "market_order_share", name: "甲", order_id: "delivery-case", audience: ["乙"], content: "我买了花束。" },
      { type: "market_order_arrived", name: "乙", order_id: "delivery-case", audience: ["甲"], content: "门铃响，两人在门口看到花束送达。丙不在场。" },
      { type: "text", name: "乙", content: "花送到了。" },
    ]);
    const delivery = await page.evaluate(() => window.db.marketOrders.get("delivery-case"));
    assert.equal(delivery.status, "delivered"); assert.equal(delivery.knownBy.find((p) => p.name === "乙").level, "summary");
    assert.equal(delivery.knownBy.some((p) => p.name === "丙"), false);
    assert.equal(await page.locator('.market-chat-card[data-event="delivered"]').count(), 1);
    // Reload and switch spaces: no re-binding, wallet or shop refresh leaks.
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    assert.equal((await page.evaluate(() => window.ephonePlayerIdentity.load(window.db))).key, "chat:role0");
    await page.evaluate(async () => {
      const spaces = JSON.parse(localStorage.getItem("ephone-persona-spaces-v1"));
      localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([...spaces, { id: "order-other", name: "另一空间" }]));
      await window.EPhoneSpaces.switchSpace("order-other");
    });
    assert.equal(await page.evaluate(() => window.ephonePlayerIdentity.load(window.db)), null);
    assert.equal(await page.evaluate(() => window.db.marketOrders.count()), 0);
    await page.evaluate(() => window.EPhoneSpaces.switchSpace("default"));
    assert.equal((await page.evaluate(() => window.ephonePlayerIdentity.load(window.db))).name, "甲");
    await openChat("order-watch");
    const layout = await page.evaluate(() => ({ width: document.getElementById("chat-messages").scrollWidth, viewport: document.getElementById("chat-messages").clientWidth }));
    assert.ok(layout.width <= layout.viewport + 1); assert.equal(shops, 1); assert.deepEqual(errors, []);
    console.log("PASS: actual mobile Me binding, persistent per-space identity, default owner purchase, private prompt with short history, denied cancel, phone/cancel/refund cards, normal/private parity, no automatic shop refresh or page errors");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
