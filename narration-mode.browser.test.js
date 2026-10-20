// Mobile production reply paths, isolated fake model only.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname, file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const lines = ["三文鱼×1、排骨×1、龙井茶叶一盒（180元）、吐司一袋、黄油一盒", "龙井茶叶一盒*180*、吐司一袋", "龙井茶叶一盒**180**、吐司一袋", "三文鱼*1、排骨*1、虾仁*1", "（180）"];
  const reply = [...lines.map((content) => ({ type: "text", name: "林", content })), { type: "text", name: "林", content: "茶叶（180元），*拿起手机*清单发给你了。" }];
  let calls = 0; const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await page.addInitScript(() => { const original = window.setTimeout; window.setTimeout = (fn, ms, ...args) => original(fn, ms >= 700 && ms <= 3000 ? 25 : ms, ...args); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (!url.startsWith("https://numeric-test.invalid/")) return route.abort();
      calls++; assert.equal(route.request().postDataJSON().model, "numeric-test-model");
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: "stop" }] }) });
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://numeric-test.invalid/v1", apiKey: "fake-only", model: "numeric-test-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const member = { id: "numeric-private", originalName: "林", groupNickname: "林", persona: "普通家庭成年人。", avatar };
      for (const id of ["numeric-watch", "numeric-group", "numeric-private"]) await window.db.chats.put({ id, name: id, originalName: "林", avatar,
        isGroup: id !== "numeric-private", isSpectatorGroup: id === "numeric-watch", members: [member], history: [{ role: "user", type: "text", content: "清单给我看看", timestamp: 1 }],
        settings: { aiPersona: member.persona, aiAvatar: avatar, maxMemory: 20, myNickname: "我", linkedMemoryChatIds: [], linkedWorldBookIds: [] } });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    for (const id of ["numeric-watch", "numeric-group", "numeric-private"]) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click(); await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click();
      await page.waitForSelector("#chat-interface-screen.active");
      await page.locator(id === "numeric-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click();
      await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      const chat = await page.evaluate((id) => window.db.chats.get(id), id);
      for (const content of lines) {
        const stored = chat.history.find((item) => item.content === content && item.role === "assistant");
        assert.ok(stored, `${id}: full numeric dialogue stored: ${content}`); assert.equal(stored.type || "text", "text");
        const bubble = page.locator(`.message-bubble[data-timestamp="${stored.timestamp}"]`);
        assert.ok(!(await bubble.getAttribute("class")).includes("narration-bubble"), "including old-style numeric parentheses: DOM observer must not reclassify");
      }
      assert.equal(chat.history.filter((item) => item.type === "narration" && !item.isReplyHeader).length, 1);
      assert.equal(chat.history.find((item) => item.type === "narration" && !item.isReplyHeader).content, "拿起手机");
      assert.equal(await page.locator("#chat-messages .narration-bubble").filter({ hasText: /^180$/ }).count(), 0);
    }
    assert.equal(calls, 3, "one reply API per mode, no repair generation"); assert.deepEqual(errors, []);
    console.log("PASS: mobile spectator/ordinary group/private replies keep full numeric shopping lists, real actions and exactly one opening; numeric bubbles not reclassified by DOM observer");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
