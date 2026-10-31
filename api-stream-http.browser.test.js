// Native browser XHR over a real local HTTP socket, including server resets.
// No fetch bridge, response mocking, credentials, or paid provider is used.
const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const sockets = new Set(), calls = [], prefix = "<novel_content>" + "实际发送到浏览器的中文、引号\"、换行\n与emoji🙂。".repeat(900), tail = "最后已经送达但包未结束的正文";
  const packet = text => "data: " + JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) + "\n\n";
  const server = http.createServer(async (req, res) => {
    if (req.url === "/") { res.setHeader("Content-Type", "text/html"); return res.end('<!doctype html><script src="/api-stream-http.js"></script><script src="/novel-stream.js"></script>'); }
    if (["/api-stream-http.js", "/novel-stream.js"].includes(req.url)) { res.setHeader("Content-Type", "application/javascript"); return res.end(fs.readFileSync("." + req.url)); }
    if (req.url === "/favicon.ico") return res.writeHead(204).end();
    let body = ""; for await (const part of req) body += part;
    const call = { url: req.url, body, prematureClose: false }; calls.push(call);
    res.on("close", () => { call.prematureClose = !res.writableEnded; });
    if (req.url === "/http-error") return res.writeHead(429, { "Content-Type": "application/json" }).end('{"error":{"message":"test rate limit"}}');
    res.writeHead(200, { "Content-Type": req.url === "/json-broken" ? "application/json" : "text/event-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "X-Request-Id": "isolated-http-test" });
    res.flushHeaders();
    if (req.url === "/abort") return;
    if (req.url === "/json-broken") res.write('{"choices":[{"index":0,"message":{"content":' + JSON.stringify(prefix + tail).slice(0, -1));
    else res.write(packet(prefix) + (req.url === "/early-marker" ? "data: [DONE]\n\n" : ""));
    setTimeout(() => {
      if (res.destroyed) return;
      if (req.url === "/sse-broken") {
        res.write('data: {"choices":[{"index":0,"delta":{"content":' + JSON.stringify(tail).slice(0, -1));
        setTimeout(() => res.destroy(), 50);
      } else if (req.url === "/json-broken") res.destroy();
      else if (req.url === "/upstream-error") res.end('data: {"error":{"message":"An internal error has occurred.","type":"upstream_error","code":500}}data: [DONE]');
      else res.end(packet(tail) + "data: [DONE]\n\n");
    }, req.url === "/early-marker" ? 6500 : 100);
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "load" });
    const receive = url => page.evaluate(async url => {
      const response = await EPhoneStreamHTTP.request(url, { method: "POST", body: "one-request", headers: { "Content-Type": "application/json" } });
      const output = await EPhoneNovelStream.read(response, { waitForEOF: true });
      return { raw: output.raw, partial: output.partial, error: output.error || "", providerError: output.providerError, recovered: output.stats.recoveredChars, signal: output.stats.completionSignal, transport: response.ephoneTransport, reception: response.ephoneReceiveDiagnostics };
    }, url);
    for (const url of ["/complete", "/early-marker", "/sse-broken", "/json-broken"]) {
      const before = calls.length, output = await receive(url);
      assert.equal(calls.length, before + 1, "no retries after a transport error");
      assert.equal(output.raw, prefix + tail, "every arrived prose character survives the native network-error path: " + url);
      assert.equal(output.transport, "browser xhr");
      assert.equal(output.partial, url.endsWith("-broken"));
      assert.equal(output.reception.cancelledBy, "", "the app must never cancel a live response on a protocol marker");
      assert.equal(output.reception.end, url.endsWith("-broken") ? "network_error" : "http_eof");
      if (url === "/early-marker") assert.equal(calls.at(-1).prematureClose, false, "no client_gone after an early marker and a pause longer than the old five-second cleanup deadline");
      if (url.endsWith("-broken")) { assert.match(output.error, /network error/); assert.ok(output.recovered > 0); }
    }
    for (let i = 0; i < 8; i++) {
      const result = await receive("/repeat-" + i); assert.equal(result.raw, prefix + tail); assert.equal(result.partial, false);
    }
    const beforeUpstream = calls.length, upstream = await receive("/upstream-error");
    assert.equal(upstream.raw, prefix); assert.equal(upstream.partial, true); assert.equal(upstream.providerError.code, 500);
    assert.equal(upstream.signal, "provider_error"); assert.equal(calls.length, beforeUpstream + 1);
    const failedHTTP = await page.evaluate(async () => { const response = await EPhoneStreamHTTP.request("/http-error", { method: "POST" }); return { status: response.status, raw: await response.text() }; });
    assert.equal(failedHTTP.status, 429); assert.match(failedHTTP.raw, /test rate limit/);
    const aborted = await page.evaluate(async () => {
      const controller = new AbortController(), result = EPhoneStreamHTTP.request("/abort", { method: "POST", signal: controller.signal });
      setTimeout(() => controller.abort(), 100);
      try { await result; return "unexpected success"; } catch (error) { return error.name; }
    });
    assert.equal(aborted, "AbortError");
    assert.equal(await page.evaluate(() => EPhoneStreamHTTP.canUse("http://127.0.0.1:2156/v1/chat/completions", { method: "POST" })), false);
    assert.equal(await page.evaluate(() => EPhoneStreamHTTP.canUse("https://api.example/v1/chat/completions", { method: "POST", redirect: "error" })), false);
    assert.equal(await page.evaluate(() => EPhoneStreamHTTP.canUse("https://api.example/v1/chat/completions", { method: "POST", body: "{}" })), true);
    assert.ok(calls.every(call => call.body === "one-request" || ["/http-error", "/abort"].includes(call.url)));
    await page.evaluate(() => EPhoneNovelStream.releaseCompleted());
    console.log("PASS: native browser HTTP complete/SSE reset/JSON reset, exact arrived prose retention, eight repeated requests, HTTP errors, abort, no retries and local/redirect-policy exclusions");
  } finally { await browser.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
