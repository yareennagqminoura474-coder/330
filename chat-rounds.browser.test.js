// Isolated mobile browser: real buttons, long-press menus, database and fake API.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname, file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    let body = fs.readFileSync(file);
    if (file.endsWith(path.sep + "script.js")) body = body.toString().replace("  async function _0x7baf0e(", "  window.__roundTestSwitch = _0x7baf0e;\n  async function _0x7baf0e(");
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, calls = [], errors = [];
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await page.addInitScript(() => { const timeout = window.setTimeout; window.setTimeout = (fn, ms, ...args) => timeout(fn, ms >= 700 && ms <= 3000 ? 10 : ms, ...args); });
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://round-test.invalid/")) {
        calls.push(route.request().postDataJSON());
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify([
          { type: "text", name: "林", content: "这是实际生成的新一轮第一句台词。" },
          { type: "text", name: "林", content: "新一轮第二句。" },
        ]) }, finish_reason: "stop" }] }) });
      }
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://round-test.invalid/v1", apiKey: "fake-only", model: "test-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const members = Array.from({ length: 22 }, (_, i) => ({ id: "round-person-" + i, originalName: i ? "角色" + i : "林", groupNickname: i ? "群昵称" + i : "林", avatar, persona: "普通成年人。" }));
      for (const id of ["round-watch", "round-normal", "round-private", "round-empty"]) {
        const history = [];
        if (id !== "round-empty") for (const start of [1000, 3000, 5000]) {
          history.push({ role: "user", type: "text", content: "继续", timestamp: start - 1 });
          history.push({ role: "assistant", type: "narration", senderName: "旁白", content: "2026年3月5日，10点00分，星期四，地点：书房", isReplyHeader: true, timestamp: start, vts: 1772676000000 });
          history.push(...Array.from({ length: 205 }, (_, i) => ({ role: "assistant", type: i === 1 ? "narration" : "text", senderName: "林", content: i === 1 ? "（低头）" : `第${start}轮第${i + 1}句原文。` + (i === 0 ? '<visit> & "引号"也保留。' : ""), timestamp: start + i + 1, vts: 1772676000000,
            ...(id === "round-watch" ? { ephoneReplyRoundId: "seed:" + start } : {}) })));
          if (id === "round-watch") history.at(-206).ephoneReplyRoundId = "seed:" + start;
        }
        await window.db.chats.put({ id, name: id, originalName: "林", avatar, isGroup: id !== "round-private", isSpectatorGroup: id === "round-watch", members, history,
          settings: { aiPersona: "成年人。", aiAvatar: avatar, maxMemory: 20, myNickname: "我", linkedMemoryChatIds: [], linkedWorldBookIds: [] },
          ...(history.length ? { ephoneLastReplyBatch: { kind: id === "round-watch" ? "spectator" : "standard", timestamps: history.slice(-206).map(m => m.timestamp) } } : {}) });
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function open(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active");
      if (id !== "round-empty") await page.waitForFunction(() => !document.getElementById("reply-round-nav").hidden);
    }
    const stored = id => page.evaluate(id => window.db.chats.get(id), id);
    async function jump(previous, stamp) {
      await page.locator(previous ? "#reply-round-previous-btn" : "#reply-round-current-btn").click();
      await page.waitForFunction(stamp => document.getElementById("reply-round-nav").dataset.targetTimestamp === String(stamp) && !document.getElementById("reply-round-current-btn").disabled, stamp);
      const target = page.locator(`.message-bubble[data-timestamp="${stamp}"]`);
      assert.ok(await target.isVisible());
      const bottom = await page.locator("#reply-round-nav").evaluate(el => el.getBoundingClientRect().bottom);
      assert.ok((await target.boundingBox()).y >= bottom - 2, "the first sentence is below the navigation/header, not covered by buttons");
    }
    async function continuous(id) {
      const actual = await page.locator("#chat-messages > .message-wrapper").evaluateAll(rows => rows.map(row => Number(row.querySelector("[data-timestamp]")?.dataset.timestamp ?? row.dataset.timestamp)));
      const history = (await stored(id)).history;
      assert.deepEqual(actual, history.slice(history.findIndex(m => m.timestamp === actual[0])).filter(m => !m.isHidden).map(m => m.timestamp), "bulk jump loading must keep every intervening message");
    }
    async function menu(stamp) {
      const bubble = page.locator(`.message-bubble[data-timestamp="${stamp}"]`); await bubble.scrollIntoViewIfNeeded();
      await bubble.dispatchEvent("mousedown", { button: 0 }); await page.waitForSelector("#message-actions-modal.visible"); await bubble.dispatchEvent("mouseup");
    }
    async function awaitType(id, stamp, type, speaker) {
      await page.waitForFunction(async ({ id, stamp, type, speaker }) => {
        const m = (await window.db.chats.get(id)).history.find(m => m.timestamp === stamp);
        return m.type === type && m.senderName === speaker;
      }, { id, stamp, type, speaker });
      await page.waitForTimeout(50);
    }
    for (const id of ["round-watch", "round-normal", "round-private"]) {
      await open(id); const before = await stored(id);
      await jump(false, 5000); await continuous(id);
      if (id === "round-watch") {
        const screenshot = path.join(require("node:os").tmpdir(), "ephone-round-controls-v115.png");
        await page.screenshot({ path: screenshot }); console.log("SCREENSHOT " + screenshot);
      }
      await jump(true, 3000); await continuous(id);
      await jump(false, 5000);
      await menu(5001); await page.locator("#convert-message-narration-btn").click();
      await awaitType(id, 5001, "narration", "旁白");
      assert.ok((await page.locator('.message-bubble[data-timestamp="5001"]').getAttribute("class")).includes("narration-bubble"));
      assert.ok((await page.locator('.message-bubble[data-timestamp="5001"]').textContent()).includes(before.history.find(m => m.timestamp === 5001).content), "conversion cannot hide literal angle brackets or lose quoted prose");
      await menu(5001); await page.locator("#convert-message-character-btn").click();
      const speaker = id === "round-private" ? "林" : "角色21";
      while (await page.getByRole("button", { name: /加载更多/ }).isVisible()) await page.getByRole("button", { name: /加载更多/ }).click();
      await page.getByRole("button", { name: speaker, exact: true }).click();
      await awaitType(id, 5001, "text", speaker);
      await menu(5002); await page.locator("#convert-message-character-btn").click();
      await page.getByRole("button", { name: "林", exact: true }).click();
      await awaitType(id, 5002, "text", "林");
      assert.ok(!(await page.locator('.message-bubble[data-timestamp="5002"]').getAttribute("class")).includes("narration-bubble"), "explicitly converted parenthesized speech must not be reclassified by legacy action styling");
      const after = await stored(id);
      assert.deepEqual(after.history.map(m => [m.timestamp, m.vts, m.content]), before.history.map(m => [m.timestamp, m.vts, m.content]), "conversion preserves every message, exact prose, IDs and virtual times");
      await page.locator(id === "round-watch" ? "#spectator-edit-btn" : "#edit-last-response-btn").click();
      await page.waitForSelector("#ai-response-editor-modal.visible");
      const editor = await page.locator("#ai-response-editor-container textarea").evaluateAll(inputs => inputs.map(input => JSON.parse(input.value)));
      assert.ok(editor.some(item => item.type === "text" && item.name === speaker && item.content === before.history.find(m => m.timestamp === 5001).content));
      await page.locator("#cancel-ai-response-editor-btn").click();
      await continuous(id);
      if (id === "round-watch") {
        const unchanged = await stored(id);
        await page.evaluate(() => {
          window.__conversionFail = () => { throw new Error("isolated conversion save failure"); };
          window.db.chats.hook("updating", window.__conversionFail);
        });
        await menu(5001); await page.locator("#convert-message-narration-btn").click();
        await page.waitForFunction(() => document.querySelector("#custom-modal-overlay.visible")?.textContent.includes("isolated conversion save failure"));
        assert.deepEqual((await stored(id)).history, unchanged.history, "a failed save must leave the original type/speaker/text/time intact");
        await page.evaluate(() => window.db.chats.hook("updating").unsubscribe(window.__conversionFail));
        await page.locator("#custom-modal-confirm").click();
      }
      assert.equal(calls.length, ["round-watch", "round-normal", "round-private"].indexOf(id), "jumping and converting cannot invoke any API");
      // Actual generation tags its round at playback, not just after reload.
      await page.locator(id === "round-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      const generated = (await stored(id)).history.slice(after.history.length);
      assert.ok(generated.length >= 3);
      assert.ok(generated.every(m => m.ephoneReplyRoundId));
      assert.equal(new Set(generated.map(m => m.ephoneReplyRoundId)).size, 1);
      await jump(true, 5000); await continuous(id);
      await page.locator("#reply-round-latest-btn").click();
      assert.ok(await page.locator("#chat-messages").evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 3));
    }
    assert.equal(calls.length, 3);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await open("round-watch"); await jump(true, 5000);
    assert.equal((await stored("round-watch")).history.find(m => m.timestamp === 5001).senderName, "角色21");
    // Switching chats while a role picker is open cannot edit the wrong chat.
    await menu(5001); await page.locator("#convert-message-narration-btn").click(); await awaitType("round-watch", 5001, "narration", "旁白");
    await menu(5001); await page.locator("#convert-message-character-btn").click();
    const otherBefore = await stored("round-normal");
    await page.evaluate(() => window.__roundTestSwitch("round-normal"));
    await page.waitForFunction(() => window.ephoneActiveChatForSendAs === "round-normal");
    await page.getByRole("button", { name: "林", exact: true }).click();
    assert.equal((await stored("round-watch")).history.find(m => m.timestamp === 5001).type, "narration");
    assert.deepEqual((await stored("round-normal")).history, otherBefore.history);
    await open("round-empty"); assert.equal(await page.locator("#reply-round-nav").isVisible(), false);
    assert.deepEqual(errors, []);
    console.log("PASS: watch/normal/private mobile round jumps auto-load 200+ replies without gaps, preserve reading position, convert prose both ways with role selection and exact IDs/time, synchronize director and persist, keep parenthesized speech explicit, tag actual reply rounds and make no extra API calls");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
