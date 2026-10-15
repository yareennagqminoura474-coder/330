const assert = require("node:assert/strict"), { timingSafeEqual } = require("node:crypto");
(async () => {
  const { default: worker } = await import("./relay-worker.mjs");
  crypto.subtle.timingSafeEqual = (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const origin = "https://yareennagqminoura474-coder.github.io", token = "a".repeat(64), calls = [];
  const actualFetch = global.fetch;
  global.fetch = async (url, options) => { calls.push({ url, options }); return new Response('{"data":[{"id":"example-image"}]}', { headers: { "Content-Type": "application/json", "Set-Cookie": "private=discard", Location: "https://elsewhere.example" } }); };
  const request = (target, extra = {}, method = "GET", path = "/relay") => new Request("https://relay.example" + path, { method, headers: { Origin: origin, "X-EPhone-Relay-Token": token, "X-EPhone-Target": target, Authorization: "Bearer fake-upstream", ...extra }, ...(method === "POST" ? { body: '{"unchanged":true}' } : {}) });
  const env = { PROXY_TOKEN: token };
  try {
    assert.equal((await worker.fetch(request("https://api.example/v1/models", { Origin: "https://evil.example" }), env)).status, 403);
    assert.equal((await worker.fetch(request("https://api.example/v1/models", { "X-EPhone-Relay-Token": "wrong" }), env)).status, 401); assert.equal(calls.length, 0);
    assert.equal((await worker.fetch(request("https://api.example/v1/models", { "X-EPhone-Relay-Token": "" }), env)).status, 401, "unset device token never authenticates empty credentials");
    const device = "b".repeat(64), deviceEnv = { ...env, DEVICE_TOKEN: device };
    const checked = await worker.fetch(request("", { "X-EPhone-Relay-Token": device }, "GET", "/device/check"), deviceEnv);
    assert.equal(checked.status, 200); assert.deepEqual(await checked.json(), { ok: true }); assert.equal(calls.length, 0, "device validation makes no upstream/paid request");
    assert.equal((await worker.fetch(request("", { "X-EPhone-Relay-Token": "wrong" }, "GET", "/device/check"), deviceEnv)).status, 401);
    assert.equal((await worker.fetch(request("", {}, "POST", "/device/check"), deviceEnv)).status, 405);
    assert.equal((await worker.fetch(request("https://api.example/v1/models", { "X-EPhone-Relay-Token": device }), deviceEnv)).status, 200); calls.length = 0;
    const preflight = await worker.fetch(new Request("https://relay.example/relay", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,x-ephone-target,x-ephone-relay-token,x-goog-api-key" } }), env);
    assert.equal(preflight.status, 204); assert.equal(calls.length, 0);
    for (const target of ["http://api.example/v1/models", "https://127.0.0.1/v1/models", "https://2130706433/v1/models", "https://[::1]/v1/models", "https://secret.local/v1/models", "https://a.workers.dev/v1/models", "https://api.example/admin", "https://user:pass@api.example/v1/models", "https://api.example/v1/models?key=fake"]) assert.equal((await worker.fetch(request(target), env)).status, 400, target);
    assert.equal(calls.length, 0);
    for (const [target, method] of [["https://one.example/v1/models", "GET"], ["https://two.example/custom/v1/chat/completions", "POST"], ["https://three.example/v1/images/generations", "POST"], ["https://generativelanguage.googleapis.com/v1beta/models/gemini-image:generateContent", "POST"]]) {
      const result = await worker.fetch(request(target, { "x-goog-api-key": "fake-native", Cookie: "must-not-forward" }, method), env);
      assert.equal(result.status, 200); assert.equal(result.headers.get("Access-Control-Allow-Origin"), origin); assert.equal(result.headers.get("Set-Cookie"), null); assert.equal(result.headers.get("Location"), null); assert.equal(result.headers.get("Cache-Control"), "no-store");
      assert.match(await result.text(), /example-image/); const call = calls.at(-1); assert.equal(call.url, target); assert.equal(call.options.redirect, "manual");
      assert.equal(call.options.headers.get("X-EPhone-Relay-Token"), null); assert.equal(call.options.headers.get("Cookie"), null); assert.equal(call.options.headers.get("Origin"), null); assert.equal(call.options.headers.get("Authorization"), "Bearer fake-upstream");
      if (method === "POST") assert.equal(await new Response(call.options.body).text(), '{"unchanged":true}');
    }
    await worker.fetch(request("https://unused.example/v1/models", {}, "GET", "/" + token + "/v1/models"), env); assert.equal(calls.at(-1).url, "https://gcli.ggchan.dev/v1/models");
    const before = calls.length; global.fetch = async () => { calls.push("redirect"); return new Response(null, { status: 307, headers: { Location: "https://elsewhere.example" } }); };
    assert.equal((await worker.fetch(request("https://one.example/v1/models"), env)).status, 502); assert.equal(calls.length, before + 1);
    global.fetch = async () => { throw Error("private details"); }; const failed = await worker.fetch(request("https://one.example/v1/models"), env); assert.equal(failed.status, 502); assert.doesNotMatch(await failed.text(), /private details/);
    assert.equal((await worker.fetch(request("https://one.example/v1/models", {}, "DELETE"), env)).status, 400);
    console.log("PASS: authenticated owner-only relay, preflight without paid calls, HTTPS/API-only targets, no private IP/credentials/cookies/redirect leakage, streamed bodies and replies, legacy compatibility, no automatic retry");
  } finally { global.fetch = actualFetch; }
})().catch((error) => { console.error(error); process.exitCode = 1; });
