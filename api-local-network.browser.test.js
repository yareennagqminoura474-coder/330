// Live Service Worker + local CORS server. All data/keys are isolated fakes.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  let origin; const apiLogs = [], responses = [], errors = [], dialogs = [];
  const api = http.createServer((req, res) => {
    apiLogs.push({ path: req.url, method: req.method, origin: req.headers.origin, authorization: req.headers.authorization });
    res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Access-Control-Allow-Headers", "Authorization"); res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    assert.equal(req.method, "GET"); assert.equal(req.url, "/v1/models"); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ data: Array.from({ length: 66 }, (_, i) => ({ id: "local-model-" + i })) }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve)); const apiUrl = `http://127.0.0.1:${api.address().port}`;
  const app = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname), relative = pathname.replace(/^\/330\//, "/"), file = path.resolve(__dirname, "." + (relative === "/" ? "/index.html" : relative));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    // Prevent optional third-party precache downloads in this isolated test.
    // Routing policy and ALL actual app static files are otherwise unchanged.
    res.end(file.endsWith(path.sep + "sw.js") ? fs.readFileSync(file, "utf8").replace(/const OPTIONAL_URLS_TO_CACHE = \[[\s\S]*?\];/, "const OPTIONAL_URLS_TO_CACHE = [];") : fs.readFileSync(file));
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${app.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "allow" });
    await context.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin) || url.startsWith(apiUrl)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      return route.abort();
    });
    const page = await context.newPage(); page.on("pageerror", (err) => errors.push(err.message)); page.on("dialog", (dialog) => { dialogs.push(dialog.message()); return dialog.accept(); });
    page.on("response", (response) => { if (response.url().startsWith(apiUrl)) responses.push({ fromWorker: response.fromServiceWorker(), status: response.status() }); });
    await page.goto(origin + "/330/", { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.waitForFunction(() => navigator.serviceWorker.controller);
    const preserved = { id: "keep-chat", name: "保留聊天", settings: {}, history: [{ role: "user", content: "不得清空", timestamp: 123 }] };
    await page.evaluate(async (chat) => { await window.db.chats.put(chat); await window.db.userWallet.put({ id: "main", balance: 123.45 }); await window.db.apiPresets.add({ name: "保留预设", proxyUrl: "https://saved.invalid", apiKey: "fake-saved", model: "saved-model" }); }, preserved);
    // Put a wrong model response in Cache Storage. An API fetch MUST ignore it.
    await page.evaluate(async (url) => { const cache = await caches.open("ephone-cache-v1.7.80"); await cache.put(url + "/v1/models", new Response('{"data":[{"id":"wrong-cached-model"}]}', { headers: { "Content-Type": "application/json" } })); }, apiUrl);
    await page.evaluate(() => window.showScreen("api-settings-screen"));
    await page.locator("#proxy-url").fill(apiUrl + "/v1"); await page.locator("#api-key").fill("fake-primary-local"); await page.locator("#fetch-models-btn").click();
    await page.waitForFunction(() => [...document.querySelectorAll("#model-select option")].filter((el) => el.value.startsWith("local-model-")).length === 66);
    await page.locator("#secondary-proxy-url").fill(apiUrl + "/v1"); await page.locator("#secondary-api-key").fill("fake-secondary-local"); await page.locator("#fetch-secondary-models-btn").click();
    await page.waitForFunction(() => [...document.querySelectorAll("#secondary-model-select option")].filter((el) => el.value.startsWith("local-model-")).length === 66);
    await page.locator("#image-api-provider").selectOption("custom"); await page.locator("#image-api-baseUrl").fill(apiUrl + "/v1"); await page.locator("#image-api-apiKey").fill("fake-image-local"); await page.locator("#image-api-fetch-models").click();
    await page.waitForFunction(() => document.querySelectorAll("#image-api-models option").length === 67);
    await page.locator("#image-api-models").selectOption({ index: 2 }); await page.evaluate(() => window.ephoneImageApi.flush());
    assert.equal(await page.locator("#image-api-model").inputValue(), await page.locator("#image-api-models").inputValue());
    const actualGets = apiLogs.filter((req) => req.method === "GET"); assert.equal(actualGets.length, 3); assert.ok(actualGets.every((req) => req.origin === origin));
    assert.deepEqual(actualGets.map((req) => req.authorization), ["Bearer fake-primary-local", "Bearer fake-secondary-local", "Bearer fake-image-local"]);
    assert.equal(responses.length, 3); assert.ok(responses.every((res) => res.status === 200 && !res.fromWorker));
    // Prove the worker is active and still handles a real cached static file.
    const staticResponse = page.waitForResponse((response) => response.url() === origin + "/330/style.css?v=1.7.80");
    await page.evaluate(() => fetch("./style.css?v=1.7.80").then((response) => response.text())); assert.equal((await staticResponse).fromServiceWorker(), true);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    assert.deepEqual(await page.evaluate(() => window.db.chats.get("keep-chat")), preserved); assert.equal(await page.evaluate(async () => (await window.db.userWallet.get("main")).balance), 123.45);
    assert.equal(await page.evaluate(async () => (await window.db.apiPresets.toArray()).find((p) => p.name === "保留预设").model), "saved-model");
    assert.equal(apiLogs.filter((req) => req.method === "GET").length, 3, "reload does not automatically pull models or retry requests");
    assert.deepEqual(errors, []); assert.ok(!dialogs.some((text) => /拉取.*失败/.test(text)));
    console.log("PASS: actual mobile app under active Service Worker, live 66-model loopback API via primary/secondary/image selectors, page-origin direct responses despite stale API cache, static offline cache still active, no retries or data/preset/balance loss on reload");
  } finally { await browser.close(); await new Promise((resolve) => app.close(resolve)); await new Promise((resolve) => api.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
