"use strict";
const assert = require("node:assert/strict");
const core = require("./ny-core.js");
const config = {
  tpl: { scaffold: [{ role: "system", text: "Analyze {{char}} for {{user}}. {{persona}} {{description}} {{personality}}" },
    { role: "user", text: "Previous: {{xbgetvar::NY-Sigon主程序.summary}}" }], specialIndex: 1, specialRoleType: "user", historyDepth: 2, includeWorldInfo: true },
  gen: { temperature: 0.2 }, extractRegex: "/\\[([^\\s\\[\\]\\/]+)(?:\\s[^\\[\\]]*?)?\\]([\\s\\S]*?)\\[\\/\\1\\]/g",
  api: { provider: "st", model: "test", url: "https://private.invalid/?token=private", key: "do-not-retain" },
  userPref: { enabled: false, text: "", before: "<preference>", after: "</preference>", role: "user", insertAt: 1 }, autoEnabled: false
};
config.tplRaw = structuredClone(config.tpl);
const fixture = {
  prompts: [
    { identifier: "style", name: "Style", role: "system", content: "{{char}} talks to {{user}}: {{LastMessage}} / {{LastUserMessage}}" },
    { identifier: "html", name: "自由创建前端", content: "Only a standalone page." },
    { identifier: "time", name: "时间框", content: "<Time>date</Time>" },
    { identifier: "vars", name: "Sigon summary", content: "Saved: {{xbgetvar::NY-Sigon主程序.summary}}" },
    { identifier: "legacy", name: "Sigon style", content: "Style: {{xbgetvar::NY-Sigon.WritingStyle}}" },
    { identifier: "empty", name: "Context marker", marker: true, content: "" },
    { identifier: "extra", name: "Optional extra", content: "Extra complete content" }
  ],
  prompt_order: [
    { character_id: 100000, order: [{ identifier: "style", enabled: false }], xiaobai_ext: { scheduledTasks: [
      { name: "NY-Sigon主程序", disabled: false, interval: 20, commands: "throw new Error('must never run')", x: { LittleWhiteBox: config } },
      { name: "NY-Sigon", commands: "untrusted panel code", x: {} },
      { name: "NY-Sogon主程序", interval: 10, x: { LittleWhiteBox: config } },
      { name: "NY-档案馆主程序", interval: 25, x: { LittleWhiteBox: { ...config, outputWhitelist: "world,people", expectedTags: [] } } }
    ] } },
    { character_id: 100001, order: ["style", "html", "time", "vars", "legacy", "empty"].map((identifier) => ({ identifier, enabled: !["vars", "legacy"].includes(identifier) })) }
  ], extensions: { regex_scripts: [{ replaceString: "<script>must never run</script>" }] }
};

const original = JSON.stringify(fixture), pack = core.parsePreset(fixture, "Ny-Claude-Test.json"), state = core.defaults(pack);
assert.equal(pack.family, "claude");
assert.equal(pack.source.orderCount, 6);
assert.equal(pack.prompts.length, 7);
assert.equal(pack.prompts.at(-1).sourceEnabled, false);
assert.equal(pack.prompts.at(-1).unordered, true);
assert.equal(pack.prompts.find((p) => p.id === "html").nativeEnabled, true);
assert.equal(pack.prompts.find((p) => p.id === "html").sourceEnabled, true);
assert.equal(pack.prompts.find((p) => p.id === "html").adaptation.kind, "panel");
assert.equal(pack.prompts.find((p) => p.id === "html").content, "Only a standalone page.", "import preserves the author's complete source text");
assert.deepEqual(pack.disabled, [], "presentation features are adapted rather than disabled");
assert.equal(pack.source.embeddedTaskCount, 4);
assert.equal(pack.source.regexCount, 1);
assert.deepEqual(Object.keys(pack.tasks), ["sigon", "sogon", "archive"]);
assert.doesNotMatch(JSON.stringify(pack), /must never run|private\.invalid|do-not-retain|untrusted panel code/);
assert.equal(JSON.stringify(fixture), original, "import never mutates or executes source data");
assert.equal(core.promptText(pack, state, {}), "");

state.enabled = true;
const context = { user: "Reader", char: "Speaker", persona: "Reader persona", description: "Character bio", personality: "Patient",
  history: [{ role: "user", content: "old history" }, { role: "user", content: "latest user" }, { role: "assistant", content: "latest response" }], worldInfo: "World information" };
let text = core.promptText(pack, state, context);
assert.match(text, /Speaker talks to Reader: latest response \/ latest user/);
assert.doesNotMatch(text, /Saved:|Style:|<Time>|Extra/);
assert.match(text, /Only a standalone page\.[\s\S]*ny_extra\.panel_html/, "enabled frontend source is followed by the native panel protocol");
assert.match(text, /本空间当前所选时钟[\s\S]*scene_elapsed_minutes/, "time-frame options use the shared clock and scene progression");
state.tasks.sigon.result = { tags: { summary: "Complete prior memory", WritingStyle: "Quiet style" }, all: "entire report" };
assert.doesNotMatch(core.promptText(pack, state, context), /Complete prior memory/, "disabled task does not leak saved output");
state.tasks.sigon.enabled = true;
text = core.promptText(pack, state, context);
assert.match(text, /Saved: Complete prior memory/);
assert.match(text, /Style: Quiet style/);
state.promptOverrides.vars = false;
assert.doesNotMatch(core.promptText(pack, state, context), /Saved:/);
state.promptOverrides.extra = true;
assert.match(core.promptText(pack, state, context), /Extra complete content/);
state.promptOverrides.html = true;
assert.match(core.promptText(pack, state, context), /standalone[\s\S]*正文消息必须完整保留/, "adapted frontend keeps complete body plus the interactive panel");
state.promptOverrides.html = false;
assert.doesNotMatch(core.promptText(pack, state, context), /standalone|ny_extra\.panel_html/, "users can disable a source feature without disabling other features");

const adaptationFixture = {
  prompts: [
    { identifier: "panel", name: "情景剧场", content: "ORIGINAL_PANEL_SOURCE <button>scene</button>" },
    { identifier: "state", name: "动态状态栏", content: "ORIGINAL_STATUS_SOURCE" },
    { identifier: "forum", name: "实时论坛", content: "ORIGINAL_FORUM_SOURCE" },
    { identifier: "options", name: "四个选项", content: "ORIGINAL_CHOICE_SOURCE" },
    { identifier: "english", name: "双语英&汉", content: "ORIGINAL_ENGLISH_SOURCE" },
    { identifier: "japanese", name: "双语日&汉", content: "ORIGINAL_JAPANESE_SOURCE" },
    { identifier: "summary", name: "全篇总结", content: "ORIGINAL_SUMMARY_SOURCE" },
    { identifier: "cot", name: "CoT检查", content: "ORIGINAL_COT_SOURCE <thinking>quality checks</thinking>" },
    { identifier: "marker", name: "动态防标记", content: "ORIGINAL_MARKER_SOURCE" },
    { identifier: "model-style", name: "Gemini风格", content: "ORIGINAL_MODEL_STYLE_SOURCE" },
    { identifier: "unselected", name: "未选中的风格", content: "UNSELECTED_SOURCE_CONTENT" }
  ],
  prompt_order: [{ order: ["panel", "state", "forum", "options", "english", "japanese", "summary", "cot", "marker", "model-style", "unselected"]
    .map((identifier) => ({ identifier, enabled: !["unselected", "japanese"].includes(identifier) })) }]
};
const adaptationOriginal = JSON.stringify(adaptationFixture), adaptedPack = core.parsePreset(adaptationFixture, "native-features.json"), adaptedState = core.defaults(adaptedPack);
adaptedState.enabled = true;
assert.ok(adaptedPack.prompts.every((p) => p.nativeEnabled && p.reason === ""));
assert.equal(JSON.stringify(adaptationFixture), adaptationOriginal);
for (const original of adaptationFixture.prompts) assert.equal(adaptedPack.prompts.find((p) => p.id === original.identifier).content, original.content);
const adapted = core.promptText(adaptedPack, adaptedState, {}), activeFeatures = core.features(adaptedPack, adaptedState);
assert.equal(activeFeatures.panel, true);
assert.equal(activeFeatures.options, true);
assert.equal(activeFeatures.translation, "英文", "author-disabled Japanese alternative cannot replace the active English version");
assert.equal(activeFeatures.quality, true);
assert.equal(activeFeatures.marker, true);
assert.deepEqual(activeFeatures.summaries.map((p) => p.content), ["ORIGINAL_SUMMARY_SOURCE"], "the auxiliary summary receives the complete original instructions");
assert.match(adapted, /ORIGINAL_CHOICE_SOURCE[\s\S]*ny_extra\.options/);
assert.match(adapted, /ORIGINAL_ENGLISH_SOURCE[\s\S]*ny_extra\.translation/);
assert.match(adapted, /ORIGINAL_PANEL_SOURCE[\s\S]*ny_extra\.panel_html/);
assert.match(adapted, /ORIGINAL_STATUS_SOURCE[\s\S]*ORIGINAL_FORUM_SOURCE/);
assert.match(adapted, /副 API/);
assert.match(adapted, /人设、人物关系、当前时间[\s\S]*不输出详细思维链/);
assert.match(adapted, /直接输出小手机规定的 JSON 消息数组/);
assert.match(adapted, /ORIGINAL_MODEL_STYLE_SOURCE/, "a model-family label cannot disable ordinary style instructions");
assert.doesNotMatch(adapted, /UNSELECTED_SOURCE_CONTENT|ORIGINAL_JAPANESE_SOURCE|ORIGINAL_SUMMARY_SOURCE|ORIGINAL_COT_SOURCE|ORIGINAL_MARKER_SOURCE/);
adaptedState.promptOverrides.english = false; adaptedState.promptOverrides.japanese = true;
assert.equal(core.features(adaptedPack, adaptedState).translation, "日文");
assert.doesNotMatch(core.promptText(adaptedPack, adaptedState, {}), /ORIGINAL_ENGLISH_SOURCE/);
assert.match(core.promptText(adaptedPack, adaptedState, {}), /ORIGINAL_JAPANESE_SOURCE/);
adaptedState.promptOverrides.summary = false;
assert.equal(core.features(adaptedPack, adaptedState).summaries.length, 0);
adaptedState.enabled = false;
assert.deepEqual(core.features(adaptedPack, adaptedState), { summaries: [] });
assert.equal(core.promptText(adaptedPack, adaptedState, {}), "");
const legacyPack = structuredClone(adaptedPack); delete legacyPack.adapterVersion;
legacyPack.prompts[0].nativeEnabled = false; legacyPack.prompts[0].reason = "legacy presentation conflict";
legacyPack.disabled = [{ id: "panel", reason: "legacy presentation conflict" }];
const upgraded = core.upgradePack(legacyPack);
assert.equal(upgraded.adapterVersion, 2);
assert.equal(upgraded.prompts[0].nativeEnabled, true);
assert.equal(upgraded.prompts[0].content, legacyPack.prompts[0].content);
assert.equal(upgraded.prompts[0].sourceEnabled, legacyPack.prompts[0].sourceEnabled);
assert.deepEqual(upgraded.disabled, []);
assert.equal(legacyPack.prompts[0].nativeEnabled, false, "upgrade creates a new pack without mutating legacy configuration");

const task = core.taskPrompt(pack, "sigon", state, context);
assert.equal(task.messages.length, 3);
assert.equal(task.messages[1].role, "user");
assert.match(task.messages[0].content, /Speaker for Reader.*Reader persona Character bio Patient/);
assert.match(task.messages[1].content, /World information[\s\S]*latest user[\s\S]*latest response/);
assert.doesNotMatch(task.messages[1].content, /old history/);
assert.match(task.messages[2].content, /Complete prior memory/);
assert.equal(task.config.gen.temperature, 0.2);
assert.equal(task.maxRounds, 3);
state.tasks.sigon.prefs.historyDepth = 1;
state.tasks.sigon.prefs.includeWorldInfo = false;
state.tasks.sigon.prefs.userPref = { enabled: true, text: "My complete preference", before: "[prefs]", after: "[/prefs]", insertAt: 1, role: "system" };
const customized = core.taskPrompt(pack, "sigon", state, context);
assert.equal(customized.messages[1].role, "system");
assert.match(customized.messages[1].content, /My complete preference/);
assert.doesNotMatch(customized.messages[2].content, /World information|latest user/);
assert.equal(pack.tasks.sigon.config.tpl.historyDepth, 2, "caller preferences do not mutate imported templates");

const tagText = (names, prefix = "value:") => names.map((name) => "[" + name + "]" + prefix + name + "[/" + name + "]").join("\n");
for (const kind of ["sigon", "sogon", "archive"]) {
  const request = core.taskPrompt(pack, kind, state, context), raw = tagText(request.expectedTags), result = core.applyResult(kind, raw, null, request.config);
  assert.equal(result.complete, true, kind + " complete protocol");
  assert.equal(result.missing.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.raw, raw);
  for (const name of request.expectedTags) assert.equal(result.tags[name], "value:" + name);
}
const prior = core.applyResult("archive", "[world]old world[/world][people]old people[/people]", null, { outputWhitelist: ["world", "people"] });
const partial = core.applyResult("archive", "[world]new world[/world][people]unfinished", prior, { outputWhitelist: ["world", "people"] });
assert.equal(partial.complete, false);
assert.deepEqual(partial.missing, ["people"]);
assert.deepEqual(partial.staleTags, ["people"]);
assert.deepEqual(partial.updatedTags, ["world"]);
assert.equal(partial.tags.people, "old people");
assert.match(partial.all, /new world[\s\S]*old people/);
assert.equal(partial.raw, "[world]new world[/world][people]unfinished");
const incomplete = core.applyResult("sigon", "[summary]fresh summary[/summary]", { tags: { WritingStyle: "old style" } }, {});
assert.equal(incomplete.complete, false);
assert.equal(incomplete.tags.WritingStyle, undefined, "non-archive new results do not silently reuse obsolete analysis");

const xml = core.applyResult("sigon", "<summary>entire XML result</summary>", null, { expectedTags: ["summary"], extractRegex: "/<([^\\s<>/]+)>([\\s\\S]*?)<\\/\\1>/g" });
assert.equal(xml.tags.summary, "entire XML result");
assert.equal(xml.warnings.length, 0);
assert.equal(xml.complete, true);
const insensitive = core.applyResult("sigon", "[SUMMARY]case-insensitive value[/summary]", null, { expectedTags: ["summary"], extractRegex: config.extractRegex.replace(/g$/, "gi") });
assert.equal(insensitive.complete, true);
assert.equal(insensitive.tags.summary, "case-insensitive value");
const malicious = core.applyResult("sigon", "a".repeat(150000) + "[summary]safe[/summary]", null, { extractRegex: "/(a+)+$/g" });
assert.equal(malicious.tags.summary, "safe");
assert.equal(malicious.warnings.length, 1);
const prototype = core.applyResult("archive", "[__proto__]value[/__proto__][world]text[/world]", null, { outputWhitelist: ["world"] });
assert.equal({}.polluted, undefined);
assert.equal(Object.getPrototypeOf(prototype.tags), null);
assert.equal(prototype.tags.world, "text");
const long = "完整内容".repeat(50000), longResult = core.applyResult("sigon", "[summary]" + long + "[/summary]", null, { expectedTags: ["summary"] });
assert.equal(longResult.tags.summary, long, "full reports remain intact");
state.tasks.sigon.result = longResult;
state.promptOverrides.vars = true;
assert.ok(core.promptText(pack, state, context).includes(long), "injection never silently truncates generated results");
const bad = structuredClone(fixture); bad.prompt_order[1].order.push({ identifier: "missing", enabled: true });
assert.match(core.parsePreset(bad, "Ny-Gemini-Test.json").warnings[0], /missing/);
assert.equal(core.parsePreset(bad, "Ny-Gemini-Test.json").family, "gemini");
for (const name of ["Tips：总结方式", "Tips：更推荐的总结方式"]) {
  const guide = { id: "help", name, content: "作者的总结配置说明", sourceEnabled: true };
  assert.equal(core.adaptation(guide).kind, "text", "reading configuration tips must not activate a paid summary task");
  assert.equal(core.features({ prompts: [guide] }, { enabled: true }).summaries.length, 0);
}
console.log("PASS: native NY data-only import, complete immutable source, enabled-feature selection, panels/options/bilingual/time/auxiliary-summary/quality/marker adaptations, legacy pack upgrade, template context, gated per-chat variables, complete reports, safe tag extraction, archive fallback and caller-owned preferences");
