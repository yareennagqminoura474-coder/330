// Real mobile edits/deletions and director UI, isolated data and fake providers.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname), file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const errors = [], dialogs = [], calls = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://editor-test.invalid/")) {
        calls.push(route.request().postDataJSON());
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify([
          { type: "narration", content: "2026年3月5日，10点00分，星期四，地点：书房" },
          { type: "text", name: "林", content: "原句将被修改。" },
          { type: "narration", content: "可修改的场景。" },
          { type: "text", name: "林", content: "稍后删掉的台词。" },
          { type: "text", name: "林", content: "末尾台词保持。" },
        ]) }, finish_reason: "stop" }] }) });
      }
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://editor-test.invalid/v1", apiKey: "fake-editor-key", model: "fake-editor-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "editor-role", originalName: "林", groupNickname: "林", persona: "普通家庭的成年人。", avatar };
      for (const [id, watch] of [["editor-a", true], ["editor-b", true], ["editor-normal", false]]) {
        const history = id === "editor-a" ? [{ role: "user", content: "继续。", timestamp: 1 }] : [
          { role: "assistant", type: "narration", senderName: "旁白", content: "另一个群的场景。", timestamp: 200, vts: 1772676000000 },
          { role: "assistant", type: "text", senderName: "林", content: "另一个群的台词。", timestamp: 201, vts: 1772676000000 },
        ];
        await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: watch, members: [member], history,
          settings: { myNickname: "我", maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] },
          ...(id === "editor-a" ? {} : { ephoneLastReplyBatch: { kind: watch ? "spectator" : "standard", timestamps: [200, 201] } }) });
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function chat(id) { await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click(); await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active"); }
    const stored = (id = "editor-a") => page.evaluate((id) => window.db.chats.get(id), id);
    async function director(watch = true) { await page.locator(watch ? "#spectator-edit-btn" : "#edit-last-response-btn").click(); await page.waitForSelector("#ai-response-editor-modal.visible"); return page.locator("#ai-response-editor-container textarea").evaluateAll((inputs) => inputs.map((input) => JSON.parse(input.value))); }
    async function closeDirector() { await page.locator("#cancel-ai-response-editor-btn").click(); }
    async function menu(stamp) {
      const bubble = page.locator(`.message-bubble[data-timestamp="${stamp}"]`); await bubble.scrollIntoViewIfNeeded(); await bubble.dispatchEvent("mousedown", { button: 0 });
      await page.waitForSelector("#message-actions-modal.visible"); await bubble.dispatchEvent("mouseup");
    }
    async function edit(stamp, values) {
      await menu(stamp); await page.locator("#edit-message-btn").click(); await page.waitForSelector("#message-editor-modal.visible");
      await page.locator("#message-editor-container textarea").first().fill(values[0]);
      for (const value of values.slice(1)) { await page.locator("#add-message-editor-block-btn").click(); await page.locator("#message-editor-container textarea").last().fill(value); }
      await page.locator("#save-advanced-editor-btn").click(); await page.waitForSelector("#message-editor-modal.visible", { state: "hidden" });
      await page.waitForFunction(() => document.querySelector("#custom-modal-overlay.visible")?.textContent.includes("消息已更新"));
      await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click();
    }
    async function erase(stamp) {
      await menu(stamp); await page.locator("#select-message-btn").click(); await page.locator("#selection-erase-btn").click();
      await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      await page.waitForFunction((stamp) => !document.querySelector(`.message-bubble[data-timestamp="${stamp}"]`), stamp);
    }
    await chat("editor-a"); await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    await page.locator("#daily-schedule-status [data-action='close']").click();
    await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    const initial = await stored(), original = initial.history.find((m) => m.content === "原句将被修改。"), last = initial.history.at(-1);
    assert.equal(initial.ephoneReplyEditor.timestamps.length, 5, "generation persists one opening header and actual prose");
    await edit(original.timestamp, ["已经在气泡里修改的新台词。", "拆分出的第二句。</textarea> & 文字也要保留。"]);
    const edited = await stored();
    assert.equal(edited.history.find((m) => m.content === "末尾台词保持。").timestamp, last.timestamp, "editing must not renumber later messages");
    assert.equal(edited.history.find((m) => m.content === "已经在气泡里修改的新台词。").vts, original.vts);
    assert.equal(new Set(edited.history.map((m) => m.timestamp)).size, edited.history.length);
    let items = await director(); assert.equal(items.length, 6); assert.ok(items.some((m) => m.content === "拆分出的第二句。</textarea> & 文字也要保留。"));
    assert.ok(!items.some((m) => m.content === "原句将被修改。"));
    await page.locator("#save-ai-response-editor-btn").click(); await page.waitForSelector("#ai-response-editor-modal.visible", { state: "hidden" });
    assert.deepEqual((await stored()).history, edited.history, "applying unchanged director content is a no-op");
    const removed = edited.history.find((m) => m.content === "稍后删掉的台词。"); await erase(removed.timestamp);
    items = await director(); assert.ok(!items.some((m) => m.content === "稍后删掉的台词。")); await closeDirector();
    const untouchedCards = await page.evaluate(async () => {
      const chat = await window.db.chats.get("editor-a"), timestamp = Date.now() + 100;
      const cards = [
        { role: "assistant", type: "ai_image", senderName: "林", timestamp, vts: 1772676000000, content: "已生成图片的描述", imagePrompt: "old image prompt", imageUrl: chat.avatar },
        { role: "assistant", type: "transfer", senderName: "林", receiverName: "我", timestamp: timestamp + 1, vts: 1772676000000, amount: 15, note: "已领取的旧转账", status: "accepted", walletFunded: true },
      ];
      chat.history.push(...cards); chat.ephoneReplyEditor.timestamps.push(...cards.map((m) => m.timestamp));
      const other = await window.db.chats.get("editor-b"); other.history.push({ role: "assistant", senderName: "林", timestamp: 202, content: "另一个聊天中的私信不能随本群编辑被撤销。" });
      chat.ephoneReplyEditor.privateMessages = [{ chatId: other.id, timestamp: 202 }];
      await window.db.chats.bulkPut([chat, other]); await window.refreshPersonaSpaceData(); return cards;
    });
    await chat("editor-a");
    // The latest reply remains identifiable even after user/role messages follow.
    await page.locator('[data-spectator-action="identity"]').click(); await page.getByRole("button", { name: "以 林 的身份说话", exact: true }).click();
    await page.locator(".ephone-spectator-compose textarea").fill("这是我后来以角色身份补充的内容。"); await page.locator('[data-spectator-action="send"]').click();
    await page.waitForFunction(() => document.querySelector("#chat-messages")?.textContent.includes("这是我后来以角色身份补充的内容。"));
    const beforeDirectorEdit = await stored();
    items = await director(); assert.ok(!items.some((m) => m.content === "这是我后来以角色身份补充的内容。"));
    const firstText = page.locator("#ai-response-editor-container textarea").nth(items.findIndex((m) => m.content === "已经在气泡里修改的新台词。"));
    await firstText.fill(JSON.stringify({ type: "text", name: "林", content: "从叶子里反向编辑的台词。" }));
    await page.locator("#save-ai-response-editor-btn").click();
    await page.waitForSelector("#ai-response-editor-modal.visible", { state: "hidden" }); await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click();
    const applied = await stored(); assert.equal(applied.history.at(-1).content, "这是我后来以角色身份补充的内容。");
    for (const card of untouchedCards) assert.deepEqual(applied.history.find((m) => m.timestamp === card.timestamp), card, "editing another row preserves existing images and received/funded cards without regeneration");
    assert.ok((await stored("editor-b")).history.some((m) => m.timestamp === 202), "editing this batch must not delete a private message from another chat");
    assert.equal(applied.history.at(-1).timestamp, beforeDirectorEdit.history.at(-1).timestamp);
    assert.ok(applied.history.some((m) => m.content === "从叶子里反向编辑的台词。")); assert.ok(!applied.history.some((m) => m.timestamp === removed.timestamp));
    await chat("editor-b"); items = await director(); assert.deepEqual(items.map((m) => m.content), ["另一个群的场景。", "另一个群的台词。"]); await closeDirector();
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await chat("editor-a");
    items = await director(); assert.ok(items.some((m) => m.content === "从叶子里反向编辑的台词。")); assert.ok(!items.some((m) => m.content === "稍后删掉的台词。")); await closeDirector();
    for (const stamp of (await stored()).ephoneReplyEditor.timestamps) await erase(stamp);
    const countDialogs = dialogs.length; await page.locator("#spectator-edit-btn").click(); assert.equal(dialogs.length, countDialogs + 1, "deleting the whole batch cannot revive old cached replies");
    assert.equal(await page.locator("#ai-response-editor-modal.visible").count(), 0);
    await chat("editor-normal"); await edit(201, ["普通群聊修改也同步。"]); items = await director(false); assert.ok(items.some((m) => m.content === "普通群聊修改也同步。")); await closeDirector();
    assert.equal(calls.length, 1, "editing, deletion, opening/applying the director, switching and reloading cannot call an API");
    assert.deepEqual(errors, []);
    console.log("PASS: actual bubble edits/splits/deletes synchronize director content, stable IDs/time, legacy/chat/reload isolation, no resurrection or extra API calls, and reverse edits preserve later impersonated messages");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
