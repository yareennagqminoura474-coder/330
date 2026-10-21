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
  const errors = [], requests = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.stack));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (/chat\/completions|generateContent/.test(url)) requests.push(url);
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      await window.db.chats.put({ id: "actual-role", name: "甲", originalName: "甲", avatar, settings: { aiPersona: "已修改的基础人设", aiAvatar: avatar }, history: [], ephoneCopyOrigin: { database: "source", table: "chats", id: "old-role" } });
      for (const [id, watch] of [["legacy-watch", true], ["legacy-group", false], ["legacy-third", true]]) await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: watch,
        members: [{ id: "missing-source-" + id, originalName: "甲", groupNickname: "群昵称", persona: "群内专用设定", avatar }], settings: { maxMemory: 20 }, history: [{ role: "assistant", senderName: "甲", type: "text", content: "旧消息保留", timestamp: 1 }] });
      for (let i = 0; i < 3; i++) await window.db.chats.put({ id: "group-only-" + i, name: "仅群内" + i, avatar, isGroup: true, isSpectatorGroup: true,
        members: [{ id: "independent-group-id-" + i, originalName: "乙", groupNickname: "乙昵称" + i, persona: "各群不同的人设" + i, avatar }], settings: { maxMemory: 20 }, history: [] });
      await window.db.spaceProfiles.put({ id: "player", key: "member:missing-source-legacy-watch", name: "甲" });
      await window.db.userWallet.put({ id: "main", balance: 900 }); await window.db.characterWallets.put({ key: "chat:actual-role", balance: 300000, configured: true });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="me-view"]').click();
    await page.waitForFunction(() => document.querySelector("#player-identity-select")?.value === "chat:actual-role");
    const options = await page.locator("#player-identity-select option").evaluateAll((options) => options.map((o) => ({ value: o.value, label: o.textContent })));
    assert.equal(options.filter((o) => o.value).length, 2); assert.equal(options.filter((o) => o.label.startsWith("甲")).length, 1); assert.equal(options.filter((o) => o.label.startsWith("乙")).length, 1);
    assert.doesNotMatch(JSON.stringify(options), /legacy-watch|legacy-group|绑定已失效/);
    await page.locator("#player-identity-save").click();
    await page.waitForFunction(() => document.querySelector("#player-identity-status").textContent.includes("已保存"));
    for (const id of ["legacy-watch", "legacy-group", "legacy-third"]) {
      const state = await page.evaluate(async (id) => {
        const chat = await window.db.chats.get(id), all = await window.db.chats.toArray(), npcs = await window.db.npcs.toArray();
        const profile = window.ephoneGroupContext.memberProfile(chat.members[0], Object.fromEntries(all.map((c) => [c.id, c])), npcs);
        return { key: window.ephonePlayerIdentity.participants(chat, all, npcs)[0].key, sourceId: profile.source.id, persona: profile.persona, nickname: profile.nickname, history: chat.history };
      }, id);
      assert.equal(state.key, "chat:actual-role"); assert.equal(state.sourceId, "actual-role"); assert.equal(state.persona, "群内专用设定"); assert.equal(state.nickname, "群昵称"); assert.equal(state.history[0].content, "旧消息保留");
    }
    const identities = await page.evaluate(async () => {
      const all = await window.db.chats.toArray(); return all.filter((c) => c.id.startsWith("group-only-")).map((c) => window.ephonePlayerIdentity.participants(c, all)[0].key);
    });
    assert.equal(new Set(identities).size, 1);
    await page.locator("#player-identity-select").selectOption(identities[0]); await page.locator("#player-identity-save").click();
    await page.waitForFunction(() => !window.ephonePlayerIdentity.isBusy());
    await page.evaluate(() => window.ephonePlayerIdentity.render());
    assert.equal(await page.locator("#player-identity-select").inputValue(), identities[0]);
    assert.deepEqual(await page.evaluate(async () => ({ main: (await window.db.userWallet.get("main")).balance, role: (await window.db.characterWallets.get("chat:actual-role")).balance })), { main: 900, role: 300000 });
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    console.log("PASS: mobile reload automatically repairs legacy copied group references/binding; one selectable role across private/watch/normal groups, shared source and preserved group persona/history/balances; no API calls/errors");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
