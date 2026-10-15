const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
(async () => {
  const listeners = {}, calls = { cache: 0, fetch: 0, deleted: [], claimed: 0 }, origin = "https://ephone-test.invalid", scope = origin + "/330/";
  let failCache = false, failNetwork = false, cached = null;
  const caches = {
    match: async () => { calls.cache++; if (failCache) throw new Error("cache unavailable"); return cached?.clone() || null; },
    keys: async () => ["other-app-cache", "ephone-cache-v1.7.78", "ephone-cache-v1.7.81"],
    delete: async (key) => { calls.deleted.push(key); return true; },
  };
  const context = vm.createContext({ URL, Response, Set, console: { log() {} }, setInterval() {}, caches,
    fetch: async () => { calls.fetch++; if (failNetwork) throw new TypeError("Failed to fetch"); return new Response("network"); },
    self: { registration: { scope }, location: { origin }, addEventListener: (name, callback) => { listeners[name] = callback; }, clients: { claim: async () => { calls.claimed++; } } },
  });
  const source = fs.readFileSync("sw.js", "utf8"); vm.runInContext(source, context);
  const dispatch = (url, { method = "GET", mode = "cors", headers = {} } = {}) => {
    let response = null; listeners.fetch({ request: { url, method, mode, headers: new Headers(headers) }, respondWith: (value) => { response = Promise.resolve(value); } }); return response;
  };
  // A stale model-list cache must never be read, with OR without credentials.
  cached = new Response('{"data":[{"id":"stale"}]}');
  for (const url of ["http://127.0.0.1:2156/v1/models", "http://localhost:2156/v1/models", "http://[::1]:2156/v1/models", "http://192.168.1.10:2156/v1/models", "https://third-party.invalid/v1/models", scope + "v1/models", scope + "api.json", scope + "api.js", "https://third-party.invalid/_keep_alive_ping_"]) {
    for (const headers of [{}, { Authorization: "Bearer fake-test" }]) assert.equal(dispatch(url, { headers }), null, url + " stays window-initiated");
  }
  for (const name of ["Authorization", "Proxy-Authorization", "x-api-key", "x-goog-api-key"]) assert.equal(dispatch(scope + "style.css?v=1.7.81", { headers: { [name]: "fake" } }), null);
  assert.equal(dispatch("http://127.0.0.1:2156/v1/chat/completions", { method: "POST" }), null);
  assert.equal(dispatch(scope + "style.css?v=1.7.81", { method: "POST" }), null);
  assert.equal(calls.cache, 0); assert.equal(calls.fetch, 0, "worker does not issue API requests, probes or retries");
  cached = new Response("cached static"); assert.equal(await (await dispatch(scope + "style.css?v=1.7.81")).text(), "cached static");
  assert.equal(await (await dispatch("https://unpkg.com/dexie/dist/dexie.js")).text(), "cached static");
  failCache = true; assert.equal(await (await dispatch(scope + "style.css?v=1.7.81")).text(), "network"); failCache = false;
  assert.equal(await (await dispatch(origin + "/_keep_alive_ping_")).text(), "pong");
  assert.equal(dispatch("https://other.invalid/330/", { mode: "navigate" }), null); assert.equal(dispatch(origin + "/other-app/", { mode: "navigate" }), null);
  failNetwork = true; cached = new Response("offline index"); assert.equal(await (await dispatch(scope, { mode: "navigate" })).text(), "offline index");
  let activated; listeners.activate({ waitUntil: (promise) => { activated = promise; } }); await activated;
  assert.deepEqual(calls.deleted, ["ephone-cache-v1.7.78"]); assert.equal(calls.claimed, 1);
  assert.doesNotMatch(source, /deleteDatabase|localStorage\.clear|sessionStorage\.clear/);
  console.log("PASS: local/remote/same-origin API bypass with stale-cache and credential guards, no worker API probes/retries, scoped static/navigation offline caching, cache-error fallback, unrelated-cache and user-data preservation");
})().catch((error) => { console.error(error); process.exitCode = 1; });
