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
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      for (const [id, name] of [["giver", "甲"], ["child", "乙"]]) await window.db.chats.put({ id, name, originalName: name, avatar, history: [], settings: { aiPersona: "普通家庭成年人", aiAvatar: avatar, maxMemory: 20 } });
      await window.db.userWallet.put({ id: "main", balance: 80, fundHoldings: ["preserved"] });
      await window.ephonePlayerIdentity.save(window.db, "chat:child");
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
    await page.locator('.chat-list-item[data-chat-id="giver"]').click(); await page.waitForSelector("#chat-interface-screen.active");
    await page.evaluate(async () => {
      await window.ephoneTimeMachine.jumpTo(new Date(2026, 0, 4, 8).getTime(), "frozen");
      const service = new window.ephoneCharacterWalletCore.Service(window.db);
      await service.save("chat:giver", { balance: 1000, otherAssets: 3000, job: "上班族", rules: [], automatic: true }, window.ephoneTimeMachine.nowMs(), 0);
      await window.EPhoneCharacterWallet.open();
    });
    await page.locator("#cw-person").selectOption("chat:giver"); await page.waitForFunction(() => document.querySelector(".cw-balance")?.textContent.includes("1000.00"));
    await page.locator('[data-cw-action="edit"]').click(); await page.locator('[data-cw-action="add-rule"]').click();
    const rule = page.locator(".cw-rule");
    await rule.locator('[data-field="label"]').fill("每周生活费");
    await rule.locator('[data-field="category"]').fill("allowance");
    await rule.locator('[data-field="cadence"]').selectOption("weekly");
    await rule.locator('[data-field="day"]').fill("1"); await rule.locator('[data-field="hour"]').fill("9");
    await rule.locator('[data-field="min"]').fill("100"); await rule.locator('[data-field="max"]').fill("100");
    await rule.locator('[data-field="counterpartyKey"]').selectOption("chat:child");
    assert.equal(await rule.locator('[data-field="counterpartyKey"] option[value="chat:giver"]').count(), 0, "can't select self");
    await rule.locator('[data-field="counterpartyKey"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-transfer-plan-v17101.png") });
    await page.locator('[data-cw-action="save"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterWallet.isBusy());
    assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:giver")).rules[0].counterpartyKey), "chat:child");
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 0, 5, 10).getTime(), "frozen"));
    assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:giver")).balance), 900);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 180);
    await page.evaluate(() => window.EPhoneCharacterWallet.open()); await page.locator("#cw-person").selectOption("chat:child");
    await page.waitForFunction(() => document.querySelector(".cw-balance")?.textContent.includes("180.00"));
    assert.equal(await page.locator(".cw-entry").filter({ hasText: "收到甲的定期款项" }).count(), 1);
    assert.match(await page.locator(".cw-entry").filter({ hasText: "收到甲的定期款项" }).innerText(), /\+100\.00/);
    await page.locator(".cw-entry").filter({ hasText: "收到甲的定期款项" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-transfer-receipt-v17101.png") });
    await page.locator("#cw-settle").click(); await page.waitForFunction(() => !window.EPhoneCharacterWallet.isBusy());
    assert.equal(await page.locator(".cw-entry").filter({ hasText: "收到甲的定期款项" }).count(), 1);
    await page.locator("#cw-person").selectOption("chat:giver"); await page.waitForFunction(() => document.querySelector(".cw-balance")?.textContent.includes("900.00"));
    assert.equal(await page.locator(".cw-entry").filter({ hasText: "定期转给乙" }).count(), 1);
    assert.match(await page.locator(".cw-entry").filter({ hasText: "定期转给乙" }).innerText(), /−100\.00/);
    await page.evaluate(() => window.openAlipayScreen()); await page.waitForSelector("#alipay-screen.active");
    await page.waitForFunction(() => document.querySelector("#alipay-balance-display")?.textContent.includes("180.00"));
    assert.equal(await page.locator(".bill-item").filter({ hasText: "收到甲的定期款项" }).count(), 1);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.evaluate(() => window.EPhoneCharacterWallet.open()); await page.locator("#cw-person").selectOption("chat:giver");
    await page.waitForFunction(() => document.querySelector(".cw-balance")?.textContent.includes("900.00"));
    await page.locator('[data-cw-action="edit"]').click();
    assert.equal(await page.locator('[data-field="counterpartyKey"]').inputValue(), "chat:child");
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 180);
    const rows = await page.evaluate(() => window.db.characterTransactions.filter((r) => r.transferId).toArray());
    assert.equal(rows.length, 2); assert.equal(rows[0].transferId, rows[1].transferId);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    console.log("PASS: mobile plan recipient selection/save/reload, real virtual-time jump pays both sides, character and bound-space wallet/bills agree, repeated settlement no duplicate, no API calls or page errors");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
