// Real mobile app with a deterministic delayed-byte fetch bridge. A local HTTP
// server supplies provider bytes; the bridge avoids this host browser's native
// network buffering so we can test app/parser progress independently of it.
// No paid provider is contacted; this is not a provider latency benchmark.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");

(async () => {
  const calls = [], errors = [], dialogs = [], sockets = new Set(), bridged = new Map();
  let serial = 0, ignoreStream = false;
  const content = (n) => "STREAM_BODY_BEGIN_" + n + "\n<约定>保留原文。<img src=x onerror=\"window.__streamInjected=true\">\n" +
    "书店窗前，两位成年人认真整理旧书，各自记得昨天未完成的约定。".repeat(460) + "\nSTREAM_FULL_TAIL_" + n;
  const chapter = (n) => ({ title: "流式章节" + n, content: content(n), summary: "两人在书店整理旧书，约定明天继续。" });
  const tags = (c) => "<novel_title>" + c.title + "</novel_title><novel_content>" + c.content + "</novel_content><novel_summary>" + c.summary + "</novel_summary>";
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/test-dexie.js") {
      res.setHeader("Content-Type", "application/javascript");
      return res.end(fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js")));
    }
    if (/^\/(?:primary|secondary|native)\//.test(url.pathname)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      if (req.method === "OPTIONS") return res.writeHead(204).end();
      if (req.method !== "POST") return res.writeHead(404).end();
      let source = ""; for await (const chunk of req) source += chunk;
      const body = JSON.parse(source), native = url.pathname.startsWith("/native/"), primary = !url.pathname.startsWith("/secondary/") && (!native || url.searchParams.get("key") === "fake-native-primary");
      const call = { body, native, primary, url: req.url, headers: req.headers, n: ++serial, res, ended: false };
      call.expected = chapter(call.n); call.raw = tags(call.expected);
      const opening = "<novel_title>" + call.expected.title + "</novel_title><novel_content>";
      call.prefix = opening + call.expected.content.slice(0, 240);
      call.rest = call.raw.slice(call.prefix.length);
      calls.push(call);
      if (native) {
        assert.equal(url.searchParams.get("key"), primary ? "fake-native-primary" : "fake-native-secondary");
        assert.ok(url.pathname.includes(primary ? "stream-native-model" : "stream-native-aux-model"));
      } else {
        assert.equal(req.headers.authorization, primary ? "Bearer fake-primary" : "Bearer fake-secondary");
        assert.equal(body.model, primary ? "stream-primary-model" : "stream-secondary-model");
      }
      const requestedStream = native ? url.pathname.includes(":streamGenerateContent") : body.stream === true;
      call.requestedStream = requestedStream;
      const streamed = requestedStream && !ignoreStream;
      call.streamed = streamed;
      if (!streamed) {
        const raw = JSON.stringify(call.expected);
        res.setHeader("Content-Type", "application/json"); call.ended = true;
        return res.end(JSON.stringify(native ? { candidates: [{ content: { parts: [{ text: raw }] }, finishReason: "STOP" }] }
          : { choices: [{ message: { content: raw }, finish_reason: "stop" }], usage: { prompt_tokens: 24990, completion_tokens: 10354 } }));
      }
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", Connection: "keep-alive" });
      res.flushHeaders();
      // An SSE heartbeat precedes actual prose; the app must ignore it rather
      // than count connection keepalive bytes as generated novel characters.
      res.write(":" + " ".repeat(2048) + "\n\n");
      const event = (value) => { if (!res.destroyed && !res.writableEnded) res.write("data: " + JSON.stringify(value) + "\r\n\r\n"); };
      call.finishMetadata = () => event({ choices: [{ delta: {}, finish_reason: "stop" }] });
      call.emit = (text) => event(native ? { candidates: [{ content: { parts: [{ text }] } }] } : { choices: [{ delta: { content: text }, finish_reason: null }] });
      call.start = () => {
        event(native ? { candidates: [{ content: { parts: [{ text: "PRIVATE_THOUGHT_MUST_NOT_BE_DISPLAYED", thought: true }] } }] }
          : { choices: [{ delta: { reasoning_content: "PRIVATE_THOUGHT_MUST_NOT_BE_DISPLAYED" }, finish_reason: null }] });
        call.emit(call.prefix);
      };
      call.finish = (reason = "STOP", keepSocketOpen = false) => {
        call.emit(call.rest);
        event(native ? { candidates: [{ content: { parts: [] }, finishReason: reason }], usageMetadata: { promptTokenCount: 24990, candidatesTokenCount: 10354, thoughtsTokenCount: 100 } }
          : { choices: [{ delta: {}, finish_reason: reason === "STOP" ? "stop" : reason.toLowerCase() }], usage: { prompt_tokens: 24990, completion_tokens: 10354, completion_tokens_details: { reasoning_tokens: 100 } } });
        if (!native) res.write("data: [DONE]\n\n");
        call.protocolEnded = true;
        if (!keepSocketOpen) { call.ended = true; res.end(); }
      };
      call.limit = (reason) => {
        event(native ? { candidates: [{ content: { parts: [] }, finishReason: reason }], usageMetadata: { promptTokenCount: 24990, candidatesTokenCount: 10354, thoughtsTokenCount: 100 } }
          : { choices: [{ delta: {}, finish_reason: reason.toLowerCase() }], usage: { prompt_tokens: 24990, completion_tokens: 10354 } });
        if (!native) res.write("data: [DONE]\n\n");
        call.ended = true; res.end();
      };
      call.endPartial = () => { call.ended = true; res.end(); };
      return;
    }
    const file = path.resolve(__dirname, "." + (url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    if (file.endsWith("index.html")) {
      // A CSP isolates external network without interfering with the delayed
      // response-body transport used by this test.
      res.setHeader("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; frame-src 'self' about: data: blob:");
      return res.end(fs.readFileSync(file, "utf8").replace(/https:\/\/unpkg\.com\/dexie[^"']*/g, "/test-dexie.js"));
    }
    res.end(fs.readFileSync(file));
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => { dialogs.push(d.message()); return d.accept(); });
    await page.exposeBinding("__novelTestFetch", ({ page }, input) => new Promise((resolve, reject) => {
      let sent = Promise.resolve(), hasHeaders = false;
      const send = (type, value) => { sent = sent.catch(() => {}).then(() => page.evaluate(({ id, type, value }) => {
        const channel = window.__novelTestChannels?.get(id); if (!channel) return;
        try {
          if (type === "data") channel.enqueue(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
          else { window.__novelTestChannels.delete(id); if (type === "end") channel.close(); else channel.error(new Error(value)); }
        } catch { window.__novelTestChannels.delete(id); }
      }, { id: input.id, type, value }).catch(() => {})); };
      const request = http.request(input.url, { method: input.method, headers: input.headers }, (response) => {
        hasHeaders = true;
        response.on("data", (chunk) => send("data", chunk.toString("base64")));
        response.on("end", () => { bridged.delete(input.id); send("end", ""); });
        response.on("error", (error) => { bridged.delete(input.id); send("error", error.message); });
        resolve({ status: response.statusCode, headers: response.headers });
      });
      request.on("error", (error) => { bridged.delete(input.id); if (hasHeaders) send("error", error.message); else reject(error); });
      bridged.set(input.id, request);
      if (input.body) request.write(input.body); request.end();
    }));
    await page.exposeBinding("__novelTestCancel", (_, id) => { const request = bridged.get(id); bridged.delete(id); request?.destroy(); });
    await page.addInitScript((origin) => {
      const nativeFetch = window.fetch.bind(window); let next = 0;
      window.__novelTestChannels = new Map();
      window.fetch = async (input, options = {}) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
        const google = url.hostname === "generativelanguage.googleapis.com";
        const local = url.origin === origin && /^\/(?:primary|secondary)\//.test(url.pathname);
        if (google || local) {
          const id = Date.now() + ":" + ++next;
          const body = new ReadableStream({ start(controller) { window.__novelTestChannels.set(id, controller); }, cancel() { window.__novelTestChannels.delete(id); return window.__novelTestCancel(id); } });
          const abort = () => { const controller = window.__novelTestChannels.get(id); window.__novelTestChannels.delete(id); try { controller?.error(new DOMException("Aborted", "AbortError")); } catch {} window.__novelTestCancel(id); };
          if (options.signal?.aborted) { abort(); throw new DOMException("Aborted", "AbortError"); }
          options.signal?.addEventListener("abort", abort, { once: true });
          try {
            const response = await window.__novelTestFetch({ id, url: google ? origin + "/native" + url.pathname + url.search : url.href, method: options.method || "GET", headers: Object.fromEntries(new Headers(options.headers || {}).entries()), body: typeof options.body === "string" ? options.body : "" });
            return new Response(body, response);
          } catch (error) { window.__novelTestChannels.delete(id); throw error; }
        }
        return nativeFetch(input, options);
      };
    }, origin);
    // This suite isolates app/decoder behavior with its deterministic fetch
    // bridge. api-stream-http.browser.test.js exercises real browser HTTP/XHR.
    const disableXHRForBridge = () => page.evaluate(() => { window.EPhoneStreamHTTP = { canUse: () => false }; });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await disableXHRForBridge(); await page.locator("#update-notice-dismiss-btn").click();
    const storyId = await page.evaluate(async (origin) => {
      const settings = { aiPersona: "成年人，普通家庭，喜欢整理书籍，讲话温和。", myNickname: "原用户", myPersona: "成年人，独立生活。", maxMemory: 20 };
      const config = await window.db.apiConfig.get("main") || { id: "main" };
      await window.db.apiConfig.put({ ...config, proxyUrl: origin + "/primary/v1", apiKey: "fake-primary", model: "stream-primary-model", secondaryProxyUrl: origin + "/secondary/v1", secondaryApiKey: "fake-secondary", secondaryModel: "stream-secondary-model" });
      await window.db.chats.put({ id: "stream-role", name: "林", originalName: "林", settings, history: [], longTermMemory: [] });
      const authorId = await window.db.grAuthors.add({ name: "流式测试作者", style: "自然、细腻、人物保持独立性。" });
      return window.db.grStories.add({ title: "流式小说", authorId, settings: { charIds: ["stream-role"], bookIds: [], userPersonaId: "", outputLength: 5000, contextLimit: 20, macroWorldView: "现代生活。", generationApi: "primary", streamOutput: true, referenceSpaceDatabase: window.db.spaceProfiles.db.name }, chapters: [], lastUpdated: Date.now() });
    }, origin);
    const story = () => page.evaluate((id) => window.db.grStories.get(id), storyId);
    const ready = async () => { await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await disableXHRForBridge(); };
    const open = async (name = "流式小说") => {
      await page.evaluate(() => window.openGreenRiverScreen()); await page.locator("#gr-book-list .gr-book-card").filter({ hasText: name }).click(); await page.waitForSelector("#gr-reader-screen.active");
      if (name === "流式小说" && (await story()).chapters.length) { await page.evaluate(() => window.openChapterList()); await page.locator("#gr-chapter-list-content .gr-sidebar-item").last().click(); }
      await page.waitForSelector("#gr-writing-controls:visible");
    };
    const until = async (predicate, message) => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 20)); } throw new Error(message); };
    const settled = () => page.waitForFunction(() => !document.getElementById("gr-generate-btn").disabled);
    async function start(rewrite = false) {
      const count = calls.length;
      if (rewrite) { await page.locator("#gr-reroll-btn").click(); await page.locator("#gr-rewrite-modal.visible #gr-rewrite-direct").click(); }
      else { await page.locator("#gr-direction-input").fill("继续写完整5000字正文，不改变人物关系。"); await page.locator("#gr-generate-btn").click(); }
      await until(() => calls.length > count, "novel API request did not arrive");
      assert.equal(calls.length, count + 1, "one click starts one generation request");
      const call = calls.at(-1); assert.match(JSON.stringify(call.body), /正文目标约5000字/);
      assert.equal(call.body.max_tokens, undefined, "the app does not introduce a fixed output cap");
      if (call.native) assert.equal(new URL(call.url, origin).searchParams.get("alt"), "sse"); else assert.equal(call.body.stream, true);
      return call;
    }
    async function preview(call) {
      call.start();
      try { await page.waitForSelector("#gr-live-preview-content", { timeout: 10000 }); }
      catch (error) { console.log(JSON.stringify({ previewFailure: { ended: call.ended, destroyed: call.res.destroyed, status: await page.locator("#gr-generation-status-text").textContent(), dialogs, errors } })); throw error; }
      await until(() => page.locator("#gr-live-preview-content").textContent().then((s) => s.includes("STREAM_BODY_BEGIN_" + call.n)), "first visible stream text was buffered until EOF");
      assert.equal(call.ended, false, "live preview is visible before the provider response ends");
      assert.equal(call.res.writableEnded, false);
      const previewBox = await page.locator("#gr-live-preview-content").boundingBox(), readerBox = await page.locator("#gr-reader-content").boundingBox();
      assert.ok(previewBox && readerBox && Math.min(previewBox.y + previewBox.height, readerBox.y + readerBox.height, 844) - Math.max(previewBox.y, readerBox.y, 0) > 20,
        "the first streamed body is actually in the reader viewport without a test-forced scroll");
      assert.doesNotMatch(await page.locator("#gr-live-preview").textContent(), /PRIVATE_THOUGHT_MUST_NOT_BE_DISPLAYED/);
      assert.equal(await page.locator("#gr-live-preview img").count(), 0, "preview treats model markup as prose");
      assert.equal(await page.evaluate(() => !!window.__streamInjected), false);
    }
    await ready(); await open();
    await page.locator('#gr-reader-screen [title="设定"]').click(); await page.waitForSelector("#gr-settings-modal.visible");
    assert.equal(await page.locator("#gr-stream-output").isChecked(), true); assert.equal(await page.locator("#gr-output-length").inputValue(), "5000");
    await page.locator("#gr-cancel-settings-btn").click();
    const first = await start(); assert.equal(first.primary, true); assert.equal(first.streamed, true);
    await preview(first); assert.equal((await story()).chapters.length, 0, "preview is not prematurely committed as a chapter");
    const callsBeforeQuiet = calls.length;
    await page.evaluate(() => { window.streamTestRealNow = Date.now; Date.now = () => window.streamTestRealNow() + 11000; });
    await page.waitForFunction(() => document.getElementById("gr-generation-status-text").textContent.includes("没有新内容"));
    assert.equal(calls.length, callsBeforeQuiet, "a quiet stream does not retry or switch APIs");
    first.finishMetadata();
    await page.waitForFunction(() => document.getElementById("gr-generation-status-text").textContent.includes("仍有数据到达"));
    assert.equal(await page.locator("#gr-generate-btn").isDisabled(), true, "finish metadata alone cannot terminate reception before later text/usage packets");
    assert.equal(first.res.destroyed, false, "the app must leave the connection open for the rest of the paid result");
    // Synthetic lifecycle notifications verify per-request diagnostics and
    // cleanup; this does not simulate a real phone OS freezing its renderer.
    await page.evaluate(() => { document.dispatchEvent(new Event("freeze")); window.dispatchEvent(new Event("offline")); });
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-novel-stream-mobile.png") });
    first.finish("STOP", true); await settled();
    await page.evaluate(() => { Date.now = window.streamTestRealNow; });
    assert.equal(first.ended, false, "an explicit SSE end marker must finish the UI without waiting for the server to close HTTP");
    first.endPartial();
    let saved = await story(); assert.equal(saved.chapters[0].content, first.expected.content); assert.ok(saved.chapters[0].content.length > 10000);
    assert.equal(saved.lastGeneration.raw, first.raw); assert.equal(saved.lastGeneration.finishReason.toUpperCase(), "STOP");
    assert.ok(JSON.stringify(saved.lastGeneration.usage).includes("10354"), "retain provider output usage for comparison");
    assert.equal(saved.lastGeneration.stats.streamed, true); assert.ok(saved.lastGeneration.stats.visibleChars > 10000);
    assert.ok(Number.isFinite(saved.lastGeneration.stats.firstTextMs)); assert.ok(Number.isFinite(saved.lastGeneration.stats.totalMs));
    assert.ok(saved.lastGeneration.stats.maxTextGapMs >= 10000, "the observed pause is retained for diagnosis");
    assert.equal(saved.lastGeneration.stats.completionSignal, "done_marker"); assert.equal(saved.lastGeneration.stats.readerCancelled, false);
    assert.equal(saved.lastGeneration.lifecycle.freezeCount, 1); assert.equal(saved.lastGeneration.lifecycle.offlineCount, 1);
    await page.locator("#gr-last-response-btn").click();
    await page.waitForSelector("#gr-last-response-modal.visible");
    assert.match(await page.locator("#gr-last-response-info").textContent(), /收到完整结束标记.*取消信号：未触发/);
    await page.locator("#gr-last-response-close").click();
    assert.ok(saved.lastGeneration.stats.firstTextMs <= saved.lastGeneration.stats.totalMs);
    assert.equal(await page.locator("#gr-reader-content .gr-chapter-text").textContent(), first.expected.content);
    assert.equal(await page.locator("#gr-live-preview").count(), 0, "committed chapter replaces its transient preview");
    // Per-work auxiliary selection streams through that actual connection.
    await page.locator('#gr-reader-screen [title="设定"]').click(); await page.waitForSelector("#gr-settings-modal.visible");
    await page.locator("#gr-generation-api").selectOption("secondary"); await page.locator("#gr-save-story-btn").click();
    const secondary = await start(); assert.equal(secondary.primary, false); await preview(secondary); secondary.finish(); await settled();
    assert.equal((await story()).chapters.at(-1).content, secondary.expected.content); assert.equal((await story()).lastGeneration.api, "secondary");
    assert.equal((await story()).lastGeneration.lifecycle.freezeCount, 0, "lifecycle counters do not leak from a previous generation");
    assert.equal((await story()).lastGeneration.lifecycle.offlineCount, 0);
    // Repeat without reloading the tab, while the provider never closes HTTP
    // after DONE. This previously left every response open until tab closure.
    const repeated = [], beforeRepeated = calls.length;
    for (let i = 0; i < 8; i++) {
      const round = await start(i % 2 === 1); repeated.push(round);
      round.start(); round.finish("STOP", true); await settled();
      assert.equal((await story()).chapters.at(-1).content, round.expected.content, "repeated generation/rewrite preserves the complete paid body");
      await until(() => repeated.slice(0, -1).every(call => call.res.destroyed), "completed transports accumulated between generations");
      assert.ok(await page.evaluate(() => window.__novelTestChannels.size <= 1), "only the latest completed transport may remain briefly open");
      assert.equal(await page.locator("#gr-live-preview").count(), 0);
      if (i === 3) await open();
    }
    assert.equal(calls.length, beforeRepeated + 8, "each generation or rewrite still sends exactly one API request");
    await until(() => repeated.at(-1).res.destroyed, "the last completed transport outlived its cleanup grace");
    await until(() => page.evaluate(() => window.__novelTestChannels.size === 0), "completed stream channel was not released");
    // An aborted rewrite retains the old complete chapter and paid partial text.
    const previous = (await story()).chapters, beforeAbortCalls = calls.length, aborted = await start(true); await preview(aborted);
    assert.deepEqual((await story()).chapters, previous);
    await page.locator("#gr-stop-generation-btn").click(); await settled();
    saved = await story(); assert.deepEqual(saved.chapters, previous); assert.ok(saved.lastGeneration.raw.includes("STREAM_BODY_BEGIN_" + aborted.n));
    assert.equal(saved.lastGeneration.status, "error"); assert.equal(calls.length, beforeAbortCalls + 1, "stopping does not retry a paid request");
    // Missing SSE end marker preserves exactly the received prose as partial.
    const incomplete = await start(); await preview(incomplete); incomplete.endPartial(); await settled();
    saved = await story(); assert.equal(saved.chapters.at(-1).content, incomplete.expected.content.slice(0, 240)); assert.equal(saved.lastGeneration.partial, true);
    assert.equal(saved.lastGeneration.raw, incomplete.prefix);
    // Navigation never redirects stream previews or final writes to another work.
    const background = await start(); await preview(background); const originalCount = (await story()).chapters.length;
    const otherId = await page.evaluate(async (id) => { const source = await window.db.grStories.get(id); delete source.id; return window.db.grStories.add({ ...source, title: "另一部流式作品", chapters: [], lastGeneration: null, lastUpdated: Date.now() + 1 }); }, storyId);
    await open("另一部流式作品"); assert.equal(await page.locator("#gr-live-preview").count(), 0);
    background.finish(); await settled();
    assert.equal((await story()).chapters.length, originalCount + 1); assert.equal((await page.evaluate((id) => window.db.grStories.get(id), otherId)).chapters.length, 0);
    assert.equal(await page.locator("#gr-book-name-display").textContent(), "另一部流式作品");
    // Native Gemini uses the SSE endpoint and retains exact full output too.
    await page.evaluate(async () => window.db.apiConfig.update("main", { proxyUrl: "https://generativelanguage.googleapis.com/v1beta/models", apiKey: "fake-native-primary", model: "stream-native-model" }));
    await ready(); await open(); await page.locator('#gr-reader-screen [title="设定"]').click(); await page.waitForSelector("#gr-settings-modal.visible");
    await page.locator("#gr-generation-api").selectOption("primary"); await page.locator("#gr-save-story-btn").click();
    const native = await start(); assert.equal(native.native, true); assert.equal(native.streamed, true); await preview(native); native.finish("STOP", true); await settled();
    assert.equal(native.ended, false, "native finishReason completes without an extra wait for connection closure"); native.endPartial();
    assert.equal((await story()).chapters.at(-1).content, native.expected.content);
    const limited = await start(); await preview(limited); limited.limit("MAX_TOKENS"); await settled();
    saved = await story(); assert.equal(saved.lastGeneration.finishReason, "MAX_TOKENS"); assert.equal(saved.lastGeneration.partial, true);
    assert.equal(saved.chapters.at(-1).content, limited.expected.content.slice(0, 240), "a provider limit preserves every actually received character");
    assert.match(await page.locator("#gr-generation-note").textContent(), /MAX_TOKENS|上限|限制|提前结束/, "explain the provider end reason rather than silently presenting a full chapter");
    // Some compatible providers ignore stream:true and return one JSON body.
    // Accept the same response; do not send a second request to change formats.
    ignoreStream = true; const beforeIgnored = calls.length, countBeforeIgnored = (await story()).chapters.length;
    await page.locator("#gr-generate-btn").click(); await until(() => calls.length > beforeIgnored, "ignored-stream request missing"); await settled();
    saved = await story(); assert.equal(calls.length, beforeIgnored + 1); assert.equal(calls.at(-1).requestedStream, true);
    assert.equal(saved.chapters.length, countBeforeIgnored + 1); assert.equal(saved.chapters.at(-1).content, calls.at(-1).expected.content);
    assert.equal(saved.lastGeneration.stats.streamed, false); ignoreStream = false;
    // Stream can be disabled explicitly without a hidden second request.
    await page.locator('#gr-reader-screen [title="设定"]').click(); await page.waitForSelector("#gr-settings-modal.visible");
    await page.locator("#gr-stream-output").uncheck(); await page.locator("#gr-save-story-btn").click();
    const beforeLegacy = calls.length, countBeforeLegacy = (await story()).chapters.length;
    await page.locator("#gr-generate-btn").click(); await until(() => calls.length > beforeLegacy, "nonstream request missing"); await settled();
    saved = await story(); assert.equal(calls.length, beforeLegacy + 1); assert.equal(calls.at(-1).streamed, false);
    assert.equal(saved.chapters.length, countBeforeLegacy + 1); assert.equal(saved.chapters.at(-1).content, calls.at(-1).expected.content); assert.equal(saved.lastGeneration.stats.streamed, false);
    assert.deepEqual(errors, []);
    console.log("PASS: mobile app simulated fetch byte streams show prose before EOF, preserve 5000-word target and complete long output, record timing/usage/end reason, support primary/auxiliary/native/JSON paths, retain aborted partial returns and isolate source-work previews (provider speed not benchmarked)");
  } finally {
    for (const request of bridged.values()) request.destroy(); bridged.clear();
    await browser.close(); for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
