const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core"), { dailyReply } = require("./browser-test-fixtures.js");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname), file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const errors = [], imageCalls = [], replyCalls = [], pollinations = [], modelCalls = [];
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6E1sAAAAASUVORK5CYII=", dataUrl = "data:image/png;base64," + png;
  let failed = false, hold = false, release, readyHold, emptyModels = false, failModels = false;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message)); page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://image.pollinations.ai/")) { pollinations.push(url); return route.abort(); }
      if (url.startsWith("https://draw-test.invalid/")) {
        if (route.request().method() === "GET") { modelCalls.push(url); return route.fulfill({ status: failModels ? 500 : 200, contentType: "application/json", body: failModels ? '{"error":{"message":"model list unavailable"}}' : emptyModels ? '{"data":[]}' : '{"data":[{"id":"third-gpt-image"},{"id":"gemini-third-image"}]}' }); }
        const body = route.request().postDataJSON(), headers = route.request().headers(); imageCalls.push({ url, body, headers });
        if (hold) { readyHold?.(); await new Promise((resolve) => { release = resolve; }); }
        if (failed) return route.fulfill({ status: 400, contentType: "application/json", body: '{"error":{"message":"model or format unsupported fake-image-key"}}' });
        const result = url.includes(":generateContent") ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] } : url.includes("/chat/completions") ? { choices: [{ message: { images: [{ image_url: { url: dataUrl } }] } }] } : { data: [{ b64_json: png }] };
        try { return await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) }); } catch { /* A stopped request may already be gone. */ }
        return;
      }
      if (url.startsWith("https://reply-test.invalid/")) {
        const body = route.request().postDataJSON(), prompt = body.messages[0].content;
        if (prompt.includes("独立生活当天行程规划师")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(dailyReply(prompt)) });
        replyCalls.push(body);
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify([{ type: "narration", content: "2026年3月5日，10点00分，星期四，地点：客厅" }, { type: "ai_image", name: "林老师", description: "透明盒子里的蓝白机甲模型，产品插画。" }]) }, finish_reason: "stop" }] }) });
      }
      return route.abort();
    });
    const reopen = async () => { await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); };
    const settings = async () => { await page.evaluate(() => window.showScreen("api-settings-screen")); await page.waitForSelector("#api-settings-screen.active"); };
    const settle = async () => { await page.evaluate(() => window.ephoneImageApi.flush()); };
    const chat = async (id) => { await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click(); await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active"); };
    const generate = async (id) => { await chat(id); await page.locator(id === "img-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy()); };
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    const presetId = await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://reply-test.invalid/v1", apiKey: "fake-main-key", model: "reply", secondaryProxyUrl: "https://reply-test.invalid/aux", secondaryApiKey: "fake-aux-key", secondaryModel: "aux" });
      const id = await window.db.apiPresets.add({ name: "已有第三方", proxyUrl: "https://draw-test.invalid/v1", apiKey: "fake-image-key", model: "third-gpt-image" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="pink"/></svg>');
      const members = [{ id: "img-person", originalName: "林老师", groupNickname: "林老师", persona: "成年人，教师，喜欢机甲。", avatar }];
      await window.db.chats.put({ id: "img-person", name: "林老师", originalName: "林老师", avatar, settings: { aiPersona: members[0].persona, aiAvatar: avatar, maxMemory: 10 }, history: [] });
      for (const [id, watch] of [["img-watch", true], ["img-group", false]]) await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: watch, members, settings: { myNickname: "我", maxMemory: 10 }, history: [] });
      return id;
    });
    await reopen(); await settings();
    await page.locator("#enable-ai-drawing-switch").evaluate((input) => { if (!input.checked) input.parentElement.click(); });
    if (await page.locator("#custom-modal-overlay.visible").count()) await page.locator("#custom-modal-overlay.visible #custom-modal-confirm").click();
    await page.locator("#image-api-provider").selectOption("custom"); await settle();
    await page.locator("#image-api-preset-select").selectOption("api:" + presetId); await page.locator("#image-api-use-preset").click();
    await page.waitForFunction(() => document.getElementById("image-api-status").textContent.includes("已使用独立副本"));
    assert.equal(await page.locator("#image-api-model").inputValue(), "third-gpt-image");
    await page.locator("#image-api-fetch-models").click(); await page.waitForFunction(() => document.querySelectorAll("#image-api-models option").length === 3);
    assert.equal(imageCalls.length, 0); assert.equal(await page.locator("#image-api-model").inputValue(), "third-gpt-image");
    assert.equal(await page.locator("#image-api-models").evaluate((node) => node.tagName), "SELECT");
    assert.equal(await page.locator("#image-api-models").isEnabled(), true);
    await page.locator("#image-api-models").selectOption("gemini-third-image"); await settle();
    assert.equal(await page.locator("#image-api-model").inputValue(), "gemini-third-image");
    await reopen(); await settings(); assert.equal(await page.locator("#image-api-model").inputValue(), "gemini-third-image");
    assert.equal(await page.locator("#image-api-models").isDisabled(), true, "reopening does not automatically pull models");
    assert.equal(modelCalls.length, 1);
    await page.locator("#image-api-fetch-models").click(); await page.waitForFunction(() => document.querySelectorAll("#image-api-models option").length === 3);
    assert.equal(await page.locator("#image-api-models").inputValue(), "gemini-third-image");
    await page.locator("#image-api-model").fill("manual-image-model"); await settle(); assert.equal(await page.locator("#image-api-models").inputValue(), "");
    await page.locator("#image-api-models").selectOption("third-gpt-image"); await settle();
    const listBounds = await page.locator("#image-api-models").boundingBox(); assert.ok(listBounds.x >= 0 && listBounds.x + listBounds.width <= 391 && listBounds.height >= 36, "native model selector is touchable and fits mobile screen");
    await page.locator("#image-api-models").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(process.env.TEMP, "ephone-image-api-v180.png") });
    await page.locator("#image-api-preset-name").fill("机甲生图"); await page.locator("#image-api-save-preset").click(); await page.waitForFunction(() => document.getElementById("image-api-status").textContent.includes("已保存独立生图预设"));
    const ownId = await page.locator("#image-api-preset-select").inputValue(); assert.match(ownId, /^image:/);
    await page.evaluate(async (id) => { await window.db.apiPresets.update(id, { model: "changed-text-model", apiKey: "changed-key" }); }, presetId);
    await reopen(); await settings(); assert.equal(await page.locator("#image-api-model").inputValue(), "third-gpt-image"); assert.equal(await page.locator("#image-api-apiKey").inputValue(), "fake-image-key");
    const mainBefore = await page.evaluate(() => window.db.apiConfig.get("main"));
    for (const [id, format] of [["img-watch", "images"], ["img-group", "chat"], ["img-person", "gemini"]]) {
      await settings(); await page.locator("#image-api-protocol").selectOption(format); await settle();
      const before = imageCalls.length; await generate(id); assert.equal(imageCalls.length, before + 1);
      const saved = await page.evaluate((id) => window.db.chats.get(id).then((c) => c.history.findLast((m) => m.type === "ai_image")), id);
      assert.equal(saved.imageUrl, dataUrl); assert.equal(saved.imageGeneration.status, "complete"); assert.equal(saved.imageGeneration.protocol, format);
      const serialized = JSON.stringify(saved); assert.ok(!serialized.includes("fake-image-key")); assert.ok(!serialized.includes("fake-main-key"));
      const call = imageCalls.at(-1); assert.ok(!JSON.stringify(call.body).includes("成年人")); assert.ok(!JSON.stringify(call.body).includes("fake-"));
      assert.equal(format === "gemini" ? call.headers["x-goog-api-key"] : call.headers.authorization, format === "gemini" ? "fake-image-key" : "Bearer fake-image-key");
      const image = page.locator(".ai-generated-image").last(); await image.waitFor(); const count = imageCalls.length;
      await image.click(); await page.waitForSelector("#ephone-chat-image-preview"); await page.locator("#ephone-chat-image-preview button").click(); assert.equal(imageCalls.length, count);
    }
    assert.deepEqual(await page.evaluate(() => window.db.apiConfig.get("main")), mainBefore);
    const beforeReload = imageCalls.length; await reopen(); await chat("img-watch"); assert.equal(imageCalls.length, beforeReload); assert.equal(pollinations.length, 0);
    // Provider errors remain visible and do not silently switch or retry.
    failed = true; await generate("img-watch"); const afterFailure = imageCalls.length;
    assert.equal(await page.locator(".ephone-image-generate").count(), 1); assert.match(await page.locator(".ephone-image-pending").last().innerText(), /400/); assert.doesNotMatch(await page.locator(".ephone-image-pending").last().innerText(), /fake-image-key/);
    await reopen(); await chat("img-watch"); assert.equal(imageCalls.length, afterFailure); assert.equal(pollinations.length, 0);
    failed = false; await page.locator(".ephone-image-generate").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy()); assert.equal(imageCalls.length, afterFailure + 1); assert.equal(await page.locator(".ephone-image-generate").count(), 0);
    // Old description-only history can be generated manually, then reused after reload.
    await page.evaluate(async () => { const c = await window.db.chats.get("img-watch"); c.history.push({ role: "assistant", senderName: "林老师", type: "ai_image", content: "旧消息的机甲图片", timestamp: Date.now() + 10, vts: Date.now() }); await window.db.chats.put(c); });
    await reopen(); await chat("img-watch"); const beforeManual = imageCalls.length; assert.equal(await page.locator(".ephone-image-generate").count(), 1); assert.equal(imageCalls.length, beforeManual);
    hold = true; const held = new Promise((resolve) => { readyHold = resolve; }); await page.locator(".ephone-image-generate").click(); await held;
    const duringManual = replyCalls.length; await page.locator("#spectator-propel-btn").click(); assert.equal(replyCalls.length, duringManual, "manual image generation blocks overlapping new chat replies");
    await page.locator(".ephone-image-generate").click(); release(); hold = false; await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    const afterStop = imageCalls.length; await page.locator(".ephone-image-generate").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy()); assert.equal(imageCalls.length, afterStop + 1);
    // The normal reply stop button also cancels a pending selected image API.
    hold = true; const heldReply = new Promise((resolve) => { readyHold = resolve; }), keptImages = await page.evaluate(() => window.db.chats.get("img-watch").then((c) => c.history.filter((m) => m.type === "ai_image").length));
    await page.locator("#spectator-propel-btn").click(); await heldReply; await page.locator("#spectator-propel-btn").click(); release(); hold = false; await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.equal(await page.evaluate(() => window.db.chats.get("img-watch").then((c) => c.history.filter((m) => m.type === "ai_image").length)), keptImages, "stopped image reply does not append a fake completed picture");
    await settings(); await page.locator("#image-api-protocol").selectOption("images"); await settle(); await page.locator("#image-api-preset-select").selectOption(ownId); await page.locator("#image-api-update-preset").click(); await page.waitForFunction(() => document.getElementById("image-api-status").textContent.includes("已更新当前生图预设"));
    await page.locator("#image-api-delete-preset").click(); await page.waitForFunction(() => document.getElementById("image-api-status").textContent.includes("已删除预设"));
    await reopen(); await settings(); assert.equal(await page.locator("#image-api-model").inputValue(), "third-gpt-image"); assert.equal(await page.locator("#image-api-provider").inputValue(), "custom");
    // Image settings are shared across persona spaces and survive the old
    // singleton-globalSettings backup layout without a stale restore loop.
    await page.evaluate(async () => { const t = window.db.globalSettings, main = await t.get("main"), snapshot = await t.get("image-api"); await t.put({ id: "main", ...main, ephoneImageApiSettings: snapshot }); await t.delete("image-api"); });
    await reopen(); await settings(); assert.equal(await page.locator("#image-api-model").inputValue(), "third-gpt-image"); assert.equal(await page.evaluate(async () => (await window.db.globalSettings.get("main")).ephoneImageApiSettings), undefined);
    await page.locator("#image-api-model").fill("third-gpt-image-updated"); await settle(); await reopen(); await settings(); assert.equal(await page.locator("#image-api-model").inputValue(), "third-gpt-image-updated");
    emptyModels = true; await page.locator("#image-api-fetch-models").click(); await page.waitForFunction(() => document.getElementById("image-api-status").textContent.includes("没有返回模型列表"));
    assert.equal(await page.locator("#image-api-models").isDisabled(), true); assert.equal(await page.locator("#image-api-model").inputValue(), "third-gpt-image-updated");
    emptyModels = false; failModels = true; await page.locator("#image-api-fetch-models").click(); await page.waitForFunction(() => document.getElementById("image-api-status").textContent.includes("未完成"));
    assert.equal(await page.locator("#image-api-fetch-models").isEnabled(), true); assert.equal(await page.locator("#image-api-models").isDisabled(), true);
    failModels = false; await page.locator("#image-api-fetch-models").click(); await page.waitForFunction(() => document.querySelectorAll("#image-api-models option").length === 3);
    await page.locator("#image-api-baseUrl").fill("https://other-draw-test.invalid/v1"); await settle(); assert.equal(await page.locator("#image-api-models").isDisabled(), true, "changing service removes stale choices");
    await page.locator("#image-api-baseUrl").fill("https://draw-test.invalid/v1"); await settle();
    assert.deepEqual(errors, []); assert.equal(pollinations.length, 0); assert.equal(modelCalls.length, 5); assert.equal(replyCalls.length, 5);
    const bounds = await page.locator("#image-api-model").boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, "mobile model field stays inside screen");
    console.log("PASS: mobile independent image presets and backup restoration without stale overwrites, images/chat/native generation in watch/group/private, saved images and zero reopen/preview billing, no main/aux changes or prompt leakage, redacted errors without fallback/retry, legacy manual generation and stop");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
