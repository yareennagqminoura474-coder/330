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
      await page.waitForFunction((model) => document.getElementById("model-select").value === model, `primary-${name}`);
      await page.waitForTimeout(150);
      await checkForm("model-two", "https://api-test.invalid/edited", "fake-edited");
      assert.equal(await page.locator("#model-select").inputValue(), `primary-${name}`);
    }
    await reopen();
    await checkForm("model-two", "https://api-test.invalid/edited", "fake-edited");
    assert.equal(await page.evaluate(async () => (await window.db.apiConfig.get("main")).testUnrelatedSetting), "keep-me");
    await page.locator("#api-preset-select").selectOption(String(ids.empty));
    await page.waitForFunction(() => document.getElementById("model-select").value === "primary-empty");
    await reopen();
    await checkForm("model-two", "https://api-test.invalid/edited", "fake-edited");
    await page.locator("#secondary-api-preset-select").selectOption(String(ids.a));
    await page.locator("#load-secondary-api-preset-btn").click();
    await saved("primary-a", "https://api-test.invalid/main-a", "fake-a");
    assert.match(await page.locator("#secondary-api-source-status").innerText(), /测试A.*独立副本/);
    assert.equal(await page.locator("#model-select").inputValue(), "primary-empty", "copying secondary never switches primary");
    await page.evaluate(async (id) => window.db.apiPresets.update(id, { name: "测试A已修改", proxyUrl: "https://api-test.invalid/changed-a", apiKey: "fake-changed-a", model: "changed-primary-a" }), ids.a);
    await reopen(); await checkForm("primary-a", "https://api-test.invalid/main-a", "fake-a");
    await page.locator("#api-preset-select").selectOption(String(ids.a)); await page.waitForFunction(() => document.getElementById("model-select").value === "changed-primary-a");
    await checkForm("primary-a", "https://api-test.invalid/main-a", "fake-a");
    await page.locator("#secondary-api-preset-select").selectOption(String(ids.a)); await page.locator("#load-secondary-api-preset-btn").click();
    await saved("changed-primary-a", "https://api-test.invalid/changed-a", "fake-changed-a");
    const badId = await page.evaluate(() => window.db.apiPresets.add({ name: "不完整预设", proxyUrl: "https://api-test.invalid/incomplete" }));
    await reopen(); await page.locator("#secondary-api-preset-select").selectOption(String(badId)); await page.locator("#load-secondary-api-preset-btn").click(); await page.waitForTimeout(150);
    assert.ok(dialogs.some((s) => s.includes("原副 API 没有改动"))); await checkForm("changed-primary-a", "https://api-test.invalid/changed-a", "fake-changed-a");
    await page.evaluate((id) => window.db.apiPresets.delete(id), ids.a); await reopen();
    await checkForm("changed-primary-a", "https://api-test.invalid/changed-a", "fake-changed-a"); assert.match(await page.locator("#secondary-api-source-status").innerText(), /测试A已修改/);
    await page.locator("#secondary-model-select").selectOption("");
    await page.locator("#secondary-proxy-url").fill("https://api-test.invalid/new");
    await page.locator("#secondary-api-key").fill("fake-new");
    await page.locator("#fetch-secondary-models-btn").click();
    await saved("model-one", "https://api-test.invalid/new", "fake-new");
    await reopen();
    await checkForm("model-one", "https://api-test.invalid/new", "fake-new");
    // Explicit one-click update: selected ID, current form, no new record or
    // hidden changes to the independent secondary connection.
    const updateIds = await page.evaluate(async () => {
      const a = await window.db.apiPresets.add({ name: "同名更新测试", proxyUrl: "https://api-test.invalid/update-old", apiKey: "fake-old", model: "old-update-model", customPresetMetadata: "preserve-me" });
      const b = await window.db.apiPresets.add({ name: "同名更新测试", proxyUrl: "https://api-test.invalid/not-target", apiKey: "fake-not-target", model: "not-target" });
      return { a, b };
    });
    await reopen(); await page.locator("#api-preset-select").selectOption("current");
    const countBefore = await page.evaluate(() => window.db.apiPresets.count()); await page.locator("#update-api-preset-btn").click();
    assert.match(await page.locator("#api-preset-update-status").innerText(), /请先选择/); assert.equal(await page.evaluate(() => window.db.apiPresets.count()), countBefore);
    await page.locator("#api-preset-select").selectOption(String(updateIds.a)); await page.waitForFunction(() => document.getElementById("model-select").value === "old-update-model" && !document.getElementById("update-api-preset-btn").disabled);
    await page.locator("#secondary-api-preset-select").selectOption(String(updateIds.a)); await page.locator("#load-secondary-api-preset-btn").click(); await saved("old-update-model", "https://api-test.invalid/update-old", "fake-old");
    const secondaryBefore = await page.evaluate(async () => { const c = await window.db.apiConfig.get("main"); return Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith("secondary"))); });
    const otherBefore = await page.evaluate((id) => window.db.apiPresets.get(id), updateIds.b), callsBeforeUpdate = requests.length;
    await page.locator("#proxy-url").fill("https://api-test.invalid/update-new/"); await page.locator("#api-key").fill("fake-updated-key");
    await page.evaluate(() => document.getElementById("model-select").add(new Option("updated-model", "updated-model"))); await page.locator("#model-select").selectOption("updated-model");
    await page.locator("#minimax-group-id").fill("updated-group"); await page.locator("#minimax-api-key").fill("fake-updated-voice");
    await page.evaluate(() => { document.getElementById("update-api-preset-btn").click(); document.getElementById("update-api-preset-btn").click(); });
    await page.waitForFunction(() => document.getElementById("api-preset-update-status").textContent.startsWith("已更新") && !document.getElementById("update-api-preset-btn").disabled);
    const updated = await page.evaluate((id) => window.db.apiPresets.get(id), updateIds.a);
    assert.equal(updated.id, updateIds.a); assert.equal(updated.name, "同名更新测试"); assert.equal(updated.model, "updated-model"); assert.equal(updated.apiKey, "fake-updated-key"); assert.equal(updated.proxyUrl, "https://api-test.invalid/update-new");
    assert.equal(updated.minimaxGroupId, "updated-group"); assert.equal(updated.minimaxApiKey, "fake-updated-voice"); assert.equal(updated.customPresetMetadata, "preserve-me");
    assert.deepEqual(await page.evaluate((id) => window.db.apiPresets.get(id), updateIds.b), otherBefore); assert.equal(await page.evaluate(() => window.db.apiPresets.count()), countBefore); assert.equal(requests.length, callsBeforeUpdate);
    assert.deepEqual(await page.evaluate(async () => { const c = await window.db.apiConfig.get("main"); return Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith("secondary"))); }), secondaryBefore);
    await page.locator("#api-preset-select").selectOption(String(ids.b)); await page.waitForFunction(() => document.getElementById("model-select").value === "primary-b");
    await page.locator("#api-preset-select").selectOption(String(updateIds.a)); await page.waitForFunction(() => document.getElementById("model-select").value === "updated-model");
    assert.equal(await page.locator("#proxy-url").inputValue(), "https://api-test.invalid/update-new"); assert.equal(await page.locator("#api-key").inputValue(), "fake-updated-key");
    await reopen(); assert.equal(await page.locator("#api-preset-select").inputValue(), String(updateIds.a)); assert.equal(await page.locator("#model-select").inputValue(), "updated-model");
    assert.equal(await page.locator("#minimax-group-id").inputValue(), "updated-group"); assert.equal(await page.locator("#minimax-api-key").inputValue(), "fake-updated-voice");
    // A failure in active configuration storage rolls the preset back too.
    const configBeforeFailure = await page.evaluate(() => window.db.apiConfig.get("main"));
    await page.locator("#api-key").fill("fake-not-saved");
    await page.evaluate(() => { const table = window.db.apiConfig, original = table.put; table.put = async function (...args) { table.put = original; throw new Error("isolated storage failure"); }; });
    await page.locator("#update-api-preset-btn").click(); await page.waitForFunction(() => document.getElementById("api-preset-update-status").textContent.startsWith("更新失败"));
    assert.deepEqual(await page.evaluate((id) => window.db.apiPresets.get(id), updateIds.a), updated); assert.deepEqual(await page.evaluate(() => window.db.apiConfig.get("main")), configBeforeFailure);
    assert.equal(await page.locator("#update-api-preset-btn").isEnabled(), true);
    // A removed preset must not be silently recreated at its old ID.
    await page.evaluate((id) => window.db.apiPresets.delete(id), updateIds.a); await page.locator("#update-api-preset-btn").click();
    await page.waitForFunction(() => document.getElementById("api-preset-update-status").textContent.includes("该预设已不存在")); assert.equal(await page.evaluate((id) => window.db.apiPresets.get(id), updateIds.a), undefined);
    await checkForm("old-update-model", "https://api-test.invalid/update-old", "fake-old");
    const box = await page.locator("#update-api-preset-btn").boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 420, "update button stays inside mobile viewport");
    assert.deepEqual(errors, []);
    await page.locator("#secondary-api-preset-select").scrollIntoViewIfNeeded();
    const screenshot = path.join(require("node:os").tmpdir(), "ephone-api-routing-v175.png"); await page.screenshot({ path: screenshot }); console.log("SCREENSHOT " + screenshot);
    assert.equal((await page.evaluate(async () => (await window.db.apiConfig.get("main")).secondaryPresetSnapshot)).id, updateIds.a);
    console.log("PASS: model restore, secondary autosave and preset snapshot isolation; one-click current-preset update by ID with duplicate names, current URL/key/model/voice, metadata preservation, switch/reload, no extra calls/records, double-click protection, transaction rollback, deleted/no-selection safeguards and mobile layout");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
