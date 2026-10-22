const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const errors = [], generationRequests = [], fixed = new Date(2026, 9, 22, 10, 0).getTime();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (/chat\/completions|generateContent/.test(url)) generationRequests.push(url);
      return route.abort(); // Isolated browser fixtures; never make real API or money calls.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async (fixed) => {
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      for (const [id, name] of [["ledger-owner", "甲"], ["ledger-role", "乙"]]) {
        await window.db.chats.put({ id, name, originalName: name, avatar, history: [], settings: { aiPersona: "普通家庭成年人", aiAvatar: avatar, maxMemory: 20 } });
        await window.db.characterWallets.put({ key: "chat:" + id, balance: 1000, otherAssets: 0, configured: true, automatic: false, rules: [], revision: 1, settledThrough: fixed });
      }
      await window.ephonePlayerIdentity.save(window.db, "chat:ledger-owner");
      await window.db.userWallet.put({ id: "main", balance: 2000, kinshipCards: [] });
    }, fixed);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady && window.ephoneFinanceRecordsCore?.Service);
    await page.evaluate((fixed) => { window.ephoneTimeMachine.nowMs = () => fixed; }, fixed);
    const ownBalance = () => page.evaluate(async () => (await window.db.characterWallets.get("chat:ledger-role")).balance);
    const mainBalance = () => page.evaluate(async () => (await window.db.userWallet.get("main")).balance);
    async function assertMainUnchanged() {
      assert.equal(await mainBalance(), 2000, "independent role edits do not touch the main wallet");
      assert.equal(await page.evaluate(() => window.userBalance), 2000, "independent role edits do not contaminate the cached main wallet display");
    }
    const row = (description) => page.locator(".cw-entry").filter({ hasText: description });
    async function wallet(personKey = "chat:ledger-role") {
      await page.evaluate(() => window.EPhoneCharacterWallet.open());
      await page.waitForFunction(() => !window.EPhoneCharacterWallet.isBusy());
      await page.locator("#cw-person").selectOption(personKey);
      await page.waitForFunction((name) => document.querySelector(".cw-balance")?.textContent.includes(name), personKey === "chat:ledger-role" ? "乙" : "甲");
    }
    async function act(target, action) {
      await target.locator(`[data-cw-action="${action}"]`).click();
      await page.waitForFunction(() => !window.EPhoneCharacterWallet.isBusy());
    }
    async function saveEdit() {
      await page.locator('[data-cw-action="save-entry"]').click();
      await page.waitForFunction(() => !window.EPhoneCharacterWallet.isBusy());
    }
    await page.evaluate(async (fixed) => {
      const s = new window.ephoneCharacterWalletCore.Service(window.db);
      await s.book("chat:ledger-role", 80, "expense", { id: "edit-expense", vts: fixed - 30000, category: "food", description: "旧午饭支出" });
      await s.book("chat:ledger-role", 25, "income", { id: "delete-income", vts: fixed - 20000, category: "bonus", description: "收入测试" });
    }, fixed);
    await wallet();
    assert.equal(await ownBalance(), 945);
    await act(row("旧午饭支出"), "edit-entry");
    await page.locator("#cw-entry-amount").fill("100");
    await page.locator("#cw-entry-description").fill("纸笔文具改正");
    await page.locator("#cw-entry-category").fill("shopping");
    await page.locator("#cw-entry-time").fill("2026-10-22T09:20");
    await saveEdit();
    assert.match(await page.locator("#cw-notice").innerText(), /已保存/);
    assert.equal(await ownBalance(), 925, "editing 80 to 100 debits only the 20 difference");
    const edited = await page.evaluate(() => window.db.characterTransactions.get("edit-expense"));
    assert.equal(edited.description, "纸笔文具改正"); assert.equal(edited.category, "shopping");
    assert.equal(edited.vts, new Date(2026, 9, 22, 9, 20).getTime());
    await assertMainUnchanged();
    await act(row("纸笔文具改正"), "delete-entry");
    assert.equal(await ownBalance(), 1025, "deleting expense refunds the edited amount");
    assert.equal(await row("纸笔文具改正").count(), 0);
    assert.equal((await page.evaluate(() => window.db.characterTransactions.get("edit-expense"))).ledgerHidden, true);
    await assertMainUnchanged();
    await act(row("收入测试"), "delete-entry");
    assert.equal(await ownBalance(), 1000, "deleting income removes that credit");
    await assertMainUnchanged();
    // A spent income cannot be erased at the cost of a negative wallet, and a
    // failed edit keeps the draft so users can correct it without retyping.
    await page.evaluate(async (fixed) => {
      const s = new window.ephoneCharacterWalletCore.Service(window.db);
      await s.book("chat:ledger-role", 1000, "income", { id: "spent-income", vts: fixed - 10000, description: "已花掉的收入" });
      await s.book("chat:ledger-role", 1900, "expense", { id: "large-expense", vts: fixed - 5000, description: "大额消费" });
    }, fixed);
    await wallet(); await act(row("已花掉的收入"), "delete-entry");
    assert.equal(await ownBalance(), 100);
    assert.equal(await row("已花掉的收入").count(), 1);
    assert.match(await page.locator("#cw-notice").innerText(), /不足|负数/);
    assert.equal((await page.evaluate(() => window.db.characterTransactions.get("spent-income"))).status, "posted");
    await act(row("大额消费"), "edit-entry");
    await page.locator("#cw-entry-amount").fill("2100");
    await page.locator("#cw-entry-description").fill("保留失败编辑草稿");
    await saveEdit();
    assert.equal(await ownBalance(), 100); assert.equal(await page.locator("#cw-entry-amount").inputValue(), "2100");
    assert.equal(await page.locator("#cw-entry-description").inputValue(), "保留失败编辑草稿");
    await page.locator('[data-cw-action="cancel-entry-edit"]').click();
    await assertMainUnchanged();
    // Older bills remain reachable and editable instead of silently falling
    // outside the first 200 rendered rows on a small phone screen.
    await page.evaluate(async (fixed) => {
      await window.db.characterTransactions.bulkAdd(Array.from({ length: 205 }, (_, i) => ({ id: "old-ledger:" + i, key: "chat:ledger-role", direction: "expense", amount: 0,
        plannedAmount: 1, status: "insufficient", vts: fixed - 60000 * (i + 1), timestamp: i + 1, description: "历史账单第" + (i + 1) + "笔", category: "other", walletDestination: "character" })));
    }, fixed);
    await wallet(); assert.equal(await page.locator(".cw-entry").count(), 200);
    await page.locator('[data-cw-action="more-entries"]').click(); assert.equal(await page.locator(".cw-entry").count(), 207);
    await act(row("历史账单第205笔"), "edit-entry");
    assert.equal(await page.locator("#cw-entry-amount").isDisabled(), true);
    await page.locator("#cw-entry-description").fill("历史未入账账单只改说明"); await saveEdit();
    assert.equal(await ownBalance(), 100); await assertMainUnchanged();
    // The wallet and market are independent views of one financial event.
    await page.evaluate(async (fixed) => {
      const cart = [
        { item: { id: "pencil", name: "独立保留铅笔", kind: "goods", price: 10, merchant: "文具店" }, quantity: 2 },
        { item: { id: "notebook", name: "独立保留笔记本", kind: "goods", price: 20, merchant: "文具店" }, quantity: 1 },
      ];
      await window.db.marketState.put({ ...window.ephoneLifeMarketCore.blank(), cart });
      await new window.ephoneLifeMarketCore.Store(window.db).checkout({ orderId: "ledger-first-order", expectedCart: cart, target: { recipientName: "甲" }, owner: { key: "chat:ledger-owner", name: "甲" }, cardChatId: null, vts: fixed, spaceId: "default" });
    }, fixed);
    await wallet("chat:ledger-owner"); assert.equal(await mainBalance(), 1960);
    await act(row("独立保留笔记本"), "delete-entry");
    assert.equal(await mainBalance(), 1980);
    let order = await page.evaluate(() => window.db.marketOrders.get("ledger-first-order"));
    assert.equal(Boolean(order.marketHidden), false); assert.equal(order.items.length, 2);
    await page.evaluate(() => window.EPhoneLifeMarket.open({ tab: "orders" }));
    await page.waitForSelector('[data-order-record="ledger-first-order"]');
    assert.match(await page.locator('[data-order-record="ledger-first-order"]').innerText(), /独立保留笔记本/);
    await page.evaluate(async () => {
      const snapshot = await window.db.marketOrders.get("ledger-first-order");
      await new window.ephoneFinanceRecordsCore.Service(window.db).deleteOrder(snapshot.id, { expected: snapshot });
    });
    assert.equal(await mainBalance(), 2000, "order deletion refunds only the other still-paid line");
    await wallet("chat:ledger-owner");
    assert.equal(await row("独立保留笔记本").count(), 0, "deleting order must not restore an already hidden ledger line");
    assert.match(await row("独立保留铅笔").innerText(), /款项已撤销/);
    await act(row("独立保留铅笔"), "delete-entry");
    assert.equal(await mainBalance(), 2000, "deleting the retained reversed bill never refunds twice");
    order = await page.evaluate(() => window.db.marketOrders.get("ledger-first-order"));
    assert.equal(order.marketHidden, true); assert.equal(order.items.length, 2);
    // Reverse order: delete the order first, then only the chosen retained bill.
    await page.evaluate(async (fixed) => {
      const cart = [{ item: { id: "book", name: "先删订单保留账单图书", kind: "goods", price: 35, merchant: "书店" }, quantity: 1 }];
      await window.db.marketState.put({ ...window.ephoneLifeMarketCore.blank(), cart });
      await new window.ephoneLifeMarketCore.Store(window.db).checkout({ orderId: "order-first", expectedCart: cart, target: { recipientName: "甲" }, owner: { key: "chat:ledger-owner", name: "甲" }, cardChatId: null, vts: fixed, spaceId: "default" });
      const expected = await window.db.marketOrders.get("order-first");
      await new window.ephoneFinanceRecordsCore.Service(window.db).deleteOrder(expected.id, { expected });
    }, fixed);
    assert.equal(await mainBalance(), 2000);
    await wallet("chat:ledger-owner");
    assert.match(await row("先删订单保留账单图书").innerText(), /款项已撤销/);
    await act(row("先删订单保留账单图书"), "edit-entry");
    assert.equal(await page.locator("#cw-entry-amount").isDisabled(), true, "editing reversed descriptions cannot turn a payment back on");
    await page.locator("#cw-entry-description").fill("撤销后仍可改说明"); await saveEdit();
    assert.equal(await mainBalance(), 2000);
    await act(row("撤销后仍可改说明"), "delete-entry"); assert.equal(await mainBalance(), 2000);
    assert.equal((await page.evaluate(() => window.db.marketOrders.get("order-first"))).items.length, 1);
    const layout = await page.evaluate(() => { const el = document.querySelector(".cw-scroll"); return { width: el.clientWidth, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, height: el.clientHeight }; });
    assert.ok(layout.scrollWidth <= layout.width + 1); assert.ok(layout.scrollHeight > layout.height);
    assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), fixed, "record edits do not change virtual time");
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-ledger-edit-v17111.png") });
    assert.deepEqual(generationRequests, []); assert.deepEqual(errors, []);
    console.log("PASS: actual mobile ledger edit/delete, delta-only balance, income rollback guard, failed draft preserved, independent order/ledger views in both deletion orders, one-time reversal, no API and no clock changes");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
