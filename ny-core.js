(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EPhoneNyCore = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // Imported presets are data. This module never evaluates their programs, regex
  // replacements, markup or credentials, and does not make network requests.
  // API: parsePreset -> serializable pack; defaults -> caller-owned chat state;
  // taskPrompt -> {messages,config,expectedTags,maxRounds,finalTag};
  // applyResult -> {raw,all,tags,complete,missing,staleTags,updatedTags,warnings};
  // promptText -> the enabled, resolved preset text for the ordinary chat request.
  const KINDS = ["sigon", "sogon", "archive"];
  const TAGS = {
    sigon: ["Matrix", "summary", "WritingStyle", "剧情建议"],
    sogon: ["summary", "角色大五人格画像", "OOC风险与修正", "依恋模式分析", "情绪调节模式分析", "核心关系图式分析", "爱的三角结构分析", "防御机制分析", "角色补丁", "状态贴片", "关系进展"],
    archive: ["世界观", "main_char", "support_chars", "主线剧情", "支线剧情", "当前主线进度", "设定偏离与修正"]
  };
  const LABELS = { sigon: "NY-Sigon", sogon: "NY-Sogon", archive: "NY-档案馆" };
  const DEFAULT_REGEX = "/\\[([^\\s\\[\\]\\/]+)(?:\\s[^\\[\\]]*?)?\\]([\\s\\S]*?)\\[\\/\\1\\]/g";
  const str = (value) => typeof value === "string" ? value : value == null ? "" : String(value);
  const own = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);
  const dict = () => Object.create(null);
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, low, high, fallback) => Math.max(low, Math.min(high, Math.floor(finite(value, fallback))));
  const role = (value) => ["system", "user", "assistant"].includes(value) ? value : value === "sys" ? "system" : "user";
  function copy(value) {
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === "object") {
      const out = dict();
      for (const key of Object.keys(value)) if (!["__proto__", "prototype", "constructor"].includes(key)) out[key] = copy(value[key]);
      return out;
    }
    return value;
  }
  function kindOf(value) {
    const name = str(value).toLowerCase();
    return /sigon/.test(name) ? "sigon" : /sogon/.test(name) ? "sogon" : /档案馆|archive/.test(name) ? "archive" : null;
  }
  function template(value) {
    if (!value || !Array.isArray(value.scaffold)) return null;
    return {
      scaffold: value.scaffold.map((part) => ({ role: role(part?.role), text: str(part?.text) })),
      specialIndex: Number.isInteger(value.specialIndex) ? clamp(value.specialIndex, 0, value.scaffold.length, 0) : null,
      specialRoleType: role(value.specialRoleType),
      historyDepth: clamp(value.historyDepth, 1, 200, 30),
      includeWorldInfo: value.includeWorldInfo === true
    };
  }
  function userPref(value) {
    return { enabled: value?.enabled === true, role: role(value?.role), text: str(value?.text), before: str(value?.before), after: str(value?.after),
      insertAt: Number.isInteger(value?.insertAt) ? Math.max(0, value.insertAt) : null };
  }
  function numericGen(value) {
    const out = dict();
    for (const key of ["temperature", "top_p", "top_k", "presence_penalty", "frequency_penalty"]) {
      if (own(value, key) && Number.isFinite(Number(value[key]))) out[key] = Number(value[key]);
    }
    return out;
  }
  function cleanConfig(value) {
    return { anchors: Array.isArray(value?.anchors) ? value.anchors.map(str) : [],
      blockTags: Array.isArray(value?.blockTags) ? value.blockTags.map(str) : [], stripComments: value?.stripComments === true };
  }
  function tagList(value) {
    const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，\n]/) : [];
    return [...new Set(list.map(str).map((s) => s.trim()).filter(Boolean))];
  }
  function taskConfig(value) {
    const out = {
      tpl: template(value?.tpl), tplRaw: template(value?.tplRaw), clean: cleanConfig(value?.clean), gen: numericGen(value?.gen),
      extractRegex: str(value?.extractRegex) || DEFAULT_REGEX, userPref: userPref(value?.userPref),
      autoEnabled: value?.autoEnabled === true, outputWhitelist: tagList(value?.outputWhitelist), expectedTags: tagList(value?.expectedTags),
      finalTag: str(value?.finalTag), continuation: {
        expectedTags: tagList(value?.continuation?.expectedTags), maxRounds: clamp(value?.continuation?.maxRounds, 1, 4, 3),
        finalTag: str(value?.continuation?.finalTag), contextChars: Math.max(0, finite(value?.continuation?.contextChars, 0))
      }
    };
    // Only inert generation preferences survive. Endpoints, keys, scripts,
    // arbitrary extension objects and source worldbook bindings never survive.
    out.api = { provider: str(value?.api?.provider), model: str(value?.api?.model), enableNet: value?.api?.enableNet === true, stream: value?.api?.stream !== false };
    if (value?.archiveCall) {
      const source = value.archiveCall, entries = dict();
      const item = (entry) => ({ enabled: entry?.enabled !== false, position: str(entry?.position) || "atDepth", role: role(entry?.role || "system"),
        order: finite(entry?.order, 100), depth: clamp(entry?.depth, 0, 100, 2), probability: clamp(entry?.probability, 0, 100, 100) });
      for (const name of Object.keys(source.entries || {})) if (!["__proto__", "prototype", "constructor"].includes(name)) entries[name] = item(source.entries[name]);
      out.archiveCall = { enabled: source.enabled === true, autoSync: source.autoSync === true, bindCharacter: source.bindCharacter === true,
        defaultEntry: item(source.defaultEntry), entries };
    }
    return out;
  }
  function presentationReason(prompt) {
    const name = str(prompt.name), content = str(prompt.content), id = str(prompt.identifier);
    if (/\{\{\s*xbgetvar::/i.test(content)) return "";
    if (/自由创建前端|前端.*渲染/i.test(name) || /只输出[^\n]{0,80}(?:html网页|HTML网页)/i.test(content)) return "完整网页输出与聊天消息格式冲突";
    if (/时间框|时间栏|time\s*frame/i.test(name) || /<Time>/.test(content)) return "独立时间框与聊天消息格式冲突";
    if (/四个选项|4个选项|四个.*选项/.test(name) || /<small>[\s\S]*[1１]️⃣/.test(content)) return "需要原插件的选项渲染";
    if (/双语|英\s*&\s*汉|日\s*&\s*汉/.test(name)) return "双语附加输出与聊天消息格式冲突";
    if (/总结|前情提要/.test(name)) return "附加总结由独立任务提供";
    if (/cot|思维链|动态防标记|超强越狱|越狱/i.test(name) || /^ny_gemini_/.test(id) || /<thinking>/.test(content)) return "原插件的推理输出或适配节点不适用";
    return "";
  }
  function parsePreset(data, filename) {
    if (typeof data === "string") data = JSON.parse(data.replace(/^\uFEFF/, ""));
    if (!data || !Array.isArray(data.prompts)) throw new Error("预设必须包含 prompts 数组");
    const definitions = new Map();
    for (const p of data.prompts) if (p && typeof p === "object" && p.identifier != null) definitions.set(str(p.identifier), p);
    const orders = Array.isArray(data.prompt_order) ? data.prompt_order : [];
    const selected = orders.reduce((best, item) => Array.isArray(item?.order) && item.order.length > (best?.order?.length || 0) ? item : best, null);
    const prompts = [], seen = new Set(), warnings = [];
    const addPrompt = (p, id, enabled, unordered) => {
      if (!p || seen.has(id)) return;
      seen.add(id);
      const reason = presentationReason(p);
      prompts.push({ id, identifier: id, name: str(p.name) || id, role: role(p.role || "system"), content: str(p.content),
        sourceEnabled: enabled === true, nativeEnabled: !reason, reason, unordered: !!unordered });
    };
    if (selected) for (const entry of selected.order) {
      const id = str(entry?.identifier);
      if (definitions.has(id)) addPrompt(definitions.get(id), id, entry.enabled, false);
      else warnings.push("顺序中的提示词不存在：" + id);
    }
    for (const [id, p] of definitions) if (!seen.has(id) && str(p.content)) addPrompt(p, id, selected ? false : p.enabled !== false, !!selected);
    const tasks = dict(); let embeddedTaskCount = 0;
    for (const order of orders) for (const task of Array.isArray(order?.xiaobai_ext?.scheduledTasks) ? order.xiaobai_ext.scheduledTasks : []) {
      embeddedTaskCount++;
      const kind = kindOf(task?.name), source = task?.x?.LittleWhiteBox;
      if (!kind || !source || !template(source.tpl || source.tplRaw)) continue;
      tasks[kind] = { kind, name: str(task.name), interval: clamp(task.interval, 0, 10000, 0),
        floorType: ["all", "user", "llm"].includes(task.floorType) ? task.floorType : "all",
        triggerTiming: str(task.triggerTiming) || "any_message", sourceAutoEnabled: typeof source.autoEnabled === "boolean" ? source.autoEnabled : task.disabled !== true,
        config: taskConfig(source) };
    }
    const joinedNames = [str(filename), ...data.prompts.map((p) => str(p?.name)), ...Object.keys(tasks).map((k) => tasks[k].name)].join("\n");
    const family = /gemini/i.test(joinedNames) ? "gemini" : /claude/i.test(joinedNames) ? "claude" : "ny";
    const name = str(filename).replace(/\.json$/i, "") || "NY 预设";
    const disabled = prompts.filter((p) => p.reason).map((p) => ({ id: p.id, name: p.name, reason: p.reason, sourceEnabled: p.sourceEnabled }));
    return { version: 1, name, filename: str(filename), family, prompts, tasks, warnings, disabled,
      source: { promptCount: data.prompts.length, orderCount: selected?.order?.length || 0, characterId: selected?.character_id ?? null,
        embeddedTaskCount, regexCount: Array.isArray(data.extensions?.regex_scripts) ? data.extensions.regex_scripts.length : 0 } };
  }
  function defaults(pack) {
    const state = { enabled: false, promptOverrides: dict(), tasks: dict() };
    for (const kind of KINDS) if (pack?.tasks?.[kind]) {
      const source = pack.tasks[kind], config = source.config, tpl = config.tplRaw || config.tpl;
      state.tasks[kind] = { enabled: false, auto: false, prefs: { historyDepth: tpl?.historyDepth || 30,
        includeWorldInfo: tpl?.includeWorldInfo === true, interval: source.interval, userPref: copy(config.userPref) },
        result: null, lastRunFloor: 0 };
    }
    return state;
  }
  function taskState(state, kind) { return state?.tasks?.[kind] || state?.[kind] || {}; }
  function resultOf(state, kind) { return taskState(state, kind).result || state?.results?.[kind] || null; }
  function resultTags(result) {
    if (!result || typeof result !== "object") return dict();
    return result.tags && typeof result.tags === "object" ? result.tags : result;
  }
  function valueName(value) { return value && typeof value === "object" ? str(value.name || value.displayName) : str(value); }
  function messageText(message) {
    if (typeof message === "string") return message;
    const value = message?.content ?? message?.mes ?? message?.text ?? message?.message ?? "";
    if (Array.isArray(value)) return value.filter((p) => p?.type === "text").map((p) => str(p.text)).join("\n");
    return str(value);
  }
  function historyRows(context) { return Array.isArray(context?.history) ? context.history : Array.isArray(context?.chat) ? context.chat : []; }
  function isUser(message) { return message?.role === "user" || message?.is_user === true; }
  function historyText(context, depth, clean) {
    if (typeof context?.history === "string") return cleanText(context.history, clean);
    return historyRows(context).slice(-clamp(depth, 1, 200, 30)).map((message) => {
      const name = str(message?.name) || (isUser(message) ? valueName(context.user) || "USER" : valueName(context.char) || "ASSISTANT");
      return name + "：\n" + cleanText(messageText(message), clean);
    }).join("\n\n");
  }
  function variable(value, state) {
    const dot = value.indexOf("."), namespace = (dot < 0 ? value : value.slice(0, dot)).trim();
    const field = dot < 0 ? "All" : value.slice(dot + 1).trim() || "All", kind = kindOf(namespace);
    if (!kind || taskState(state, kind).enabled !== true) return "";
    const result = resultOf(state, kind), tags = resultTags(result);
    if (/^all$/i.test(field)) return str(result?.all ?? result?.All ?? result?.raw ?? tags.All);
    if (own(tags, field)) return str(tags[field]);
    const key = Object.keys(tags).find((k) => k.toLowerCase() === field.toLowerCase());
    return key ? str(tags[key]) : "";
  }
  function resolve(text, state, context, config) {
    const rows = historyRows(context), last = rows[rows.length - 1], lastUser = rows.slice().reverse().find(isUser);
    const values = {
      user: valueName(context?.user), char: valueName(context?.char), persona: str(context?.persona), description: str(context?.description),
      personality: str(context?.personality), scenario: str(context?.scenario), lastmessage: str(context?.lastMessage ?? messageText(last)),
      lastusermessage: str(context?.lastUserMessage ?? messageText(lastUser))
    };
    return str(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_all, token) => {
      if (/^xbgetvar::/i.test(token)) return variable(token.replace(/^xbgetvar::/i, "").trim(), state);
      return own(values, token.toLowerCase()) ? values[token.toLowerCase()] : "";
    }).replace(/\{\$history(\d{1,3})\}/gi, (_all, n) => historyText(context, n, config?.clean))
      .replace(/\{\$worldInfo\}/gi, () => str(context?.worldInfo ?? context?.worldinfo));
  }
  function escapeRegex(text) { return str(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function cleanText(text, config) {
    let result = str(text);
    if (!config) return result;
    for (const anchor of Array.isArray(config.anchors) ? config.anchors : []) {
      const at = anchor ? result.lastIndexOf(str(anchor)) : -1;
      if (at >= 0) result = result.slice(at + str(anchor).length);
    }
    if (config.stripComments) result = result.replace(/<!--[\s\S]*?-->/g, "");
    for (const tag of Array.isArray(config.blockTags) ? config.blockTags : []) {
      if (!/^[\w\u4e00-\u9fff-]+$/.test(str(tag))) continue;
      result = result.replace(new RegExp("<" + escapeRegex(tag) + "(?:\\s[^>]*?)?>[\\s\\S]*?<\\/" + escapeRegex(tag) + "\\s*>", "gi"), "");
    }
    return result;
  }
  function effectiveConfig(pack, kind, state) {
    const task = pack?.tasks?.[kind];
    if (!task) throw new Error("预设未包含此独立任务：" + kind);
    const config = copy(task.config), prefs = taskState(state, kind).prefs || {};
    if (prefs.gen) config.gen = { ...config.gen, ...numericGen(prefs.gen) };
    if (typeof prefs.extractRegex === "string") config.extractRegex = prefs.extractRegex;
    if (prefs.clean) config.clean = cleanConfig(prefs.clean);
    if (prefs.userPref) config.userPref = userPref({ ...config.userPref, ...prefs.userPref });
    if (prefs.expectedTags) config.expectedTags = tagList(prefs.expectedTags);
    if (prefs.outputWhitelist) config.outputWhitelist = tagList(prefs.outputWhitelist);
    if (prefs.continuation) config.continuation = { ...config.continuation, ...copy(prefs.continuation) };
    if (own(prefs, "maxRounds")) config.continuation.maxRounds = clamp(prefs.maxRounds, 1, 4, 3);
    const tpl = copy(config.tplRaw || config.tpl);
    if (!tpl) throw new Error("任务缺少可用的提示词模板");
    if (own(prefs, "historyDepth")) tpl.historyDepth = clamp(prefs.historyDepth, 1, 200, tpl.historyDepth);
    if (own(prefs, "includeWorldInfo")) tpl.includeWorldInfo = prefs.includeWorldInfo === true;
    config.tpl = tpl;
    return config;
  }
  function expectedFor(kind, config) {
    return tagList(config?.continuation?.expectedTags).length ? tagList(config.continuation.expectedTags) :
      tagList(config?.expectedTags).length ? tagList(config.expectedTags) :
      kind === "archive" && tagList(config?.outputWhitelist).length ? tagList(config.outputWhitelist) : TAGS[kind].slice();
  }
  function taskPrompt(pack, taskKind, state, context) {
    const kind = kindOf(taskKind) || taskKind;
    if (!KINDS.includes(kind)) throw new Error("未知任务：" + str(taskKind));
    context ||= {}; state ||= {};
    const config = effectiveConfig(pack, kind, state), tpl = config.tpl, pieces = tpl.scaffold.map((p) => ({ role: p.role, content: p.text }));
    if (Number.isInteger(tpl.specialIndex)) pieces.splice(tpl.specialIndex, 0, { role: tpl.specialRoleType,
      content: (tpl.includeWorldInfo ? "{$worldInfo}\n\n" : "") + "{$history" + tpl.historyDepth + "}" });
    const pref = config.userPref;
    if (pref.enabled && pref.text.trim() && config.tplRaw) {
      const at = Number.isInteger(pref.insertAt) ? Math.min(pref.insertAt, pieces.length) : pieces.length;
      pieces.splice(at, 0, { role: pref.role, content: [pref.before, pref.text, pref.after].filter(Boolean).join("\n") });
    }
    const messages = pieces.map((p) => ({ role: p.role, content: resolve(p.content, state, context, config) })).filter((p) => p.content.trim());
    return { messages, config, expectedTags: expectedFor(kind, config), maxRounds: clamp(config.continuation.maxRounds, 1, kind === "archive" ? 4 : 3, 3),
      finalTag: str(config.continuation.finalTag || config.finalTag) || (kind === "sogon" ? "关系进展" : "") };
  }
  function extractionFormat(source, warnings) {
    // Known paired-tag grammars use a linear scanner. Arbitrary imported regex
    // never runs on model output, preventing catastrophic regex backtracking.
    let pattern = str(source) || DEFAULT_REGEX, flags = "g";
    if (pattern[0] === "/") {
      const end = pattern.lastIndexOf("/");
      if (end > 0) { flags = pattern.slice(end + 1); pattern = pattern.slice(1, end); }
    }
    const normalized = pattern.replace(/\\\//g, "/");
    const brackets = [
      "\\[([^\\s\\[\\]/]+)(?:\\s[^\\[\\]]*?)?\\]([\\s\\S]*?)\\[/\\1\\]",
      "\\[([^\\]\\s/]+)\\]([\\s\\S]*?)\\[/\\1\\]",
      "\\[([^\\]]+)\\]([\\s\\S]*?)\\[/\\1\\]",
      "\\[(\\w+)\\]([\\s\\S]*?)\\[/\\1\\]"
    ];
    const xml = ["<([^\\s<>/]+)>([\\s\\S]*?)</\\1>", "<([^<>]+)>([\\s\\S]*?)</\\1>", "<(\\w+)>([\\s\\S]*?)</\\1>"];
    if (/^[gimsu]*$/.test(flags) && new Set(flags).size === flags.length) {
      if (brackets.includes(normalized)) return { open: "[", close: "]", insensitive: flags.includes("i") };
      if (xml.includes(normalized)) return { open: "<", close: ">", insensitive: flags.includes("i") };
    }
    warnings.push("提取正则不属于支持的安全配对标签格式，已使用默认方括号标签解析");
    return { open: "[", close: "]", insensitive: false };
  }
  function extractTags(text, format) {
    const stacks = new Map(), found = [], tags = dict(); let offset = 0;
    while (offset < text.length) {
      const start = text.indexOf(format.open, offset);
      if (start < 0) break;
      const end = text.indexOf(format.close, start + 1);
      if (end < 0) break;
      offset = end + 1;
      const inner = text.slice(start + 1, end), match = /^\s*(\/)?([^\s\[\]<>\/]+)(?:\s[^\[\]<>]*)?$/.exec(inner);
      if (!match) continue;
      const name = match[2], key = format.insensitive ? name.toLowerCase() : name;
      if (!match[1]) {
        if (!stacks.has(key)) stacks.set(key, []);
        stacks.get(key).push({ name, start, contentStart: end + 1 });
      } else {
        const opening = stacks.get(key)?.pop();
        if (opening) found.push({ name: opening.name, start: opening.start, text: text.slice(opening.contentStart, start) });
      }
    }
    found.sort((a, b) => a.start - b.start);
    for (const item of found) tags[item.name] = item.text;
    return tags;
  }
  function applyResult(taskKind, raw, previous, suppliedConfig) {
    const kind = kindOf(taskKind) || taskKind;
    if (!KINDS.includes(kind)) throw new Error("未知任务：" + str(taskKind));
    const config = suppliedConfig?.config || suppliedConfig || {}, warnings = [], source = str(raw), format = extractionFormat(config.extractRegex, warnings);
    let cleaned = cleanText(source, config.clean).trim();
    const fence = /^```(?:[\w-]+)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(cleaned);
    if (fence) cleaned = fence[1];
    const extracted = extractTags(cleaned, format), tags = dict(), staleTags = [], expected = expectedFor(kind, config), prior = resultTags(previous);
    for (const name of Object.keys(extracted)) if (str(extracted[name]).trim()) {
      const canonical = format.insensitive ? expected.find((tag) => tag.toLowerCase() === name.toLowerCase()) || name : name;
      tags[canonical] = extracted[name];
    }
    const updatedTags = Object.keys(tags), missing = expected.filter((name) => !own(tags, name));
    if (kind === "archive") for (const name of Object.keys(prior)) {
      if (!["All", "all", "raw", "__TagStatus", "__proto__", "constructor", "prototype"].includes(name) && !own(tags, name) && typeof prior[name] === "string" && prior[name].trim()) {
        tags[name] = prior[name]; staleTags.push(name);
      }
    }
    const all = kind === "archive" ? [...expected, ...Object.keys(tags).filter((name) => !expected.includes(name))].filter((name) => own(tags, name))
      .map((name) => "[" + name + "]" + tags[name] + "[/" + name + "]").join("\n\n") : cleaned;
    return { raw: source, all, tags, complete: missing.length === 0, missing, staleTags, updatedTags, warnings };
  }
  function promptText(pack, state, context) {
    if (state?.enabled !== true) return "";
    context ||= {};
    const output = [], overrides = state.promptOverrides || {}, injected = new Set();
    for (const prompt of pack?.prompts || []) {
      if (!prompt.nativeEnabled || overrides[prompt.id] === false || !prompt.content) continue;
      const variableTokens = [...prompt.content.matchAll(/\{\{\s*xbgetvar::([^{}]+?)\s*\}\}/gi)].map((m) => m[1]);
      if (variableTokens.length) {
        if (!variableTokens.some((v) => variable(v, state).trim())) continue;
        const resolved = resolve(prompt.content, state, context);
        if (resolved.trim() && !injected.has(resolved)) { output.push(resolved); injected.add(resolved); }
      } else if ((own(overrides, prompt.id) ? overrides[prompt.id] === true : prompt.sourceEnabled)) {
        const resolved = resolve(prompt.content, state, context);
        if (resolved.trim()) output.push(resolved);
      }
    }
    return output.join("\n\n");
  }
  return Object.freeze({ parsePreset, defaults, taskPrompt, applyResult, promptText });
});
