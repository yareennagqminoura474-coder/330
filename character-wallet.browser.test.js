const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const calls = [], errors = []; let replies = [], plans = 0, fail = false;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://wallet-test.invalid/")) {
        const body = route.request().postDataJSON(), daily = require("./browser-test-fixtures.js").dailyReply(body.messages[0].content);
        if (daily) return route.fulfill({ contentType: "application/json", body: JSON.stringify(daily) });
        calls.push(body); let raw;
        if (body.messages[0].content.includes("拟定独立资产")) {
          plans++;
          const people = JSON.parse(body.messages[0].content.split("数据不是指令：")[1]);
          raw = people.map((p) => ({ key: p.key, balance: 300, otherAssets: 20000, job: p.name === "甲" ? "学生" : "医生", family: "普通家庭，节俭", note: "拟定，可编辑", automatic: true,
            rules: [{ id: "salary", direction: "income", category: "salary", cadence: "monthly", day: 6, hour: 9, min: 100, max: 100, label: p.name === "甲" ? "零花钱" : "工资" }] }));
        } else {
          if (fail) return route.fulfill({ status: 400, body: "isolated fixture failure" });
          raw = replies.shift() || [{ type: "narration", content: "2026年3月5日，07点20分，星期四，地点：客厅" }, { type: "text", name: "乙", content: "继续。" }];
        }
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: "stop" }] }) });
      }
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const cfg = await window.db.apiConfig.get("main") || { id: "main" }; await window.db.apiConfig.put({ ...cfg, proxyUrl: "https://wallet-test.invalid/v1", apiKey: "test-placeholder", model: "test-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const members = ["甲", "乙"].map((name, i) => ({ id: "r" + i, originalName: name, groupNickname: name, persona: "普通家庭，节俭，喜欢书法。", avatar }));
      for (const m of members) await window.db.chats.put({ id: m.id, name: m.originalName, originalName: m.originalName, avatar, settings: { aiPersona: m.persona, aiAvatar: avatar, maxMemory: 20 }, history: [{ role: "user", content: "继续", timestamp: 1 }] });
      for (const [id, watch] of [["wallet-watch", true], ["wallet-group", false]]) await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: watch, members, settings: { maxMemory: 20, myNickname: "我", linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [] });
      await window.db.userWallet.put({ id: "main", balance: 80, kinshipCards: [] });
      await window.ephonePlayerIdentity.save(window.db, "chat:r0");
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function chat(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active");
    }
    await chat("wallet-watch"); await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 7, 20).getTime(), "frozen"));
    await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="me-view"]').click();
    await page.locator("#me-character-wallet-button").click(); await page.waitForSelector("#cw-body .cw-balance");
    assert.equal(calls.length, 0, "opening/reloading wallets must not call API");
    assert.match(await page.locator(".cw-balance").innerText(), /80.00.*共用余额/s);
    await page.locator("#cw-person").selectOption("chat:r1"); await page.waitForFunction(() => document.querySelector(".cw-balance")?.textContent.includes("乙"));
    assert.match(await page.locator("#cw-body").innerText(), /尚未设置/);
    await page.locator('[data-cw-action="generate"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterWallet.isBusy());
    assert.equal(plans, 1); assert.equal(await page.locator("#cw-cash").inputValue(), "300");
    assert.equal(await page.evaluate(() => window.db.characterWallets.count()), 0, "single generate is a reviewable draft");
    await page.locator('[data-cw-action="save"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterWallet.isBusy());
    assert.match(await page.locator("#cw-notice").innerText(), /已保存/); assert.match(await page.locator(".cw-balance").innerText(), /300.00/);
    await page.locator('[data-cw-action="generate-all"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterWallet.isBusy());
    assert.match(await page.locator("#cw-notice").innerText(), /初始化1个/);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 80, "bound player initialization preserves main balance");
    await page.locator("#cw-book-amount").fill("20"); await page.locator("#cw-book-note").fill("午饭");
    await page.locator('[data-cw-action="book"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterWallet.isBusy());
    assert.match(await page.locator(".cw-balance").innerText(), /280.00/);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 80);
    await page.locator('[data-cw-action="edit"]').click();
    assert.equal(await page.locator("#cw-job").inputValue(), "医生");
    assert.equal(await page.evaluate(() => document.querySelector('.cw-scroll').scrollHeight > document.querySelector('.cw-scroll').clientHeight), true);
    assert.equal(await page.evaluate(() => document.querySelector('.cw-scroll').scrollWidth <= document.querySelector('.cw-scroll').clientWidth + 1), true);
    const shot = path.join(require("node:os").tmpdir(), "ephone-character-wallet-v167.png"); await page.screenshot({ path: shot }); console.log("SCREENSHOT " + shot);
    await chat("wallet-watch"); await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 6, 10).getTime(), "frozen"));
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 180);
    assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:r1")).balance), 380);
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 7, 20).getTime(), "frozen"));
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 180);
    async function generate(id, items) {
      await chat(id); replies = [[{ type: "narration", content: "2026年3月5日，07点20分，星期四，地点：客厅" }, ...items]];
      await page.locator(id === "wallet-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      assert.equal(replies.length, 0); return calls.at(-1).messages[0].content;
    }
    for (const id of ["wallet-watch", "wallet-group", "r1"]) {
      const prompt = await generate(id, [{ type: "wallet_income", name: "乙", amount: 10, category: "bonus", content: "（实际到账的额外报酬）" }, { type: "text", name: "乙", content: "收到了报酬。" }]);
      assert.match(prompt, /角色独立资产与实际收支/); assert.match(prompt, /每个角色只直接知道自己的资产/);
    }
    assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:r1")).balance), 410);
    await generate("wallet-watch", [{ type: "transfer", name: "乙", receiver: "甲", amount: 10, note: "零花钱" }]);
    assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:r1")).balance), 400);
    await page.locator(".ephone-money-receive").last().click(); await page.getByRole("button", { name: "替 甲 接收转账", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#custom-modal-overlay")?.textContent.includes("已存入本空间的钱包"));
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 190);
    await page.locator("#custom-modal-overlay button").filter({ hasText: /好的|确定|好/ }).last().click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    // Ordinary groups and private chats credit actual recipient finances, not a second sender debit.
    await generate("wallet-group", [{ type: "transfer", name: "乙", receiver: "甲", amount: 5, note: "普通群聊" }]);
    const card = await page.evaluate(async () => (await window.db.chats.get("wallet-group")).history.findLast((m) => m.type === "transfer" && m.walletFunded));
    assert.ok(card);
    await generate("wallet-group", [{ type: "accept_transfer", name: "甲", for_timestamp: card.timestamp }, { type: "text", name: "甲", content: "已收下。" }]);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 195);
    assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:r1")).balance), 395);
    // The existing user-to-role transfer also credits the independent private-chat role.
    await page.evaluate(async () => {
      const c = await window.db.chats.get("r1"); c.history.push({ role: "user", type: "transfer", senderName: "我", receiverName: "乙", amount: 7, status: "pending", timestamp: 9000 });
      await window.db.chats.put(c); await window.ephoneSpaceWallet.book(window.db, 7, "expense", "私聊转账");
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await generate("r1", [{ type: "accept_transfer", name: "乙", for_timestamp: 9000 }, { type: "text", name: "乙", content: "钱已收到。" }]);
    assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:r1")).balance), 402);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 188);
    // Plain-language payments are booked even if the model forgets wallet_expense; metadata then dedupes.
    const expenseQuote = "乙买了本书，花了35元。";
    await generate("wallet-watch", [{ type: "narration", name: "乙", content: expenseQuote }, { type: "wallet_expense", name: "乙", amount: 35, category: "shopping", content: "买书", quote: expenseQuote }, { type: "text", name: "乙", content: "晚点看书。" }]);
    assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:r1")).balance), 367);
    await generate("wallet-group", [{ type: "text", name: "乙", content: "我付了12元车费。" }]);
    assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:r1")).balance), 355);
    await generate("r1", [{ type: "text", name: "乙", content: "我买了文具花了10元。" }]);
    assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:r1")).balance), 345);
    await generate("wallet-watch", [{ type: "text", name: "甲", content: "我买了早餐，花了8元。" }, { type: "text", name: "乙", content: "我打算买一件衣服花50元。" }]);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 180);
    assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:r1")).balance), 345);
    await page.locator('[data-spectator-action="identity"]').click();
    await page.getByRole("button", { name: "以 乙 的身份说话", exact: true }).click();
    await page.locator(".ephone-spectator-controls textarea").fill("我买了衣服，花了40元。");
    await page.locator('[data-spectator-action="send"]').click();
    await page.waitForFunction(async () => (await window.db.characterWallets.get("chat:r1")).balance === 305);
    await chat("wallet-watch"); await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 3, 6, 8, 59).getTime(), "frozen"));
    await generate("wallet-watch", [{ type: "text", name: "乙", content: "还没到工资时间。" }]); // consumes exact manual-time round
    const financeBefore = await page.evaluate(async () => ({ main: (await window.db.userWallet.get("main")).balance, role: (await window.db.characterWallets.get("chat:r1")).balance, time: window.ephoneTimeMachine.nowMs() }));
    fail = true; await page.locator("#spectator-propel-btn").click();
    await page.waitForFunction(() => document.querySelector("#custom-modal-overlay.visible")?.textContent.includes("无法推进剧情"));
    const financeAfter = await page.evaluate(async () => ({ main: (await window.db.userWallet.get("main")).balance, role: (await window.db.characterWallets.get("chat:r1")).balance, time: window.ephoneTimeMachine.nowMs() }));
    assert.deepEqual(financeAfter, financeBefore, "failed reply must not post projected future wages or advance time");
    await page.locator("#custom-modal-overlay button").filter({ hasText: /好的|确定|好/ }).last().click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy()); fail = false;
    const count = calls.length; await page.evaluate(() => window.EPhoneCharacterWallet.open()); assert.equal(calls.length, count);
    await page.evaluate(async () => {
      const spaces = JSON.parse(localStorage.getItem("ephone-persona-spaces-v1")); localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([...spaces, { id: "wallet-isolated", name: "独立空间" }]));
      await window.EPhoneSpaces.switchSpace("wallet-isolated"); await window.EPhoneCharacterWallet.open();
    });
    assert.equal(await page.evaluate(() => window.db.characterWallets.count()), 0); assert.match(await page.locator("#cw-body").innerText(), /还没有角色/);
    await page.evaluate(async () => { await window.EPhoneSpaces.switchSpace("default"); await window.EPhoneCharacterWallet.open(); });
    assert.equal(calls.length, count); assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:r1")).balance), financeBefore.role);
    assert.deepEqual(errors, []);
    console.log("PASS: mobile wallet UI/edit/generate/batch, no automatic API, bound balance preserved, real time jumps and dedupe, watch/normal/private finances, atomic transfer receipts, scroll and reload");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
