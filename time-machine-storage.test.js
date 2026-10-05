const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const KEY = "ephone_time_machine_v1";
const source = fs.readFileSync("time-machine.js", "utf8");
const copy = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness(initial = {}, capacity = Infinity, writesBlocked = false) {
  const storage = new Map(Object.entries(initial));
  const warnings = [];
  const window = {};
  vm.runInNewContext(source, {
    window, Date, Number, String, Promise, setInterval,
    document: { readyState: "loading", addEventListener() {}, getElementById() { return null; } },
    console: { warn: (...args) => warnings.push(args) },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem(key, value) {
        const total = [...storage].reduce((size, [k, v]) => size + (k === key ? 0 : k.length + v.length), 0) + key.length + value.length;
        if (writesBlocked || total > capacity) throw new DOMException("Setting the value exceeded the quota", "QuotaExceededError");
        storage.set(key, value);
      },
    },
  });
  const clock = window.ephoneTimeMachine;
  function bind(chat, options = {}) {
    clock.bindChat({ id: chat.id, settings: chat.settings,
      getMessages: () => chat.history, getMemories: () => chat.longTermMemory,
      applyConfig: async (config) => {
        if (options.failSave) throw new Error("database unavailable");
        Object.assign(chat.settings, clock.configForChatSettings(config));
        options.onSave?.(copy(chat));
      },
    });
  }
  return { storage, clock, bind, warnings };
}

(async () => {
  const full = harness({ theme: "keep", otherApplication: "do-not-delete" }, 30, true);
  const chat = { id: "spectator", settings: {}, history: [], longTermMemory: [] };
  assert.doesNotThrow(() => full.bind(chat));
  await full.clock.jumpTo(new Date(2026, 2, 5, 13, 47).getTime(), "frozen");
  const old = { role: "assistant", timestamp: 1000, vts: full.clock.nowMs(), content: "继续" };
  chat.history.push(old);
  const preparation = full.clock.prepareReplyTime(chat.history, { chatId: chat.id });
  assert.ok(preparation.changed);
  await tick();
  assert.equal(chat.settings.customAnchorVirtualMs, preparation.afterMs);
  assert.equal(full.clock.messageTime(old), old.vts);
  assert.equal(full.clock.resolveTimestamp(old.timestamp), old.vts);
  await full.clock.rollbackPreparedReplyTime(preparation);
  assert.equal(full.clock.nowMs(), preparation.beforeMs);
  await full.clock.jumpTo(preparation.beforeMs + 86400000, "flow");
  assert.equal(full.clock.messageTime(old), old.vts);
  await full.clock.useRealTime();
  assert.equal(full.clock.getConfig().mode, "real");
  assert.equal(full.storage.get("theme"), "keep");
  assert.equal(full.storage.get("otherApplication"), "do-not-delete");

  const virtual = new Date(2026, 2, 5, 13, 47).getTime();
  const frozen = Object.fromEntries(Array.from({ length: 12000 }, (_, i) => [String(100000 + i), virtual + i * 1000]));
  const legacyConfig = { mode: "custom", flow: "frozen", anchorRealMs: 100000, anchorVirtualMs: virtual, frozen };
  const originalCache = { large: legacyConfig, unopened: { ...legacyConfig, frozen: { "55": virtual - 1 } } };
  const oldChat = { id: "large", settings: { timeMode: "custom", customTimeFlow: "frozen", customAnchorRealMs: 100000, customAnchorVirtualMs: virtual, virtualTimeFrozenMap: copy(frozen) },
    history: Object.keys(frozen).map((timestamp) => ({ role: "assistant", timestamp: Number(timestamp), content: "历史" })),
    longTermMemory: [{ timestamp: 77, vts: virtual - 1000, content: "总结记忆" }] };
  // An unmapped historical record must retain its old lookup until it is loaded.
  oldChat.settings.virtualTimeFrozenMap["unloaded"] = virtual + 500;
  const legacy = harness({ [KEY]: JSON.stringify(originalCache), unrelated: "preserve" }, 2000);
  let durableCopy;
  legacy.bind(oldChat, { onSave: (value) => { durableCopy = value; } });
  await tick();
  assert.equal(oldChat.history[123].vts, frozen["100123"]);
  assert.equal(legacy.clock.resolveTimestamp(100123), frozen["100123"]);
  assert.equal(durableCopy.history[123].vts, frozen["100123"]);
  assert.equal(durableCopy.settings.virtualTimeFrozenMap.unloaded, virtual + 500);
  assert.ok(Object.keys(durableCopy.settings.virtualTimeFrozenMap).length < 3);
  assert.ok(legacy.storage.get(KEY).length < 2000);
  assert.equal(JSON.parse(legacy.storage.get(KEY)).unopened.frozen["55"], virtual - 1);
  assert.equal(legacy.storage.get("unrelated"), "preserve");

  const reloaded = harness(Object.fromEntries(legacy.storage));
  reloaded.bind(durableCopy);
  await tick();
  assert.equal(reloaded.clock.messageTime(durableCopy.history[123]), frozen["100123"]);
  assert.equal(reloaded.clock.resolveTimestamp(100123), frozen["100123"]);
  assert.equal(reloaded.clock.messageTime(durableCopy.longTermMemory[0]), virtual - 1000);
  assert.equal(reloaded.clock.resolveTimestamp(77), virtual - 1000);
  assert.equal(reloaded.clock.nowMs(), virtual);

  // Never remove the sole legacy copy if the primary database save fails.
  const failed = harness({ [KEY]: JSON.stringify(originalCache) }, 1000);
  failed.bind({ ...copy(oldChat), settings: {} }, { failSave: true });
  await tick();
  assert.equal(failed.storage.get(KEY), JSON.stringify(originalCache));
  assert.ok(failed.warnings.length);

  // Missing vts is not zero; an absent anchor is not the Unix epoch either.
  const defaults = harness();
  assert.equal(defaults.clock.getConfig("no-settings").anchorVirtualMs, null);
  assert.equal(defaults.clock.messageTime({ timestamp: 123, vts: null }, "no-settings"), 123);
  console.log("Time machine storage quota and migration tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
