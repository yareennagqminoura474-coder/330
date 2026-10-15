// Real mobile settings + full app, isolated fake APIs and credentials only.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core"), { dailyReply } = require("./browser-test-fixtures.js");
(async () => {
  const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname), file = path.resolve(__dirname, "." + (relative === "/" ? "/index.html" : relative));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, relay = "https://ephone-gcli-proxy.yareennagqminoura474.workers.dev", token = "a".repeat(64), calls = [], errors = [], dialogs = [];
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  let failRelay = false;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message)); page.on("dialog", (dialog) => { dialogs.push(dialog.message()); return dialog.accept(); });
    await page.route("**/*", async (route) => {
      const actual = route.request().url(); if (actual.startsWith(origin)) return route.continue();
      if (actual.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      const headers = route.request().headers(), proxied = actual === relay + "/relay", target = proxied ? headers["x-ephone-target"] : actual;
      if (!/^https:\/\/(?:one|two|three)\.example\//.test(target || "")) return route.abort();
      calls.push({ actual, target, headers, body: route.request().postData(), method: route.request().method() });
      if (proxied) { assert.equal(headers["x-ephone-relay-token"], token); if (failRelay) return route.fulfill({ status: 502, contentType: "application/json", body: '{"error":{"message":"isolated relay failure"}}' }); }
      if (route.request().method() === "GET") return route.fulfill({ contentType: "application/json", body: '{"data":[{"id":"reply-model"},{"id":"image-model"}]}' });
      const payload = route.request().postDataJSON(), prompt = payload.messages?.[0]?.content || "";
      if (prompt.includes("独立生活当天行程规划师")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(dailyReply(prompt)) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify([{ type: "narration", content: "2026年3月5日，10点00分，星期四，地点：客厅" }, { type: "text", name: "林", content: "选择中转后接着前文继续。" }]) }, finish_reason: "stop" }] }) });
    });
    const reopen = async () => { await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.evaluate(() => window.showScreen("api-settings-screen")); };
    const flush = async () => page.evaluate(() => window.ephoneApiTransport.flush());
    const pull = async (button, select) => { const completed = page.waitForResponse((response) => response.request().method() === "GET" && (response.url().endsWith("/models") || response.url() === relay + "/relay")); await page.locator(button).click(); await (await completed).finished(); await page.waitForFunction((id) => [...document.querySelector(id).options].some((o) => o.value === "reply-model"), select); };
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://one.example/v1", apiKey: "fake-primary", model: "reply-model", secondaryProxyUrl: "https://two.example/v1", secondaryApiKey: "fake-aux", secondaryModel: "reply-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="pink"/></svg>'), member = { id: "transport-person", originalName: "林", groupNickname: "林", persona: "成年人，有自己的工作。", avatar };
      await window.db.chats.put({ id: "transport-watch", name: "中转测试", avatar, isGroup: true, isSpectatorGroup: true, members: [member], settings: { maxMemory: 20 }, history: [{ role: "user", content: "不能删除的历史", timestamp: 100 }] });
      await window.db.userWallet.put({ id: "main", balance: 123.45 });
    });
    await reopen(); assert.equal(await page.locator("#primary-transport").inputValue(), "direct");
    await pull("#fetch-models-btn", "#model-select"); assert.equal(calls.at(-1).actual, "https://one.example/v1/models");
    await page.locator("#primary-transport").selectOption("relay"); await flush(); const count = calls.length;
    await page.locator("#fetch-models-btn").click(); assert.equal(calls.length, count); assert.match(dialogs.at(-1), /缺少中转授权码/);
    await page.locator("#api-relay-token").fill(relay + "/" + token); await flush();
    await pull("#fetch-models-btn", "#model-select"); assert.equal(calls.at(-1).actual, relay + "/relay"); assert.equal(calls.at(-1).headers.authorization, "Bearer fake-primary");
    await pull("#fetch-secondary-models-btn", "#secondary-model-select"); assert.equal(calls.at(-1).actual, "https://two.example/v1/models"); assert.equal(calls.at(-1).headers["x-ephone-relay-token"], undefined);
    await page.locator("#proxy-url").fill("https://three.example/v1"); assert.equal(await page.locator("#primary-transport").inputValue(), "direct");
    await page.locator("#proxy-url").fill("https://one.example/v1"); assert.equal(await page.locator("#primary-transport").inputValue(), "relay");
    await page.locator("#image-api-provider").selectOption("custom"); await page.locator("#image-api-baseUrl").fill("https://one.example/v1"); await page.locator("#image-api-apiKey").fill("fake-image");
    assert.equal(await page.locator("#image-api-transport").inputValue(), "relay"); await pull("#image-api-fetch-models", "#image-api-models"); assert.equal(calls.at(-1).actual, relay + "/relay"); assert.equal(calls.at(-1).headers.authorization, "Bearer fake-image");
    await page.locator("#image-api-models").selectOption("image-model"); await page.evaluate(() => window.ephoneImageApi.flush());
    await reopen(); assert.equal(await page.locator("#primary-transport").inputValue(), "relay"); assert.equal(await page.locator("#secondary-transport").inputValue(), "direct");
    assert.equal(await page.locator("#image-api-model").inputValue(), "image-model"); assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 123.45);
    await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click(); await page.locator('.chat-list-item[data-chat-id="transport-watch"]').click();
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    const beforeReply = calls.length; await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    const reply = calls.slice(beforeReply).find((call) => call.target.includes("one.example") && call.method === "POST"); assert.ok(reply); assert.equal(reply.actual, relay + "/relay"); assert.match(reply.body, /不能删除的历史/); assert.doesNotMatch(reply.body, new RegExp(token));
    await page.evaluate(() => window.showScreen("api-settings-screen")); failRelay = true; const beforeFailure = calls.length; const failedDialog = page.waitForEvent("dialog"); await page.locator("#fetch-models-btn").click(); assert.match((await failedDialog).message(), /502/); assert.equal(calls.length, beforeFailure + 1, "relay error never falls back to direct or retries"); failRelay = false;
    await page.locator("#proxy-url").fill("http://127.0.0.1:2156/v1"); assert.equal(await page.locator("#primary-transport").isDisabled(), true); assert.equal(await page.locator("#primary-transport").inputValue(), "direct");
    const beforeRestore = calls.length;
    await page.evaluate(async () => { const t = window.db.globalSettings, main = await t.get("main"), snapshot = await t.get("api-transport"); await t.put({ ...main, id: "main", ephoneApiTransportSettings: snapshot }); await t.delete("api-transport"); });
    await reopen(); assert.equal(await page.locator("#primary-transport").inputValue(), "relay"); assert.equal(await page.locator("#api-relay-token").inputValue(), token);
    assert.equal(await page.evaluate(async () => (await window.db.globalSettings.get("main")).ephoneApiTransportSettings), undefined);
    await page.evaluate(async ({ relay, token }) => { const t = window.db.globalSettings; await t.update("api-transport", { token: "" }); await window.db.apiPresets.add({ name: "旧中转预设", proxyUrl: relay + "/" + token, apiKey: "fake-old-api-key", model: "reply-model" }); }, { relay, token });
    await reopen(); assert.equal(await page.locator("#api-relay-token").inputValue(), token, "old owner relay credential recovered without copying upstream API key"); assert.equal(calls.length, beforeRestore, "restore and recovery never pull models or generate");
    assert.equal(await page.evaluate(async () => (await window.db.chats.get("transport-watch")).history[0].content), "不能删除的历史");
    assert.deepEqual(errors, []);
    console.log("PASS: actual mobile opt-in model pulls, defaults/mixed direct and relay, credential recovery input, persisted address choices and wallet/history, image selector, actual spectator reply, no fallback/retry, Termux remains direct");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
