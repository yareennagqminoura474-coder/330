const assert = require("node:assert/strict"), fs = require("node:fs"), core = require("./api-routing-core.js");
const config = { proxyUrl: "https://primary.invalid/v1", apiKey: "fake-primary", model: "reply-model", secondaryProxyUrl: "https://auxiliary.invalid/v1", secondaryApiKey: "fake-secondary", secondaryModel: "aux-model" };
assert.deepEqual(core.select(config, "reply"), { proxyUrl: config.proxyUrl, apiKey: config.apiKey, model: config.model });
assert.deepEqual(core.select(config, "auxiliary"), { proxyUrl: config.secondaryProxyUrl, apiKey: config.secondaryApiKey, model: config.secondaryModel });
for (const field of ["secondaryApiKey", "secondaryModel"]) assert.throws(() => core.select({ ...config, [field]: "" }, "auxiliary"), (e) => e.code === "AUXILIARY_API_MISSING");
assert.throws(() => core.select(config, "unknown"), /未知/);
assert.equal(core.select({ ...config, secondaryProxyUrl: "" }, "auxiliary").proxyUrl, "https://api.openai.com");
const preset = { id: 7, name: "低价生成", proxyUrl: "https://preset.invalid/v1", apiKey: "fake-preset", model: "preset-model", secondaryModel: "not-this-model" };
const snapshot = core.presetSnapshot(preset, (s) => s.replace(/\/v1$/, ""), 123);
assert.equal(snapshot.secondaryModel, "preset-model"); assert.equal(snapshot.secondaryProxyUrl, "https://preset.invalid"); assert.equal(snapshot.secondaryPresetSnapshot.name, "低价生成");
preset.model = "changed-model"; preset.apiKey = "changed-key"; preset.name = "changed-name";
assert.equal(snapshot.secondaryModel, "preset-model"); assert.equal(snapshot.secondaryApiKey, "fake-preset"); assert.equal(snapshot.secondaryPresetSnapshot.name, "低价生成");
assert.throws(() => core.presetSnapshot({ name: "不完整" }), /原副 API 没有改动/);
const s = fs.readFileSync("script.js", "utf8"), primary = new Set(["_0x135d5c", "_0x456d1d"]);
let found = 0;
for (const m of s.matchAll(/\{\s*proxyUrl: _0x[0-9a-f]+,\s*apiKey: _0x[0-9a-f]+,\s*model: _0x[0-9a-f]+,\s*\}\s*=\s*_0x5ea3c1\[(?:"apiConfig"|_0x[0-9a-f]+\(0x162b\))\]/g)) {
  const fn = [...s.slice(0, m.index).matchAll(/^  (?:async )?function (_0x[0-9a-f]+)/gm)].at(-1)?.[1];
  assert.fail("generation must use explicit purpose routing, not raw primary config: " + fn); found++;
}
assert.equal(found, 0);
for (const m of s.matchAll(/= _ephoneApiFor\("reply"\)/g)) {
  const fn = [...s.slice(0, m.index).matchAll(/^  (?:async )?function (_0x[0-9a-f]+)/gm)].at(-1)?.[1];
  assert.ok(primary.delete(fn), "only main chat reply paths use primary: " + fn);
}
assert.equal(primary.size, 0); assert.equal((s.match(/= _ephoneApiFor\("auxiliary"/g) || []).length, 38);
assert.match(s.slice(s.indexOf("generateMessages: async"), s.indexOf("generate: async (prompt, signal)")), /_ephoneApiFor\("auxiliary"\)/, "NY tagged analysis must use auxiliary routing too");
assert.doesNotMatch(s, /__ephone_continue__|_ephoneRecoveryPrompt|_0xephoneContinue/);
assert.doesNotMatch(s.slice(s.indexOf("async function _0x1cf16a"), s.indexOf("async function _0x4a6dc1")), /secondaryProxyUrl:|secondaryApiKey:|secondaryModel:/);
console.log("PASS: strict reply/auxiliary routing, no missing-secondary fallback, preset value snapshots, legacy call-site audit, independent primary preset switching");
