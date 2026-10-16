const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const core = require("./api-routing-core.js"), source = fs.readFileSync("script.js", "utf8");
function extract(name) {
  const start = source.search(new RegExp("^  (?:async )?function " + name + "\\(", "m"));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n  }", start) + 4);
}
const names = ["_0x26253f", "_0x1e1f0e", "_0x2f1675", "_0x1e50aa", "_0x434d40", "_0x207404", "_0x29edc2", "_0x456d1d"];
function harness(missing = false) {
  const calls = [], alerts = [], selections = [], errors = [];
  const node = { style: {}, dataset: {}, value: "继续讨论", classList: { add() {}, remove() {}, contains: () => false }, querySelector: () => null };
  const chat = { id: "test-person", name: "林", originalName: "林", settings: { aiPersona: "成年人，有工作", myNickname: "我", myPersona: "成年人", maxMemory: 10 }, history: [{ role: "user", content: "继续", timestamp: 1 }] };
  const sandbox = {
    console: { log() {}, warn() {}, error: (...args) => errors.push(args.map(String).join(" ")) }, AbortController, Date, Math, setTimeout: () => 0, clearTimeout() {},
    document: { getElementById: () => node, querySelector: () => null }, alert: (message) => alerts.push(message),
    window: { ephoneApiRoutingCore: { ...core, select: (config, purpose) => { selections.push(purpose); return core.select(config, purpose); } } },
    _0x5ea3c1: { activeChatId: chat.id, chats: { [chat.id]: chat }, qzoneSettings: {}, worldBooks: [], globalSettings: {}, apiConfig: {
      proxyUrl: "https://primary.invalid/v1", apiKey: "fake-primary", model: "main-model",
      secondaryProxyUrl: "https://auxiliary.invalid/v1", secondaryApiKey: missing ? "" : "fake-secondary", secondaryModel: "aux-model",
    } },
    _0x24f906: { chats: { put: async () => {} }, doubanPosts: { get: async () => ({ title: "帖子", content: "今天的见闻", author: "我", comments: [{ commenter: "我", content: "你怎么看" }] }) } },
    _0x5a302c: { isActive: true, activeChatId: chat.id, callHistory: [], preCallContext: "聊天摘要", initiator: "user", isUserParticipating: true },
    _0x7f3744: chat.id, _0x55cb08: "post-id", _0x494a0a: { players: [{ id: "user", name: "我", isAlive: true }] }, _0x6b54d: {},
    _0xephoneSpectatorGenerating: false, _0xephoneGenerationController: null, _0xff446d: {},
    _0x49ef5f: async (history) => history, _0x514c4c: () => "", _0x4898fd: () => "", _0x31d550: () => "", _0x4b14d7: () => "周四",
    _0x20e281: () => ({}), GEMINI_API_URL: "https://generativelanguage.googleapis.com/v1beta/models",
    _0x1e5953: async (...args) => alerts.push(args), _0xff8a5b() {}, _0x3922f3() {}, _0x598116() {}, _0x28010b() {}, _0x3d226f: () => "小游戏上下文",
    _0x4bb316() {}, _0x257b23() {}, _0xephoneSetGenerating() {}, _0x57e676() {},
    _ephoneBuildApiEndpoint: (base, path) => base + "/" + path,
    _ephoneApiFetch: async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); throw new Error("isolated transport failure"); },
    fetch: async () => { throw new Error("Unexpected native request"); },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf("function _0x161a()"), source.indexOf("function setLanguage")) + source.slice(0, source.indexOf("function startServiceWorkerHeartbeat")), sandbox);
  sandbox._0x3ce505 = sandbox._0x14a8;
  vm.runInContext(extract("_ephoneApiFor") + names.map(extract).join("\n"), sandbox);
  return { sandbox, calls, alerts, selections, chat, errors };
}
(async () => {
  for (const missing of [false, true]) {
    for (const name of names.slice(0, -1)) {
      const h = harness(missing);
      // Post-fetch error UI is out of scope; inspect the real request generated
      // by the production function, not a replacement API implementation.
      await h.sandbox[name]().catch(() => {});
      assert.deepEqual(h.selections, ["auxiliary"], name);
      assert.equal(h.calls.length, missing ? 0 : 1, name + ": " + h.errors.join("; "));
      if (!missing) {
        assert.equal(h.calls[0].url, "https://auxiliary.invalid/v1/chat/completions", name);
        assert.equal(h.calls[0].options.headers.Authorization, "Bearer fake-secondary", name);
        assert.equal(h.calls[0].body.model, "aux-model", name);
      }
    }
    for (const decision of ["video", "friend"]) {
      const h = harness(missing);
      if (decision === "video") h.chat.history.push({ role: "system", content: "视频通话请求", timestamp: 2 });
      else h.chat.relationship = { status: "pending_ai_approval", applicationReason: "希望和好" };
      await h.sandbox._0x456d1d().catch(() => {});
      assert.deepEqual(h.selections, ["auxiliary"], decision);
      assert.equal(h.calls.length, missing ? 0 : 1, decision);
      if (!missing) {
        assert.equal(h.calls[0].url, "https://auxiliary.invalid/v1/chat/completions");
        assert.equal(h.calls[0].body.model, "aux-model");
        assert.equal(h.calls[0].options.headers.Authorization, "Bearer fake-secondary");
      }
    }
  }
  console.log("PASS: seven legacy generators plus video/friend decisions use actual auxiliary URL/key/model once, and make zero requests when secondary is missing; no primary fallback");
})().catch((error) => { console.error(error); process.exitCode = 1; });
