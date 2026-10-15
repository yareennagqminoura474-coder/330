const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core"), { dailyReply } = require("./browser-test-fixtures.js");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname), file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const errors = [], calls = []; let actions = [], images = 0, correction = null;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept(d.type() === "prompt" ? correction || "30" : undefined));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://image.pollinations.ai/")) { images++; if (url.includes("bad-image")) return route.abort(); return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="skyblue"/></svg>' }); }
      if (!url.startsWith("https://finance-main.invalid/") && !url.startsWith("https://finance-aux.invalid/")) return route.abort();
      const body = route.request().postDataJSON(), prompt = body.messages[0].content;
      if (prompt.includes("独立生活当天行程规划师")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(dailyReply(prompt)) });
      assert.ok(url.startsWith("https://finance-main.invalid/"), "bookkeeping and image viewing do not call an auxiliary model"); calls.push(body);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify([{ type: "narration", content: "2026年3月5日，10点00分，星期四，地点：奶茶店" }, ...actions]) }, finish_reason: "stop" }] }) });
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://finance-main.invalid/v1", apiKey: "fake-main", model: "reply", secondaryProxyUrl: "https://finance-aux.invalid/v1", secondaryApiKey: "fake-aux", secondaryModel: "aux" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="pink"/></svg>');
      const members = ["林老师", "周老师"].map((name, i) => ({ id: "f" + i, originalName: name, groupNickname: name, persona: "成年人，教师，普通家庭，节俭。", avatar }));
      const history = [{ role: "assistant", senderName: "林老师", type: "text", content: "奶茶每杯18元。", timestamp: 100, vts: new Date(2026, 2, 5, 9).getTime() }];
      for (const m of members) await window.db.chats.put({ id: m.id, name: m.originalName, originalName: m.originalName, avatar, settings: { aiPersona: m.persona, aiAvatar: avatar, maxMemory: 30 }, history: structuredClone(history), longTermMemory: [] });
      for (const [id, watch] of [["finance-watch", true], ["finance-group", false]]) await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: watch, members, settings: { myNickname: "我", maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: structuredClone(history) });
      await window.db.spaceProfiles.put({ id: "player", key: "chat:f0", name: "林老师" }); await window.db.userWallet.put({ id: "main", balance: 1000 });
      await window.db.characterWallets.bulkPut(members.map((m) => ({ key: "chat:" + m.id, configured: true, automatic: false, balance: 1000, rules: [], revision: 0 })));
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function chat(id) { await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click(); await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active"); }
    async function generate(id, next) { actions = next; await chat(id); await page.locator(id === "finance-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy()); }
    async function erase(id, stamp, button = "selection-erase-btn") {
      await chat(id); const bubble = page.locator(`.message-bubble[data-timestamp="${stamp}"]`); await bubble.scrollIntoViewIfNeeded(); await bubble.dispatchEvent("mousedown", { button: 0 });
      await page.waitForSelector("#message-actions-modal.visible"); await bubble.dispatchEvent("mouseup"); await page.locator("#select-message-btn").click();
      await page.locator("#" + button).click(); await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy()); await page.waitForFunction(({ id, stamp }) => window.db.chats.get(id).then((c) => !c.history.some((m) => m.timestamp === stamp)), { id, stamp });
    }
    await chat("finance-watch"); await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    await page.evaluate(() => { if (document.querySelector("#daily-schedule-status")) document.querySelector("#daily-schedule-status").hidden = true; });
    for (const id of ["finance-watch", "finance-group", "f0"]) {
      const before = await page.evaluate(async () => (await window.db.userWallet.get("main")).balance);
      const quote = "我额外买了两杯奶茶。";
      await generate(id, [{ type: "text", name: "林老师", content: quote }, { type: "wallet_expense", name: "林老师", amount: 36, category: "food", quote, content: "两杯奶茶" }]);
      assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), before - 36);
      const c = await page.evaluate((id) => window.db.chats.get(id), id), source = c.history.findLast((m) => m.content === quote), notice = c.history.findLast((m) => m.walletEntryId);
      assert.match(notice.content, /估算支出/); assert.equal(notice.walletSourceTimestamp, source.timestamp);
      const kept = c.history.filter((m) => m.timestamp !== source.timestamp && !m.walletEntryId).at(-1);
      await erase(id, source.timestamp, id === "finance-group" ? "selection-soft-delete-btn" : "selection-erase-btn");
      assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), before);
      assert.equal(await page.evaluate((id) => window.db.chats.get(id).then((c) => c.history.some((m) => m.walletEntryId)), id), false);
      assert.equal(await page.evaluate(() => window.ephoneTimeMachine.nowMs()), kept.vts);
      assert.equal((await page.evaluate(() => window.db.spaceClock.get("main"))).holdNextReply, true);
    }
    // Uncommon goods may use an explicitly marked estimate in the SAME reply;
    // this never invokes another model or bypasses actual-payment evidence.
    const uncommon = "我购买了一个定制工艺品，付款成功。";
    await generate("finance-watch", [{ type: "text", name: "林老师", content: uncommon }, { type: "wallet_expense", name: "林老师", amount: 123, estimated: true, category: "shopping", quote: uncommon, content: "定制工艺品，参考手工材料费用" }]);
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 877);
    const unknownSource = await page.evaluate((quote) => window.db.chats.get("finance-watch").then((c) => c.history.findLast((m) => m.content === quote).timestamp), uncommon);
    await erase("finance-watch", unknownSource); assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 1000);
    // The real summary-segment delete button also rolls back money and all
    // participant copies of the deleted summary, in one transaction.
    await generate("finance-watch", [{ type: "text", name: "林老师", content: "我又买了两杯奶茶，已经付完钱。" }]);
    await page.evaluate(async () => {
      const c = await window.db.chats.get("finance-watch"), source = c.history.findLast((m) => m.content === "我又买了两杯奶茶，已经付完钱。"); source.ephoneSummaryMessageId = "summary-payment";
      const memory = { content: "此段购物总结", timestamp: Date.now(), ephoneSummaryId: "finance-summary", ephoneSourceChatId: c.id, ephoneSummaryMessageIds: [source.ephoneSummaryMessageId], ephoneSummaryStartIndex: c.history.indexOf(source) + 1, ephoneSummaryEndIndex: c.history.indexOf(source) + 1 };
      c.longTermMemory = [memory]; c.lastMemorySummaryIndex = memory.ephoneSummaryEndIndex; await window.db.chats.put(c);
      const person = await window.db.chats.get("f0"); person.longTermMemory = [structuredClone(memory)]; await window.db.chats.put(person);
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await chat("finance-watch");
    await page.locator("#open-memory-screen-btn").click(); await page.locator('.ephone-delete-summary-segment-btn[data-summary-id="finance-summary"]').first().click(); await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click();
    await page.waitForFunction(() => window.db.userWallet.get("main").then((w) => w.balance === 1000)); await page.waitForFunction(() => document.querySelector("#custom-modal-overlay")?.textContent.includes("同步删除")); await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click();
    assert.equal(await page.evaluate(() => window.db.chats.get("f0").then((c) => c.longTermMemory.length)), 0);
    // UI correction updates original debit, and deletion uses the corrected amount.
    await generate("finance-watch", [{ type: "text", name: "林老师", content: "我又买了两杯奶茶。" }]);
    await page.evaluate(() => window.EPhoneCharacterWallet.open()); await page.locator("#cw-person").selectOption("chat:f0"); correction = "30";
    await page.locator('[data-cw-action="correct-estimate"]').first().click(); await page.waitForFunction(() => document.getElementById("cw-notice").textContent.includes("已校正金额"));
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 970);
    const correctedSource = await page.evaluate(() => window.db.chats.get("finance-watch").then((c) => c.history.findLast((m) => m.content === "我又买了两杯奶茶。").timestamp));
    await erase("finance-watch", correctedSource); assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 1000);
    // Funding + manual receipt, then deleting the original card undoes both wallets.
    await generate("finance-watch", [{ type: "transfer", name: "周老师", receiver: "林老师", amount: 20, note: "补贴" }]);
    const card = await page.evaluate(() => window.db.chats.get("finance-watch").then((c) => c.history.findLast((m) => m.type === "transfer")));
    await page.locator(".ephone-money-receive").last().click(); await page.getByRole("button", { name: "替 林老师 接收转账", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#custom-modal-overlay")?.textContent.includes("已存入本空间的钱包")); await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click();
    assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 1020);
    await erase("finance-watch", card.timestamp); assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 1000); assert.equal(await page.evaluate(async () => (await window.db.characterWallets.get("chat:f1")).balance), 1000);
    // Description-only cards are honest; real images open without another API/image request.
    await page.evaluate(() => window.showScreen("api-settings-screen")); await page.locator("#enable-ai-drawing-switch").evaluate((el) => { if (el.checked) el.parentElement.click(); });
    await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click();
    await generate("finance-watch", [{ type: "ai_image", name: "林老师", description: "一杯奶茶的照片。", image_prompt: "a cup of tea" }]);
    assert.match(await page.locator(".ai-image-description-card").last().innerText(), /未生成图片/); assert.equal(images, 0);
    await page.evaluate(() => window.showScreen("api-settings-screen")); await page.locator("#enable-ai-drawing-switch").evaluate((el) => { if (!el.checked) el.parentElement.click(); });
    await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click();
    await generate("finance-watch", [{ type: "ai_image", name: "林老师", description: "柜台上的奶茶。", image_prompt: "tea & light" }]);
    const img = page.locator(".ai-generated-image").last(); await img.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll(".ai-generated-image")].at(-1)?.naturalWidth > 0);
    const callCount = calls.length, imageCount = images; await img.click(); await page.waitForSelector("#ephone-chat-image-preview"); assert.equal(calls.length, callCount); assert.equal(images, imageCount);
    await page.locator("#ephone-chat-image-preview").getByRole("button", { name: "关闭", exact: true }).click(); assert.equal(await page.locator("#ephone-chat-image-preview").count(), 0);
    await generate("finance-watch", [{ type: "ai_image", name: "林老师", description: "服务失败的图片。", image_prompt: "bad-image" }]);
    await page.waitForFunction(() => [...document.querySelectorAll(".ephone-image-status")].at(-1)?.textContent.includes("加载失败"));
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 1000);
    assert.deepEqual(errors, []);
    console.log("PASS: real mobile watch/group/private no-amount accounting with explicit-command dedupe, corrected original debit, hard/soft deletion with balance/notice/clock hold, funded transfer+receipt undo, honest description cards and real-image preview with zero extra generation calls, persisted reload");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
