// Real app/UI + IndexedDB, isolated fake API only. Never reads user credentials.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const root = __dirname, errors = [], requests = [], dialogs = [];
  const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, "." + (relative === "/" ? "/index.html" : relative));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => { dialogs.push(dialog.message()); return dialog.accept(); });
    let failed = false;
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://api-test.invalid/")) {
        requests.push(url);
        if (failed) return route.abort();
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [{ id: "model-one" }, { id: "model-two" }] }) });
      }
      return route.abort();
    });
    const reopen = async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.ephoneAppReady);
      await page.evaluate(() => window.showScreen("api-settings-screen"));
      await page.waitForSelector("#api-settings-screen.active");
    };
    const saved = async (model, url, key) => {
      await page.waitForFunction(async ({ model, url, key }) => {
        const config = await window.db.apiConfig.get("main");
        return config?.secondaryModel === model && config.secondaryProxyUrl === url && config.secondaryApiKey === key;
      }, { model, url, key });
    };
    const checkForm = async (model, url, key) => {
      assert.equal(await page.locator("#secondary-model-select").inputValue(), model);
      assert.equal(await page.locator("#secondary-proxy-url").inputValue(), url);
      assert.equal(await page.locator("#secondary-api-key").inputValue(), key);
    };
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main") || { id: "main" };
      await window.db.apiConfig.put({ ...config, model: "saved-primary", proxyUrl: "https://api-test.invalid/main", apiKey: "fake-primary",
        secondaryProxyUrl: "https://api-test.invalid/secondary", secondaryApiKey: "fake-secondary", secondaryModel: "saved-unlisted",
        testUnrelatedSetting: "keep-me" });
    });
    await reopen();
    await checkForm("saved-unlisted", "https://api-test.invalid/secondary", "fake-secondary");
    assert.equal(await page.locator("#model-select").inputValue(), "saved-primary");
    assert.equal(requests.length, 0); // Restoring saved models must not need network.
    await page.locator("#save-api-settings-btn").click();
    await saved("saved-unlisted", "https://api-test.invalid/secondary", "fake-secondary");
    await reopen();
    await checkForm("saved-unlisted", "https://api-test.invalid/secondary", "fake-secondary");
    await page.locator("#secondary-proxy-url").fill("https://api-test.invalid/edited");
    await page.locator("#secondary-api-key").fill("fake-edited");
    await saved("saved-unlisted", "https://api-test.invalid/edited", "fake-edited");
    await page.evaluate(() => window.showScreen("home-screen"));
    await reopen(); // No Done button: edits must still survive reload.
    await checkForm("saved-unlisted", "https://api-test.invalid/edited", "fake-edited");
    await page.locator("#fetch-secondary-models-btn").click();
    try { await page.waitForFunction(() => document.querySelector('#secondary-model-select option[value="model-two"]')); }
    catch (error) { console.error({ requests, dialogs, errors }); throw error; }
    assert.equal(await page.locator("#secondary-model-select").inputValue(), "saved-unlisted");
    await page.locator("#secondary-model-select").selectOption("model-two");
    await saved("model-two", "https://api-test.invalid/edited", "fake-edited");
    await reopen();
    await checkForm("model-two", "https://api-test.invalid/edited", "fake-edited");
    failed = true;
    await page.locator("#fetch-secondary-models-btn").click();
    await page.waitForTimeout(250);
    await page.locator("#save-api-settings-btn").click();
    await saved("model-two", "https://api-test.invalid/edited", "fake-edited");
    failed = false;
    await page.locator("#save-api-preset-btn").click();
    await page.locator("#custom-prompt-input").fill("副API测试预设");
    await page.locator("#custom-modal-confirm").click();
    await page.waitForFunction(async () => (await window.db.apiPresets.toArray()).some((preset) => preset.name === "副API测试预设"));
    const ids = await page.evaluate(async () => {
      const a = await window.db.apiPresets.add({ name: "测试A", proxyUrl: "https://api-test.invalid/main-a", apiKey: "fake-a", model: "primary-a",
        secondaryProxyUrl: "https://api-test.invalid/a", secondaryApiKey: "fake-secondary-a", secondaryModel: "secondary-a" });
      const b = await window.db.apiPresets.add({ name: "测试B", proxyUrl: "https://api-test.invalid/main-b", apiKey: "fake-b", model: "primary-b",
        secondaryProxyUrl: "https://api-test.invalid/b", secondaryApiKey: "fake-secondary-b", secondaryModel: "secondary-b" });
      const empty = await window.db.apiPresets.add({ name: "测试留空", proxyUrl: "https://api-test.invalid/empty", apiKey: "fake-empty", model: "primary-empty" });
      return { a, b, empty };
    });
    await reopen();
    for (const name of ["a", "b", "a"]) {
      await page.locator("#api-preset-select").selectOption(String(ids[name]));
      await saved(`secondary-${name}`, `https://api-test.invalid/${name}`, `fake-secondary-${name}`);
      await page.waitForFunction((model) => document.getElementById("secondary-model-select").value === model, `secondary-${name}`);
      await page.waitForTimeout(150);
      await checkForm(`secondary-${name}`, `https://api-test.invalid/${name}`, `fake-secondary-${name}`);
      assert.equal(await page.locator("#model-select").inputValue(), `primary-${name}`);
    }
    await reopen();
    await checkForm("secondary-a", "https://api-test.invalid/a", "fake-secondary-a");
    assert.equal(await page.evaluate(async () => (await window.db.apiConfig.get("main")).testUnrelatedSetting), "keep-me");
    await page.locator("#api-preset-select").selectOption(String(ids.empty));
    await saved("", "", "");
    await reopen();
    await checkForm("", "", "");
    await page.locator("#secondary-proxy-url").fill("https://api-test.invalid/new");
    await page.locator("#secondary-api-key").fill("fake-new");
    await page.locator("#fetch-secondary-models-btn").click();
    await saved("model-one", "https://api-test.invalid/new", "fake-new");
    await reopen();
    await checkForm("model-one", "https://api-test.invalid/new", "fake-new");
    assert.deepEqual(errors, []);
    console.log("PASS: saved primary/secondary models restored offline, Done preserves model, secondary autosave/reload, failed fetch preservation, preset save/switch/reload, blank preset reset, new fetched model autosave, unrelated settings retained, zero page errors");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
