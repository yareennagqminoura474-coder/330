// Requires playwright-core and dexie in the test environment, plus local Chrome.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright-core");

(async () => {
  const root = __dirname;
  const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, "." + (relative === "/" ? "/index.html" : relative));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript",
        body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      return route.abort(); // No remote AI calls, images, analytics or user data.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.db && window.refreshPersonaSpaceData && window.openAlipayScreen, { timeout: 30000 });
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const members = [
        { id: "payer", originalName: "付款角色", groupNickname: "付款角色", persona: "我是付款角色。", avatar },
        { id: "stand-in", originalName: "代聊角色", groupNickname: "代聊角色", persona: "我是代聊角色。", avatar },
      ];
      for (const member of members) await window.db.chats.put({ id: member.id, name: member.originalName, originalName: member.originalName,
        isGroup: false, history: [], settings: { aiPersona: member.persona, aiAvatar: avatar, maxMemory: 20 }, avatar });
      await window.db.userWallet.put({ id: "main", balance: 10, kinshipCards: [], fundHoldings: [] });
      await window.db.chats.put({ id: "wallet-test-watch", name: "钱包测试群", isGroup: true, isSpectatorGroup: true, avatar, members,
        settings: { maxMemory: 20, myNickname: "我", linkedMemoryChatIds: [] }, history: [
          { role: "assistant", type: "transfer", senderName: "付款角色", receiverName: "代聊角色", amount: 12.34, timestamp: 100, vts: 1770000000000 },
          { role: "assistant", type: "red_packet", senderName: "付款角色", receiverName: "代聊角色", packetType: "direct", totalAmount: 5.66, count: 1,
            claimedBy: {}, timestamp: 101, vts: 1770000000000 },
        ] });
      await window.refreshPersonaSpaceData();
      window.showScreen("chat-list-screen");
    });
    await page.locator('.chat-list-item[data-chat-id="wallet-test-watch"]').click();
    const transfer = page.locator('.message-bubble[data-timestamp="100"] .ephone-spectator-money-card');
    await transfer.getByRole("button", { name: "接收", exact: true }).click();
    await page.getByRole("button", { name: "替 代聊角色 接收转账", exact: true }).click();
    await page.waitForFunction(async () => (await window.db.userWallet.get("main"))?.balance === 22.34);
    await page.waitForFunction(() => document.getElementById("custom-modal-overlay")?.textContent.includes("已存入本空间的钱包"));
    await page.locator("#custom-modal-overlay button").filter({ hasText: /好的|确定|好/ }).last().click();
    assert.equal(await transfer.getByRole("button").count(), 0);
    assert.match(await transfer.innerText(), /已接收/);
    const packet = page.locator('.message-bubble[data-timestamp="101"] .ephone-spectator-money-card');
    await packet.getByRole("button", { name: "领取", exact: true }).click();
    await page.getByRole("button", { name: "替 代聊角色 领取红包", exact: true }).click();
    await page.waitForFunction(async () => (await window.db.userWallet.get("main"))?.balance === 28);
    await page.waitForFunction(() => document.getElementById("custom-modal-overlay")?.textContent.includes("已存入本空间的钱包"));
    await page.locator("#custom-modal-overlay button").filter({ hasText: /好的|确定|好/ }).last().click();
    await page.evaluate(() => window.openAlipayScreen());
    await page.waitForFunction(() => document.getElementById("alipay-balance-display")?.textContent === "28.00");
    assert.equal(await page.locator("#alipay-balance-display").textContent(), "28.00");
    await page.waitForSelector("#alipay-screen.active");
    assert.match(await page.locator("#wallet-space-label").textContent(), /默认空间/);
    const bills = await page.evaluate(() => window.db.userTransactions.toArray());
    assert.equal(bills.length, 2);
    assert.equal(bills.reduce((sum, bill) => sum + Math.round(bill.amount * 100), 0), 1800);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.db && window.refreshPersonaSpaceData);
    const status = await page.evaluate(async () => {
      const chat = await window.db.chats.get("wallet-test-watch");
      return { balance: (await window.db.userWallet.get("main")).balance, status: chat.history[0].status, claimed: chat.history[1].claimedBy["代聊角色"] };
    });
    assert.deepEqual(status, { balance: 28, status: "accepted", claimed: 5.66 });
    await page.evaluate(async () => {
      const spaces = JSON.parse(localStorage.getItem("ephone-persona-spaces-v1"));
      localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([...spaces, { id: "wallet-other", name: "另一个空间" }]));
      await window.EPhoneSpaces.switchSpace("wallet-other");
      await window.openAlipayScreen();
    });
    assert.equal(await page.locator("#alipay-balance-display").textContent(), "0.00");
    assert.match(await page.locator("#wallet-space-label").textContent(), /另一个空间/);
    assert.equal(await page.evaluate(() => window.db.userTransactions.count()), 0);
    await page.evaluate(async () => {
      await window.EPhoneSpaces.switchSpace("default");
      await window.openAlipayScreen();
    });
    assert.equal(await page.locator("#alipay-balance-display").textContent(), "28.00");
    assert.match(await page.locator("#wallet-space-label").textContent(), /默认空间/);
    assert.equal(await page.evaluate(() => window.db.userTransactions.count()), 2);
    assert.deepEqual(errors, []);
    console.log("Real mobile browser card clicks, wallet deposit and reload tests passed.");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
