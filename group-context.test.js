const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = require("./group-context.js");

function fixture(spectator = true) {
  const a = { id: "chat_a", name: "师兄备注", originalName: "杨帆", groupId: 1,
    settings: { aiPersona: "我是杨帆，林澈的师兄；{{user}}是师父。", myNickname: "师父", myPersona: "林珣，杨帆和林澈的师父。" },
    history: [], longTermMemory: [{ content: "我答应林澈明天陪他练功。", vts: 100 }] };
  const b = { id: "chat_b", name: "林澈", originalName: "林澈", groupId: 1,
    settings: { aiPersona: "杨帆是我的师兄，林珣是师父。" }, history: [] };
  const linked = { id: "linked", name: "练功群", isGroup: true, settings: {},
    members: [{ originalName: "杨帆", groupNickname: "大师兄" }],
    history: [
      { role: "assistant", senderName: "杨帆", content: "明天去练功。", timestamp: 10, vts: 101 },
      { role: "user", type: "narration", content: "下雨了。", timestamp: 11, vts: 102 },
      { role: "system", isHidden: true, content: "隐藏初始化", timestamp: 12 },
      { role: "assistant", content: "已被用户删除", timestamp: 13 },
    ], longTermMemory: [{ content: "双方约定在练功场见面。", vts: 99 }] };
  const npcs = [{ id: 7, name: "林珣", persona: "杨帆、林澈是我的弟子。", associatedWith: ["chat_a", "chat_b"] }];
  const chat = { id: "group", name: "无", isGroup: true, isSpectatorGroup: spectator,
    settings: { maxMemory: 20, linkedMemoryCount: 2, linkedMemoryChatIds: ["linked", "group", "linked", "missing"] },
    members: [
      { id: "chat_a", originalName: "杨帆", groupNickname: "大师兄", persona: a.settings.aiPersona, ephoneSourcePersona: a.settings.aiPersona, ephonePersonaOverride: false },
      { id: "chat_b", originalName: "林澈", groupNickname: "林澈", persona: b.settings.aiPersona },
      { id: "npc_7", originalName: "林珣", groupNickname: "师父", persona: npcs[0].persona, isNpc: true },
    ], history: [
      { role: "assistant", senderName: "杨帆", content: "听师父的话。", timestamp: 20, vts: 105 },
      { role: "user", type: "narration", content: "SECRET起身离开。", timestamp: 21, vts: 106 },
      { role: "assistant", senderName: "林澈", sentAsCharacter: true, content: "师兄，等等我。", timestamp: 22, vts: 107 },
    ], longTermMemory: [{ content: "林澈拜林珣为师，杨帆是师兄。", vts: 104 }] };
  return { chat, chats: { chat_a: a, chat_b: b, linked, group: chat }, npcs, formatTime: (ms) => `virtual-${ms}` };
}

function unitTests() {
  const data = fixture();
  const built = context.buildContext(data);
  const normal = context.buildContext(fixture(false));
  for (const key of ["membersText", "memoryText", "linkedMemoryText"]) assert.equal(built[key], normal[key]);
  for (const name of ["杨帆", "林澈", "林珣"]) assert.ok(built.membersText.includes(name));
  assert.match(built.membersText, /原聊天对象人设：林珣/);
  assert.match(built.membersText, /不自动意味着亲属、恋人或师徒/);
  assert.match(built.memoryText, /本群“无”的剧情总结/);
  assert.match(built.memoryText, /杨帆的个人记忆/);
  assert.match(built.linkedMemoryText, /双方约定在练功场见面/);
  assert.match(built.linkedMemoryText, /旁白\/场景 \[virtual-102\]/);
  assert.equal(built.linkedMemoryText.match(/已勾选参考聊天/g).length, 1);
  assert.doesNotMatch(built.linkedMemoryText, /隐藏初始化|已被用户删除/);
  assert.equal(context.recentHistory(data.chats.linked, 2).length, 2);
  assert.equal(context.resolveSpeaker(built.profiles, "大师兄"), "杨帆");
  assert.equal(context.resolveSpeaker(built.profiles, "师兄备注"), "杨帆");
  assert.equal(context.resolveSpeaker(built.profiles, "陌生人"), null);
  data.chat.members[1].groupNickname = "大师兄";
  assert.equal(context.resolveSpeaker(context.buildContext(data).profiles, "大师兄"), null);
  data.chats.chat_a.settings.aiPersona = "最新设定：林澈是我的师弟。";
  assert.equal(context.buildContext(data).profiles[0].persona, data.chats.chat_a.settings.aiPersona);
  data.chat.members[0].ephonePersonaOverride = true;
  data.chat.members[0].persona = "本群我是林澈的兄长。";
  assert.match(context.buildContext(data).membersText, /本群专用人设（优先遵守）：\n本群我是林澈的兄长/);
  // Do not erase legacy per-group edits whose provenance cannot be recovered.
  delete data.chat.members[0].ephonePersonaOverride;
  delete data.chat.members[0].ephoneSourcePersona;
  assert.equal(context.buildContext(data).profiles[0].persona, "本群我是林澈的兄长。");
  const rawPhoto = context.describeMessage(data.chat, { role: "assistant", content: "data:image/png;base64,AAAA", timestamp: 1 });
  assert.doesNotMatch(rawPhoto, /base64|AAAA/);
  assert.match(context.describeMessage(data.chat, data.chat.history.at(-1)), /^林澈/);
  assert.match(context.describeMessage(data.chat, data.chat.history[1]), /^旁白\/场景/);
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.indexOf('src="group-context.js?') < html.indexOf('src="script.js?'));
  assert.match(fs.readFileSync("sw.js", "utf8"), /group-context\.js\?v=1\.7\.57/);
  const app = fs.readFileSync("script.js", "utf8");
  const ordinaryGroupBlock = app.slice(app.indexOf("const _ephoneGroupContext = await _ephoneBuildGroupContext(_0x5b16cb)"), app.indexOf("const _0x51aaf6" ) + 85);
  assert.match(ordinaryGroupBlock, /_ephoneGroupContext\.linkedMemoryText/);
  assert.match(ordinaryGroupBlock, /_ephoneGroupContext\.memoryText/);
  assert.match(ordinaryGroupBlock, /_ephoneGroupContext\.membersText/);
}

function appHarness() {
  const data = fixture();
  const source = fs.readFileSync("script.js", "utf8");
  const button = { disabled: false, dataset: { idleHtml: "▶" }, setAttribute() {} };
  const reroll = { disabled: true, dataset: {}, title: "重抽" };
  const input = { disabled: false };
  const controls = { querySelectorAll: () => [button, reroll, input] };
  const errors = [], rendered = [], saved = [], requests = [];
  let rollbacks = 0;
  const sandbox = {
    console: { ...console, warn() {} }, AbortController, DOMException, Date, Math,
    setTimeout: (fn) => setTimeout(fn, 0),
    window: { ephoneGroupContext: context, ephoneTimeMachine: {
      prepareReplyTime: () => ({ afterMs: 200, minutes: 2 }),
      rollbackPreparedReplyTime: async () => { rollbacks++; },
      getPromptRule: () => "当前虚拟时间virtual-200",
      formatDateTime: data.formatTime,
      ensureReplyHeader: (items) => [{ type: "narration", isReplyHeader: true, content: "virtual-200，地点：家" }, ...items],
    } },
    document: { getElementById: (id) => id === "spectator-propel-btn" ? button : id === "spectator-reroll-btn" ? reroll : null,
      querySelector: () => controls },
    _0x5ea3c1: { activeChatId: data.chat.id, chats: data.chats, apiConfig: { proxyUrl: "https://example.invalid/v1", apiKey: "test-only", model: "test" }, globalSettings: { apiTemperature: 0.5 } },
    _0x24f906: { npcs: { toArray: async () => data.npcs }, chats: { put: async (chat) => saved.push(JSON.parse(JSON.stringify(chat))) } },
    _0x49ef5f: async (messages) => messages.map((message) => ({ ...message, content: message.content?.replace("SECRET", "") })),
    _0x5ea60f: () => "", _0x4a3960: data.formatTime,
    _0x297b4d: JSON.parse, getGeminiResponseText: (response) => response.choices[0].message.content,
    _ephoneBuildApiEndpoint: (base, path) => base + "/" + path,
    _0xff8a5b() {}, _0xbb356a: async (message) => rendered.push(message), _0x4bb316() {},
    _0x1e5953: async (...args) => errors.push(args), _ephoneRestoreChatScrolling() {},
    _0xephoneSpectatorGenerating: false, _0xephoneSpectatorController: null, _0xephoneGenerationController: null,
    lastRawAiResponse: "", lastResponseTimestamps: [],
    _ephoneApiFetch: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify([
        { type: "text", name: "大师兄", content: "师弟，去练功吧。" },
        { type: "text", name: "不存在的角色", content: "不能出现" },
      ]) } }] }) };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf("function _0x161a()"), source.indexOf("function setLanguage")) +
    source.slice(0, source.indexOf("function startServiceWorkerHeartbeat")), sandbox);
  sandbox._0x3ce505 = sandbox._0x14a8;
  vm.runInContext(source.slice(source.indexOf("  function _ephoneGetRerollBatch"), source.indexOf("  function _ephoneBuildSpectatorControls")) +
    source.slice(source.indexOf("  async function _ephoneBuildGroupContext"), source.indexOf("  function _0xephoneSetGenerating")), sandbox);
  return { sandbox, data, requests, button, reroll, input, rendered, saved, errors, get rollbacks() { return rollbacks; } };
}

(async () => {
  unitTests();
  const h = appHarness();
  await h.sandbox._0x135d5c();
  assert.equal(h.errors.length, 0);
  assert.equal(h.requests.length, 1);
  const body = h.requests[0].body;
  assert.match(body.messages[0].content, /本群“无”的剧情总结/);
  assert.match(body.messages[0].content, /杨帆的个人记忆/);
  assert.match(body.messages[0].content, /林珣，杨帆和林澈的师父/);
  assert.doesNotMatch(JSON.stringify(body), /SECRET|undefined/);
  assert.match(body.messages.find((message) => message.content.includes("起身离开")).content, /^旁白\/场景/);
  assert.match(body.messages.at(-2).content, /^林澈/);
  assert.match(body.messages.at(-1).content, /从最后一条消息继续推进/);
  assert.ok(h.requests[0].options.signal instanceof AbortSignal);
  assert.equal(h.rendered.length, 2);
  assert.equal(h.rendered.at(-1).senderName, "杨帆");
  assert.equal(h.rendered.at(-1).vts, 200);
  assert.ok(h.saved.length >= 2);
  assert.equal(h.sandbox._0xephoneSpectatorGenerating, false);
  assert.equal(h.button.disabled, false);
  assert.equal(h.input.disabled, false);
  assert.equal(h.reroll.disabled, false);
  h.data.chat.history.push({ role: "assistant", sentAsCharacter: true, senderName: "林澈", content: "再等等", timestamp: 9999 });
  h.sandbox._ephoneSyncRerollButtons(h.data.chat);
  assert.equal(h.reroll.disabled, true);

  const stopped = appHarness();
  let enteredFetch;
  const fetchStarted = new Promise((resolve) => { enteredFetch = resolve; });
  stopped.sandbox._ephoneApiFetch = async (url, options) => {
    enteredFetch();
    await new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true }));
  };
  const pending = stopped.sandbox._0x135d5c();
  await fetchStarted;
  assert.equal(stopped.button.disabled, false);
  assert.equal(stopped.button.title, "停止回复");
  await stopped.sandbox._0x135d5c();
  await pending;
  assert.equal(stopped.rollbacks, 1);
  assert.equal(stopped.errors.length, 0);
  assert.equal(stopped.sandbox._0xephoneSpectatorGenerating, false);
  assert.equal(stopped.reroll.disabled, true);
  assert.equal(stopped.input.disabled, false);

  // Stop after visible output: retain the displayed partial reply, do not roll
  // back its clock, and never continue writing later messages in that batch.
  const partial = appHarness();
  partial.sandbox._ephoneApiFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: {
    content: JSON.stringify([
      { type: "text", name: "杨帆", content: "第一句" },
      { type: "text", name: "林澈", content: "不能在停止后出现" },
    ]),
  } }] }) });
  partial.sandbox._0xbb356a = async (message) => {
    partial.rendered.push(message);
    if (message.content === "第一句") await partial.sandbox._0x135d5c();
  };
  await partial.sandbox._0x135d5c();
  assert.equal(partial.rendered.length, 2);
  assert.equal(partial.rollbacks, 0);
  assert.equal(partial.errors.length, 0);
  assert.equal(partial.saved.at(-1).history.at(-1).content, "第一句");

  // A reply for a chat left in the background must not append to the new UI.
  const switched = appHarness();
  const originalApi = switched.sandbox._ephoneApiFetch;
  switched.sandbox._ephoneApiFetch = async (...args) => {
    switched.sandbox._0x5ea3c1.activeChatId = "other-group";
    return originalApi(...args);
  };
  await switched.sandbox._0x135d5c();
  assert.equal(switched.rendered.length, 0);
  assert.equal(switched.saved.at(-1).id, "group");
  console.log("Group context and spectator request/stop regression tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
