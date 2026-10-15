const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
(async () => {
  const source = fs.readFileSync("script.js", "utf8"), from = source.indexOf("function _ephoneIsLoopbackApi("), to = source.indexOf("\nfunction findBestStickerMatch", from);
  const calls = [], native = []; let error;
  const context = vm.createContext({ URL, window: {}, navigator: { onLine: true },
    fetch: async (url, options) => { calls.push({ url, options }); if (error) throw error; return { ok: true }; },
  });
  vm.runInContext(source.slice(from, to), context);
  for (const url of ["http://127.0.0.1:2156/v1/models", "http://127.2.3.4:2156/v1/models", "http://localhost:2156/v1/models", "http://sub.localhost:2156/v1/models", "http://[::1]:2156/v1/models"]) {
    assert.equal(context._ephoneIsLoopbackApi(url), true);
    const options = { headers: { Authorization: "Bearer fake-test" } }; await context._ephoneApiFetch(url, options);
    assert.equal(calls.at(-1).options.targetAddressSpace, "loopback"); assert.equal(calls.at(-1).options.headers, options.headers); assert.equal(options.targetAddressSpace, undefined);
  }
  for (const url of ["https://third-party.invalid/v1/models", "https://localhost.evil.invalid/v1/models", "https://127.0.0.1.evil.invalid/v1/models", "http://192.168.1.10:2156/v1/models", "not-a-url"]) assert.equal(context._ephoneIsLoopbackApi(url), false);
  const options = { method: "POST", body: '{"messages":[{"content":"unchanged"}]}', signal: new AbortController().signal };
  await context._ephoneApiFetch("https://third-party.invalid/v1/chat/completions", options); assert.equal(calls.at(-1).options, options);
  context.navigator.onLine = false; const before = calls.length; await context._ephoneApiFetch("http://127.0.0.1:2156/v1/models"); assert.equal(calls.length, before + 1, "online indicator never gates or blocks VPN requests");
  error = new TypeError("Failed to fetch"); const failures = calls.length;
  await assert.rejects(context._ephoneApiFetch("http://127.0.0.1:2156/v1/models"), (err) => /本机 API/.test(err.message) && /当前 GitHub/.test(err.message) && /跨域/.test(err.message)); assert.equal(calls.length, failures + 1, "no speculative local API retry");
  await assert.rejects(context._ephoneApiFetch("https://third-party.invalid/v1/models"), /API GET network error/);
  error = Object.assign(new Error("stopped"), { name: "AbortError" }); await assert.rejects(context._ephoneApiFetch("http://127.0.0.1:2156/v1/models"), (err) => err === error);
  error = null; context.window.Capacitor = { isNativePlatform: () => true }; context.window.CapacitorHttp = { request: async (request) => { native.push(request); return { status: 200, data: { data: [{ id: "fake-native" }] }, headers: {} }; } };
  const nativeResponse = await context._ephoneApiFetch("http://127.0.0.1:2156/v1/models", { headers: { Authorization: "Bearer fake-native" } });
  assert.equal((await nativeResponse.json()).data[0].id, "fake-native"); assert.equal(native[0].targetAddressSpace, undefined);
  console.log("PASS: page loopback annotation only, untouched public/native payloads and authentication, no VPN/online gating, explicit local permission/CORS errors, cancellation and no API retry");
})().catch((error) => { console.error(error); process.exitCode = 1; });
