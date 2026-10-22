const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const requests = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (/chat\/completions|generateContent|images\/generations/.test(url)) requests.push(url);
      return route.abort(); // Isolated browser storage and no real provider calls.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    if (!await page.evaluate(() => !!window.ephoneFinanceRecordsCore)) await page.addScriptTag({ url: origin + "/finance-records-core.js" });
    await page.evaluate(async () => {
      localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([{ id: "other", name: "另一空间" }]));
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      await window.db.chats.put({ id: "owner", name: "甲", originalName: "甲", avatar, history: [], settings: { aiPersona: "普通家庭成年人", aiAvatar: avatar, maxMemory: 20 } });
      await window.db.chats.put({ id: "watch", name: "观看群", avatar, isGroup: true, isSpectatorGroup: true, history: [], settings: { maxMemory: 20, myNickname: "我" }, members: [{ id: "owner", originalName: "甲", groupNickname: "甲", persona: "成年人", avatar }] });
      await window.ephonePlayerIdentity.save(window.db, "chat:owner");
      await window.db.userWallet.put({ id: "main", balance: 1000, kinshipCards: [] });
      const state = { ...window.ephoneLifeMarketCore.blank(), cart: [
        { item: { id: "book", name: "练习册", kind: "goods", price: 10, merchant: "书店", emoji: "📘" }, quantity: 2 },
        { item: { id: "rice", name: "盖浇饭", kind: "food", price: 12, merchant: "饭店", deliveryFee: 3, emoji: "🍚" }, quantity: 1 },
        { item: { id: "kept", name: "留在购物车", kind: "goods", price: 5, merchant: "小店" }, quantity: 1, selected: false },
      ] };
      await window.db.marketState.put(state);
      const store = new window.ephoneLifeMarketCore.Store(window.db), owner = await window.ephonePlayerIdentity.load(window.db);
      await store.checkout({ orderId: "edit-order", expectedCart: state.cart, selectedItemIds: ["book", "rice"], target: { chatId: "owner", recipientName: "甲", forSelf: true }, cardChatId: "watch", owner, vts: new Date(2026, 2, 5, 10).getTime(), spaceId: "default" });
    });
    const initial = await page.evaluate(async () => ({ order: await window.db.marketOrders.get("edit-order"), cart: (await window.db.marketState.get("main")).cart }));
    assert.equal(initial.order.total, 35);
    await page.evaluate(() => window.EPhoneLifeMarket.open({ tab: "orders" }));
    await page.locator('[data-action="edit-order"]').click();
    const editor = page.locator(".market-order-editor");
    await editor.locator('[data-order-field="recipientName"]').fill("乙代收");
    await editor.locator('[data-order-field="address"]').fill("第二层前台");
    await editor.locator('[data-order-field="note"]').fill("按明细修改，不重新购买");
    await editor.locator('[data-line-field="name"][data-line-index="0"]').fill("精装练习册");
    await editor.locator('[data-line-field="price"][data-line-index="0"]').fill("15");
    await editor.locator('[data-line-field="quantity"][data-line-index="0"]').fill("3");
    await editor.locator('[data-line-field="deliveryFee"]').fill("5");
    assert.match(await editor.locator(".market-editor-preview").innerText(), /62.00/);
    const layout = await page.evaluate(() => {
      const content = document.querySelector(".market-content"), form = document.querySelector(".market-order-editor");
      return { canScroll: content.scrollHeight > content.clientHeight, overflow: getComputedStyle(content).overflowY, formWidth: form.getBoundingClientRect().width, screenWidth: innerWidth, bodyOverflow: document.body.style.overflow };
    });
    assert.equal(layout.canScroll, true); assert.equal(layout.overflow, "auto"); assert.ok(layout.formWidth < layout.screenWidth);
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-market-record-editor-v17111.png") });
    await editor.locator('[type="submit"]').click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    const edited = await page.evaluate(async () => ({ order: await window.db.marketOrders.get("edit-order"), wallet: await window.db.userWallet.get("main"), cart: (await window.db.marketState.get("main")).cart, bills: await window.db.userTransactions.toArray(), chat: await window.db.chats.get("watch") }));
    assert.equal(edited.order.total, 62); assert.equal(edited.wallet.balance, 938);
    assert.equal(edited.order.recipientName, "乙代收"); assert.equal(edited.order.address, "第二层前台"); assert.equal(edited.order.note, "按明细修改，不重新购买");
    assert.equal(edited.order.ownerKey, initial.order.ownerKey); assert.deepEqual(edited.order.knownBy, initial.order.knownBy); assert.equal(edited.order.status, initial.order.status);
    assert.deepEqual(edited.cart, initial.cart, "editing an order never changes the cart");
    assert.match(JSON.stringify(edited.chat.history), /精装练习册/);
    assert.match(await page.locator(".market-order").innerText(), /938|精装练习册/);
    await page.locator('[data-action="edit-order"]').click();
    await editor.locator('[data-line-field="price"][data-line-index="0"]').fill("99999");
    await editor.locator('[type="submit"]').click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.match(await page.locator(".market-message").innerText(), /失败|不足/);
    assert.equal(await editor.locator('[data-line-field="price"][data-line-index="0"]').inputValue(), "99999", "failed edit retains its draft");
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 938);
    await page.locator('[data-action="cancel-edit-order"]').click();
    await page.locator('[data-action="edit-order"]').click();
    await editor.locator('[data-order-field="note"]').fill("不应覆盖其他页面的新内容");
    await page.evaluate(async () => window.db.marketOrders.update("edit-order", { note: "另一页面刚保存" }));
    await editor.locator('[type="submit"]').click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.match(await page.locator(".market-message").innerText(), /失败/);
    assert.equal(await editor.locator('[data-order-field="note"]').inputValue(), "不应覆盖其他页面的新内容");
    assert.equal(await page.evaluate(async () => (await window.db.marketOrders.get("edit-order")).note), "另一页面刚保存");
    await page.locator('[data-action="cancel-edit-order"]').click();
    await page.evaluate(() => window.EPhoneLifeMarket.open({ tab: "orders" }));
    const afterLedgerDeletion = await page.evaluate(async () => {
      const key = "chat:owner", ledger = await new window.ephoneCharacterWalletCore.Service(window.db).ledger(key);
      const bill = ledger.find((row) => row.orderId === "edit-order" && row.name === "精装练习册");
      const result = await new window.ephoneFinanceRecordsCore.Service(window.db).deleteLedger(key, bill);
      await window.EPhoneMarketAdapter.onPaid(result);
      return { result, billId: bill.id };
    });
    assert.equal(afterLedgerDeletion.result.balance, 983);
    await page.evaluate(() => window.EPhoneLifeMarket.open({ tab: "orders" }));
    assert.equal(await page.locator(".market-order").count(), 1, "ledger deletion retains the shopping order and items");
    assert.match(await page.locator(".market-payment-state").innerText(), /实付 ¥17.00/);
    await page.locator('[data-action="edit-order"]').click();
    await editor.locator('[data-line-field="price"][data-line-index="0"]').fill("20");
    await page.evaluate(() => {
      const proto = window.ephoneFinanceRecordsCore.Service.prototype, original = proto.editOrder;
      window.fixtureOrderSaveCalls = 0;
      proto.editOrder = async function (...args) {
        window.fixtureOrderSaveCalls++;
        await new Promise((resolve) => { window.fixtureReleaseOrderSave = resolve; });
        proto.editOrder = original;
        return original.apply(this, args);
      };
    });
    await editor.locator('[type="submit"]').click();
    await page.waitForFunction(() => window.EPhoneLifeMarket.isBusy() && window.fixtureReleaseOrderSave);
    assert.equal(await editor.locator('[type="submit"]').isDisabled(), true);
    assert.equal(await page.locator('[data-action="delete-order"]').isDisabled(), true);
    await page.evaluate(() => window.fixtureReleaseOrderSave()); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(await page.evaluate(() => window.fixtureOrderSaveCalls), 1);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 983, "editing a revoked product must not charge it again");
    assert.equal(await page.evaluate(async () => (await window.db.marketOrders.get("edit-order")).total), 77);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator('[data-action="delete-order"]').click();
    assert.equal(await page.locator(".market-order").count(), 1, "cancel deletion leaves the order visible");
    page.once("dialog", async (dialog) => { assert.match(dialog.message(), /角色资产.*保留/); assert.match(dialog.message(), /不会重复/); await dialog.accept(); });
    await page.locator('[data-action="delete-order"]').click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    assert.equal(await page.locator(".market-order").count(), 0);
    const deleted = await page.evaluate(async () => ({ order: await window.db.marketOrders.get("edit-order"), wallet: await window.db.userWallet.get("main"), bills: await window.db.userTransactions.toArray(), chat: await window.db.chats.get("watch"), cart: (await window.db.marketState.get("main")).cart }));
    assert.equal(deleted.order.marketHidden, true); assert.equal(deleted.wallet.balance, 1000); assert.equal(deleted.order.paidAmount, 0);
    assert.equal(deleted.order.items.length, 2); assert.equal(deleted.bills.length, edited.bills.length, "order deletion retains the ledger rows");
    assert.equal(deleted.bills.filter((row) => row.ledgerHidden === true).length, 1, "only the previously deleted ledger record stays hidden");
    assert.ok(deleted.bills.every((row) => row.status === "voided"));
    assert.equal(deleted.chat.history.length, edited.chat.history.length, "order chat cards are retained");
    const cardText = await page.evaluate(async () => {
      const message = (await window.db.chats.get("watch")).history.find((row) => row.orderId === "edit-order");
      return (await window.EPhoneLifeMarket.renderOrderMessage(message)).textContent;
    });
    assert.match(cardText, /商品保留·款项已撤销/); assert.match(cardText, /实付 ¥0.00/); assert.doesNotMatch(cardText, /已支付·待到货/, "retained chat cards must not claim a reversed order is still paid");
    assert.deepEqual(deleted.cart, initial.cart);
    await page.evaluate(async () => new window.ephoneFinanceRecordsCore.Service(window.db).deleteOrder("edit-order"));
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 1000, "repeat deletion never refunds twice");
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.evaluate(() => window.EPhoneLifeMarket.open({ tab: "orders" })); assert.equal(await page.locator(".market-order").count(), 0);
    await page.evaluate(async () => {
      const store = new window.ephoneLifeMarketCore.Store(window.db), state = await store.load();
      const owner = await window.ephonePlayerIdentity.load(window.db);
      await store.checkout({ orderId: "order-only-delete", expectedCart: state.cart, selectedItemIds: ["kept"], owner, vts: Date.now(), now: Date.now(), spaceId: "default", cardChatId: null });
      await window.EPhoneLifeMarket.open({ tab: "orders" });
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-action="delete-order"]').click(); await page.waitForFunction(() => !window.EPhoneLifeMarket.isBusy());
    const retained = await page.evaluate(async () => ({ wallet: await window.db.userWallet.get("main"), bills: (await window.db.userTransactions.toArray()).filter((row) => row.orderId === "order-only-delete") }));
    assert.equal(retained.wallet.balance, 1000); assert.equal(retained.bills.length, 1);
    assert.equal(retained.bills[0].ledgerHidden, undefined); assert.equal(retained.bills[0].status, "voided", "deleting only the order leaves its ledger record visible with reversed funds");
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    console.log("PASS: mobile order editing/difference reconciliation, cart/privacy/card preservation, failure drafts/stale snapshots, busy single-save, ledger-first and order-only independent deletion, revoked-item edits, idempotent refund, persistence and no provider calls");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
