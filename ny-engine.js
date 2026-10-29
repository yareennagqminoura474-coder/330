(function () {
  "use strict";
  const core = window.EPhoneNyCore, kinds = ["sigon", "sogon", "archive"], labels = { sigon: "Sigon · 偏好与文风", sogon: "Sogon · 人设与关系", archive: "档案馆 · 背景世界书" };
  const clone = (v) => structuredClone(v), esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c.charCodeAt(0) === 34 ? "&quot;" : "&#39;");
  const runs = new Map(), upgradedDatabases = new WeakSet(); let screen, selectedChat = "", selectedKind = "sigon", selectedScope = "space", notice = "", viewToken = 0;
  const database = () => window.db.spaceProfiles.db;
  const archiveId = (db, chatId) => "ny-archive:" + encodeURIComponent(db.name) + ":" + chatId;
  const hash = (value) => { let h = 2166136261; for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(16); };
  const validHistory = (chat) => (chat.history || []).filter((m) => !m.isHidden && m.type !== "thought_chain");
  const stamp = (row) => hash(JSON.stringify([row.role, row.type, row.content, row.senderName, row.vts]));
  const matches = (result, chat) => !result?.basis || result.basis.every((b) => (chat.history || []).some((r) => String(r.timestamp) === b.id && stamp(r) === b.hash));
  async function packs(db) {
    const available = await db.spaceProfiles.filter((r) => r.kind === "ny-pack").toArray();
    const old = available.filter((p) => p.adapterVersion !== 2);
    if (!old.length) { upgradedDatabases.add(db); return available; }
    const formerlyBlocked = new Map(old.map((p) => [p.id, new Set(p.prompts.filter((r) => r.nativeEnabled === false).map((r) => r.id))]));
    await db.transaction("rw", db.spaceProfiles, async () => {
      for (const pack of old) {
        const current = await db.spaceProfiles.get(pack.id);
        if (current && current.adapterVersion !== 2) await db.spaceProfiles.put(core.upgradePack(current));
      }
      for (const row of await db.spaceProfiles.filter((r) => r.id === "ny:defaults" || r.id.startsWith("ny:chat:")).toArray()) {
        let changed = false;
        const ids = row.packId && row.packId !== "auto" ? formerlyBlocked.get(row.packId) || [] : [...formerlyBlocked.values()].flatMap((set) => [...set]);
        for (const id of ids) if (row.promptOverrides?.[id] === false) { delete row.promptOverrides[id]; changed = true; }
        if (changed) { if (row.id === "ny:defaults") row.revision = (row.revision || 0) + 1; await db.spaceProfiles.put(row); }
      }
    });
    upgradedDatabases.add(db);
    return available.map((p) => p.adapterVersion === 2 ? p : core.upgradePack(p));
  }
  const runtimeKeys = ["result", "lastCount", "lastRound", "lastRunFloor", "lastError"];
  function settingsOnly(state) {
    const next = { enabled: state?.enabled === true, packId: state?.packId || "auto", promptOverrides: clone(state?.promptOverrides || {}), tasks: {} };
    for (const kind of kinds) if (state?.tasks?.[kind]) {
      const task = state.tasks[kind];
      next.tasks[kind] = { enabled: task.enabled === true, auto: task.auto === true, interval: Math.max(1, Number(task.interval) || 20), prefs: clone(task.prefs || {}) };
      if (task.autoEnabledAt != null) next.tasks[kind].autoEnabledAt = task.autoEnabledAt;
    }
    return next;
  }
  function mergeSettings(old, patch) {
    const next = { ...settingsOnly(old), ...settingsOnly({ ...old, ...patch }), tasks: clone(old?.tasks || {}) };
    for (const kind of kinds) if (patch.tasks?.[kind]) {
      next.tasks[kind] = { ...(next.tasks[kind] || {}), ...clone(patch.tasks[kind]), prefs: { ...(next.tasks[kind]?.prefs || {}), ...(patch.tasks[kind].prefs || {}) } };
      if (next.tasks[kind].auto && !old?.tasks?.[kind]?.auto) next.tasks[kind].autoEnabledAt = Date.now();
    }
    return settingsOnly(next);
  }
  async function getState(chatId, db = database()) {
    // Old checkboxes wrote false for forcibly blocked entries. Upgrade before
    // reading the effective settings, including the first reply after updating.
    if (!upgradedDatabases.has(db)) await packs(db);
    const [raw, savedDefaults] = await Promise.all([db.spaceProfiles.get("ny:chat:" + chatId), db.spaceProfiles.get("ny:defaults")]);
    const defaults = savedDefaults || await ensureDefaults(db, chatId);
    const mode = raw?.settingsMode === "custom" || !defaults && raw ? "custom" : "inherit";
    const cfg = settingsOnly(mode === "custom" ? raw : defaults);
    for (const kind of kinds) if (raw?.tasks?.[kind]) {
      cfg.tasks[kind] ||= {};
      for (const key of runtimeKeys) if (key in raw.tasks[kind]) cfg.tasks[kind][key] = clone(raw.tasks[kind][key]);
    }
    return { id: "ny:chat:" + chatId, chatId, ...cfg, settingsMode: mode, defaultsRevision: defaults?.revision || 0 };
  }
  async function ensureDefaults(db = database(), preferredChat = selectedChat) {
    let row = await db.spaceProfiles.get("ny:defaults"); if (row) return row;
    const available = await packs(db); if (!available.length) return null;
    const legacy = await db.spaceProfiles.filter((r) => r.id.startsWith("ny:chat:")).toArray();
    const seed = legacy.find((r) => r.chatId === preferredChat) || legacy.find((r) => r.enabled) || legacy[0];
    let cfg = seed ? settingsOnly(seed) : core.defaults(available[0]);
    if (!seed) {
      cfg.enabled = true; cfg.packId = "auto";
      for (const kind of kinds) cfg.tasks[kind] = { ...cfg.tasks[kind], enabled: !!available[0].tasks[kind], auto: false, interval: available[0].tasks[kind]?.interval || 20 };
    }
    return db.transaction("rw", db.spaceProfiles, async () => {
      row = await db.spaceProfiles.get("ny:defaults");
      if (!row) { row = { id: "ny:defaults", kind: "ny-defaults", revision: 1, ...settingsOnly(cfg) }; await db.spaceProfiles.put(row); }
      return row;
    });
  }
  async function configureDefaults(patch, db = database()) {
    await ensureDefaults(db);
    return db.transaction("rw", db.spaceProfiles, async () => {
      const old = await db.spaceProfiles.get("ny:defaults") || {};
      const next = { ...mergeSettings(old, patch), id: "ny:defaults", kind: "ny-defaults", revision: (old.revision || 0) + 1 };
      await db.spaceProfiles.put(next); return next;
    });
  }
  async function useDefaults(chatId, db = database()) {
    await ensureDefaults(db);
    await db.transaction("rw", db.spaceProfiles, db.chats, async () => {
      if (!await db.chats.get(chatId)) throw new Error("聊天已移走或删除。");
      const raw = await db.spaceProfiles.get("ny:chat:" + chatId) || { id: "ny:chat:" + chatId, chatId, tasks: {} };
      raw.settingsMode = "inherit"; await db.spaceProfiles.put(raw);
    });
    return getState(chatId, db);
  }
  async function activePack(state, db) {
    const available = await packs(db);
    if (state.packId && state.packId !== "auto") return available.find((p) => p.id === state.packId);
    const config = await window.db.apiConfig.get("main"), family = /gemini/i.test(config?.model || "") ? "gemini" : /claude/i.test(config?.model || "") ? "claude" : "";
    return available.find((p) => p.family === family) || available[0];
  }
  async function importPreset(data, filename = "NY.json") {
    const db = database(), sources = Array.isArray(data?.ephoneNySources) ? data.ephoneNySources : [{ filename, data }], imported = [];
    // Parse the complete import before writing anything; imported JS is data,
    // never executed, and no provider endpoints or credentials are adopted.
    const parsed = sources.map((item) => {
      const pack = core.parsePreset(item.data, item.filename || filename);
      return { ...pack, id: "ny:pack:" + hash(JSON.stringify(item.data)), kind: "ny-pack" };
    });
    await db.transaction("rw", db.spaceProfiles, async () => { for (const pack of parsed) { await db.spaceProfiles.put(pack); imported.push(pack); } });
    await ensureDefaults(db);
    return imported.length === 1 ? imported[0] : imported;
  }
  async function configure(chatId, patch, db = database()) {
    if (!await db.chats.get(chatId)) throw new Error("聊天已移走或删除。");
    if ([...runs.values()].some((r) => r.db === db && r.chatId === chatId)) throw new Error("请先停止本聊天的分析，再修改设置。");
    const old = await getState(chatId, db), packChanged = patch.packId && patch.packId !== old.packId;
    const next = { ...old, ...patch, id: old.id, chatId, settingsMode: "custom", tasks: packChanged ? {} : clone(old.tasks || {}) };
    for (const kind of kinds) if (patch.tasks?.[kind]) {
      next.tasks[kind] = { ...(next.tasks[kind] || {}), ...clone(patch.tasks[kind]),
        prefs: { ...(next.tasks[kind]?.prefs || {}), ...(patch.tasks[kind].prefs || {}) } };
      if (next.tasks[kind].auto && !old.tasks?.[kind]?.auto) next.tasks[kind].autoEnabledAt = Date.now();
    }
    await db.spaceProfiles.put(next); await syncArchive(db, chatId, next); return next;
  }
  async function selectPack(id) {
    const db = database(), scope = selectedScope, chatId = selectedChat, old = scope === "space" ? await ensureDefaults(db) : await getState(chatId, db);
    if (old.packId === id && Object.keys(old.tasks || {}).length) return old;
    const pack = id === "auto" ? await activePack({ packId: "auto" }, db) : await db.spaceProfiles.get(id);
    if (!pack) throw new Error("请先导入预设。");
    const initial = core.defaults(pack); initial.enabled = true;
    for (const kind of kinds) initial.tasks[kind] = { ...initial.tasks[kind], enabled: !!pack.tasks[kind], auto: false, interval: pack.tasks[kind]?.interval || 20 };
    return scope === "space" ? configureDefaults({ ...initial, packId: id }, db) : configure(chatId, { ...initial, packId: id }, db);
  }
  async function contextFor(chat, db) {
    const [all, npcs, binding] = await Promise.all([db.chats.toArray(), db.npcs.toArray(), db.spaceProfiles.get("player")]);
    const group = chat.isGroup || chat.isSpectatorGroup;
    const profiles = group ? window.ephoneGroupContext.buildContext({ chat, chats: Object.fromEntries(all.map((c) => [c.id, c])), npcs }).profiles : [];
    const player = binding && window.ephonePlayerIdentity.choices(all, npcs).find((p) => p.key === binding.key);
    const member = profiles.find((p) => p.originalName === player?.name);
    const user = player?.name || chat.settings?.myNickname || "我", persona = player?.persona || member?.persona || chat.settings?.myPersona || "";
    const description = group ? profiles.map((p) => p.originalName + "：" + p.persona).join("\n\n") : chat.settings?.aiPersona || "";
    const chosen = new Set((chat.settings?.linkedWorldBookIds || []).map(String));
    const books = await window.db.worldBooks.toArray();
    const worldInfo = books.filter((b) => chosen.has(String(b.id)) && !b.nyChatId).flatMap((b) => (b.content || []).filter((r) => r.enabled !== false).map((r) => r.content)).join("\n\n");
    const visible = validHistory(chat), describe = (row) => row ? window.ephoneGroupContext.describeMessage(chat, row, window.EPhoneMarketAdapter.formatTime) : "";
    return { user, char: group ? profiles.map((p) => p.originalName).join("、") : chat.originalName || chat.name,
      persona, description, personality: description, worldInfo,
      scenario: chat.settings?.scenario || chat.settings?.currentLocation || "",
      lastMessage: describe(visible.at(-1)), lastUserMessage: describe(visible.findLast((m) => m.role === "user" || m.sentAsCharacter)),
      history: visible.slice(-200).map((row) => ({ ...row, content: describe(row) })) };
  }
  async function prompt(chat) {
    const db = database(), state = await getState(chat.id, db);
    if (!state.enabled) return "";
    const pack = await activePack(state, db); if (!pack) return "";
    const effective = clone(state);
    for (const kind of kinds) if (effective.tasks?.[kind]?.result && (!matches(effective.tasks[kind].result, chat) || effective.tasks[kind].result.packId !== pack.id)) effective.tasks[kind].result = null;
    let text = core.promptText(pack, effective, await contextFor(chat, db));
    text += await window.EPhoneNYFeatures?.summaryContext(chat, { pack, state, features: core.features(pack, state) }, db) || "";
    // The archive is a real editable worldbook, read through this chat-bound
    // path rather than globally binding it to a character or leaking stale
    // contents through the ordinary book renderer after deleting source chat.
    if (effective.tasks?.archive?.enabled && effective.tasks.archive.result) {
      const book = await window.db.worldBooks.get(archiveId(db, chat.id));
      if (book?.nyChatId === chat.id && book.nyDatabase === db.name) text += "\n# 本聊天的 NY 档案馆世界书\n" + (book.content || []).filter((r) => r.enabled !== false).map((r) => r.comment + "\n" + r.content).join("\n\n");
    }
    return text ? "\n# 本聊天的 NY 叙事预设与分析资料\n" + text + "\n# 小手机输出约定\n只输出 JSON 消息数组，每轮第一条是当前虚拟时间地点旁白，台词 text 与动作 narration 分开。已开启的互动界面、选项和双语功能写入末尾已有消息的 ny_extra 字段，优先使用旁白；完整正文不能省略，也不要创建空白消息。总结交给副 API，不要求展示详细思维链。不改写账本余额、支付状态和当前时间。分析资料中每人的私有经历不等于其他角色已经知情。\n" : "";
  }
  async function configuration(chatId, db = database()) {
    await packs(db);
    const state = await getState(chatId, db), pack = await activePack(state, db);
    return pack ? { pack, state, features: core.features(pack, state) } : null;
  }
  async function syncArchive(db, chatId, state) {
    const books = window.db.worldBooks, tags = state.tasks?.archive?.result?.tags, id = archiveId(db, chatId), old = await books.get(id);
    if (!tags && !old) return;
    let update;
    const chat = await db.chats.get(chatId); if (!chat) return;
    await books.db.transaction("rw", books, async () => {
      const enabled = !!(state.enabled && state.tasks?.archive?.enabled), book = tags ? { id, name: `NY-档案馆-${window.EPHONE_SPACE_NAME || db.name}-${chat.name}`, categoryId: old?.categoryId || null, nyChatId: chatId, nyDatabase: db.name,
        content: Object.entries(tags).map(([comment, content]) => ({ comment, content, keys: [], enabled })) } : { ...old, content: old.content.map((r) => ({ ...r, enabled })) };
      await books.put(book);
      update = { chatId, book };
    });
    if (db === database()) window.EPhoneNyAdapter?.refreshArchive(update);
  }
  async function run(kind, chatId = selectedChat) {
    if (!kinds.includes(kind)) throw new Error("未知分析任务。");
    const db = database(), key = db.name + ":" + chatId + ":" + kind;
    if (runs.has(key)) return runs.get(key).promise;
    const controller = new AbortController(), ticket = { db, chatId, kind, controller, count: 0 };
    const work = async () => {
      const state = await getState(chatId, db), pack = await activePack(state, db), chat = await db.chats.get(chatId);
      if (!chat || !pack) throw new Error("请先为这个聊天导入并选择 NY 预设。");
      if (!state.enabled || !state.tasks?.[kind]?.enabled) throw new Error("请先开启本聊天的预设和所选分析功能。");
      const effective = clone(state);
      for (const item of kinds) if (effective.tasks?.[item]?.result && (!matches(effective.tasks[item].result, chat) || effective.tasks[item].result.packId !== pack.id)) effective.tasks[item].result = null;
      const context = await contextFor(chat, db), request = core.taskPrompt(pack, kind, effective, context);
      const messages = clone(request.messages), prior = effective.tasks[kind].result;
      const depth = state.tasks[kind].prefs?.historyDepth || pack.tasks[kind]?.config?.tpl?.historyDepth || 30;
      const basis = [...new Map([...(prior?.basis || []), ...validHistory(chat).slice(-depth).map((r) => ({ id: String(r.timestamp), hash: stamp(r) }))].map((b) => [b.id, b])).values()];
      let accumulated = "", result;
      for (let round = 0; round < request.maxRounds; round++) {
        controller.signal.throwIfAborted(); ticket.count++;
        const raw = await window.EPhoneMarketAdapter.generateMessages(messages, controller.signal, request.config.gen);
        controller.signal.throwIfAborted();
        accumulated += (accumulated ? "\n" : "") + raw;
        result = core.applyResult(kind, accumulated, prior, request.config);
        if (result.complete) break;
        if (round + 1 < request.maxRounds) messages.push({ role: "assistant", content: raw }, { role: "user", content: "只补全以下缺失或未闭合标签，不重写已完成内容：" + result.missing.join("、") + "。继续使用原有配对标签格式。" });
      }
      if (!result?.updatedTags.length) throw new Error("没有识别到有效分析标签，原报告保留。");
      result = { ...result, basis, packId: pack.id, timestamp: Date.now(), vts: window.EPhoneMarketAdapter.now(chatId), requests: ticket.count };
      const finishState = await getState(chatId, db), finishPack = await activePack(finishState, db);
      if (finishPack?.id !== pack.id) throw new Error("使用的预设已切换，本次结果未覆盖旧报告。");
      await db.transaction("rw", db.spaceProfiles, db.chats, async () => {
        controller.signal.throwIfAborted(); const freshChat = await db.chats.get(chatId), fresh = await getState(chatId, db);
        if (!freshChat || !matches(result, freshChat)) throw new Error("分析期间相关聊天已修改或删除，本次结果未覆盖旧报告。");
        if (JSON.stringify(settingsOnly(fresh)) !== JSON.stringify(settingsOnly(state))) throw new Error("分析设置已变化，本次结果未写入。");
        fresh.tasks[kind] = { ...fresh.tasks[kind], result, lastError: "", lastCount: validHistory(chat).length, lastRound: validHistory(chat).at(-1)?.timestamp };
        await db.spaceProfiles.put(fresh);
      });
      try { await syncArchive(db, chatId, await getState(chatId, db)); }
      catch (error) { result.warnings.push("报告已保存，世界书尚待同步：" + error.message); }
      return result;
    };
    runs.set(key, ticket); ticket.promise = work().finally(() => { runs.delete(key); if (screen?.classList.contains("active")) render().catch(() => {}); });
    if (screen?.classList.contains("active")) render().catch(() => {});
    return ticket.promise;
  }
  function stop(kind, chatId) {
    for (const ticket of runs.values()) if ((!kind || ticket.kind === kind) && (!chatId || ticket.chatId === chatId)) ticket.controller.abort();
    if (!kind) window.EPhoneNYFeatures?.stop(chatId);
  }
  async function afterReply(chatId) {
    const finishedAt = Date.now();
    const db = database(), state = await getState(chatId, db); if (!state.enabled) return;
    const chat = await db.chats.get(chatId); if (!chat) return;
    const count = validHistory(chat).length, last = validHistory(chat).at(-1)?.timestamp;
    await Promise.all([window.EPhoneNYFeatures?.afterReply(chatId), ...kinds.map(async (kind) => {
      const task = state.tasks?.[kind];
      if (!task?.enabled || !task.auto || task.autoEnabledAt > finishedAt || task.lastRound === last || count - (task.lastCount || 0) < Math.max(1, Number(task.interval) || 20)) return;
      try { await run(kind, chatId); } catch (e) {
        if (e.name !== "AbortError") {
          console.warn("NY 自动分析保留原报告：", e.message);
          await db.transaction("rw", db.spaceProfiles, async () => { const fresh = await getState(chatId, db); if (fresh.tasks?.[kind]) { fresh.tasks[kind].lastError = e.message; await db.spaceProfiles.put(fresh); } });
        }
      }
    })]);
  }
  async function saveReport(chatId, kind, tags) {
    const db = database(); if ([...runs.values()].some((r) => r.db === db && r.chatId === chatId && r.kind === kind)) throw new Error("请先停止分析再编辑报告。");
    const state = await getState(chatId, db), old = state.tasks?.[kind]?.result;
    if (!old) throw new Error("还没有可编辑的报告。");
    state.tasks[kind].result = { ...old, tags: clone(tags), all: Object.entries(tags).map(([tag, text]) => `[${tag}]${text}[/${tag}]`).join("\n\n"), editedAt: Date.now() };
    await db.spaceProfiles.put(state); await syncArchive(db, chatId, state); return state;
  }
  function create() {
    if (screen) return;
    screen = document.createElement("section"); screen.id = "ny-engine-screen"; screen.className = "screen";
    screen.innerHTML = '<header class="header"><button id="ny-back" type="button">‹</button><span>NY 预设与叙事引擎</span><button id="ny-import" type="button">导入</button></header><div class="ny-scroll"><input id="ny-file" type="file" accept=".json,application/json" multiple hidden><div id="ny-notice" role="status"></div><label>设置范围<select id="ny-scope"><option value="space">空间统一设置（所有聊天默认使用）</option><option value="chat">本聊天单独设置</option></select></label><label>当前聊天<select id="ny-chat"></select></label><label>回复预设<select id="ny-pack"></select></label><div id="ny-body"></div></div>';
    document.getElementById("phone-screen").append(screen);
    screen.querySelector("#ny-back").onclick = () => { window.showScreen("chat-list-screen"); document.querySelector('.nav-item[data-view="me-view"]')?.click(); };
    screen.querySelector("#ny-import").onclick = () => screen.querySelector("#ny-file").click();
    screen.querySelector("#ny-file").onchange = async (e) => action(async () => {
      let names = []; for (const file of e.target.files) {
        if (file.size > 20 * 1024 * 1024) throw new Error("预设文件超过20MB，请检查文件。");
        const imported = await importPreset(JSON.parse(await file.text()), file.name); names.push(...(Array.isArray(imported) ? imported : [imported]).map((p) => p.name));
      }
      e.target.value = ""; notice = "已导入 " + names.join("、") + "。三项分析可手动运行；自动分析默认关闭。";
    });
    screen.querySelector("#ny-scope").onchange = async (e) => {
      selectedScope = e.target.value;
      // Prevent edits landing on the previous scope while the new settings are
      // being read. The rebuilt form restores the normal enabled controls.
      for (const el of screen.querySelectorAll("#ny-body input, #ny-body select, #ny-body textarea, #ny-body button")) el.disabled = true;
      if (selectedScope === "chat" && !selectedChat) { selectedScope = "space"; notice = "先选择聊天，再设置单独方案。"; await render(); return; }
      const db = database(), chatId = selectedChat;
      if (selectedScope === "chat") { const current = await getState(chatId, db); if (current.settingsMode !== "custom") await configure(chatId, settingsOnly(current), db); }
      await render();
    };
    screen.querySelector("#ny-chat").onchange = async (e) => { selectedChat = e.target.value; notice = ""; await render(); };
    screen.querySelector("#ny-pack").onchange = async (e) => action(async () => { await selectPack(e.target.value); notice = "预设已切换，分析报告按当前聊天保存；请重新运行所需分析。"; });
    screen.addEventListener("click", async (e) => {
      if (e.target.id === "ny-save") await action(saveForm);
      if (e.target.id === "ny-follow") await action(async () => { await useDefaults(selectedChat); selectedScope = "space"; notice = "本聊天已跟随空间统一设置，原有分析报告仍独立保留。"; });
      if (e.target.id === "ny-stop") { stop(selectedKind, selectedChat); notice = "已停止；尚未完成的结果不会覆盖原报告。"; }
      if (e.target.id === "ny-run") {
        const kind = selectedKind, chatId = selectedChat;
        await action(async () => { await saveForm(); const result = await run(kind, chatId); notice = result.complete ? `分析完成，使用副 API ${result.requests} 次。` : "已保存有效部分，缺失标签保留旧内容；可再次分析。"; });
      }
      if (e.target.id === "ny-save-report") await action(async () => { const tags = Object.fromEntries([...screen.querySelectorAll("[data-ny-tag]")].map((el) => [el.dataset.nyTag, el.value])); await saveReport(selectedChat, selectedKind, tags); notice = "报告已保存，下一次回复会读取修改后的内容。"; });
      if (e.target.id === "ny-save-summary") {
        const db = database(), chatId = selectedChat, content = screen.querySelector("#ny-summary-content")?.value || "";
        await action(async () => { await window.EPhoneNYFeatures.saveSummary(chatId, content, db); notice = "附加剧情总结已保存，后续回复会读取修改后的内容。"; });
      }
      if (e.target.id === "ny-summary-stop") {
        window.EPhoneNYFeatures?.stop(selectedChat); notice = "已停止附加剧情总结，原有内容保留。"; await render();
      }
    });
    screen.addEventListener("change", async (e) => {
      if (e.target.id === "ny-kind" && selectedKind !== e.target.value) { selectedKind = e.target.value; await render(); }
      if (e.target.id === "ny-mode") await action(async () => {
        const db = database(), chatId = selectedChat, mode = e.target.value, current = await getState(chatId, db);
        if (mode === "inherit") { await useDefaults(chatId, db); selectedScope = "space"; }
        else { if (current.settingsMode !== "custom") await configure(chatId, settingsOnly(current), db); selectedScope = "chat"; }
      });
    });
  }
  async function action(fn) { try { await fn(); } catch (e) { notice = e.name === "AbortError" ? "已停止，原报告保留。" : e.message; } finally { await render(); } }
  async function saveForm() {
    if (!selectedChat && selectedScope !== "space") throw new Error("请先选择聊天。");
    // Snapshot the clicked form before awaiting IndexedDB. A report completion
    // may rebuild the panel while settings are saving.
    const db = database(), chatId = selectedChat, kind = selectedKind, scope = selectedScope, v = (id) => screen.querySelector("#" + id);
    const form = { enabled: v("ny-enabled").checked, taskEnabled: v("ny-task-enabled").checked,
      auto: v("ny-auto").checked, interval: Math.max(1, Number(v("ny-interval").value) || 20),
      depth: Math.max(1, Number(v("ny-depth").value) || 30), pref: v("ny-prefs").value };
    const promptOverrides = Object.fromEntries([...screen.querySelectorAll("[data-ny-prompt]")].map((el) => [el.dataset.nyPrompt, el.checked]));
    const state = scope === "space" ? await ensureDefaults(db) : await getState(chatId, db), old = state.tasks?.[kind] || {};
    const patch = { enabled: form.enabled, promptOverrides, tasks: { [kind]: { ...old,
      enabled: form.taskEnabled, auto: form.auto, interval: form.interval,
      prefs: { ...old.prefs, historyDepth: form.depth, userPref: { enabled: !!form.pref.trim(), text: form.pref } } } } };
    if (scope === "space") await configureDefaults(patch, db); else await configure(chatId, patch, db);
    notice = scope === "space" ? "统一设置已保存；现有和新建聊天默认跟随，单独设置的聊天保留自己的配置。" : "本聊天设置已保存；其他聊天继续使用空间统一设置。";
  }
  async function render() {
    if (!screen) return; const token = ++viewToken, db = database();
    const [available, chats] = await Promise.all([packs(db), db.chats.toArray()]);
    if (token !== viewToken) return;
    if (!chats.some((c) => c.id === selectedChat)) selectedChat = chats[0]?.id || "";
    const chatState = await getState(selectedChat, db), state = selectedScope === "space" ? await ensureDefaults(db) || chatState : chatState,
      pack = await activePack(state, db), task = state.tasks?.[selectedKind] || {}, reportTask = chatState.tasks?.[selectedKind] || {}, busy = [...runs.values()].some((r) => r.db === db && r.chatId === selectedChat && r.kind === selectedKind);
    const summaryConfig = selectedChat ? await configuration(selectedChat, db) : null,
      featureSummary = selectedChat ? await window.EPhoneNYFeatures?.readSummary(selectedChat, db) : null,
      summaryBusy = !!selectedChat && !!window.EPhoneNYFeatures?.isBusy(selectedChat),
      hasSummary = !!summaryConfig?.features.summaries.length;
    if (token !== viewToken || db !== database()) return;
    const choices = (rows, value) => rows.map(([id, name]) => `<option value="${esc(id)}" ${id === value ? "selected" : ""}>${esc(name)}</option>`).join("");
    screen.querySelector("#ny-scope").value = selectedScope;
    screen.querySelector("#ny-chat").innerHTML = choices(chats.map((c) => [c.id, c.name]), selectedChat);
    screen.querySelector("#ny-pack").innerHTML = choices([["auto", "按主 API 模型选择 Claude / Gemini"], ...available.map((p) => [p.id, p.name])], state.packId || "auto");
    screen.querySelector("#ny-notice").textContent = notice;
    screen.querySelector("#ny-body").innerHTML = !pack ? '<p>导入作者的 Claude / Gemini JSON 或本地合并包。文件只保存在浏览器内，不会上传到 GitHub；无需安装酒馆。</p>' :
      `<section><strong>${esc(pack.name)}</strong><p>已接入三项分析的原提示词模板。自动分析默认关闭；每项可单独运行、停止及编辑结果。报告属于当前空间和当前聊天。</p><label><input id="ny-enabled" type="checkbox" ${state.enabled ? "checked" : ""}>${selectedScope === "space" ? "统一启用 NY 预设" : "本聊天启用 NY 预设"}</label><label>当前聊天使用的方案<select id="ny-mode"><option value="inherit" ${chatState.settingsMode !== "custom" ? "selected" : ""}>跟随空间统一设置</option><option value="custom" ${chatState.settingsMode === "custom" ? "selected" : ""}>本聊天单独设置</option></select></label><button id="ny-follow" type="button" ${chatState.settingsMode === "custom" ? "" : "disabled"}>跟随空间统一设置</button><label>分析功能<select id="ny-kind">${choices(kinds.map((k) => [k, labels[k]]), selectedKind)}</select></label><label><input id="ny-task-enabled" type="checkbox" ${task.enabled ? "checked" : ""}>读取此功能的分析结果</label><label><input id="ny-auto" type="checkbox" ${task.auto ? "checked" : ""}>回复后按间隔自动分析</label><label>间隔（消息条数）<input id="ny-interval" type="number" min="1" value="${esc(task.interval || pack.tasks[selectedKind]?.interval || 20)}"></label><label>分析最近多少条消息<input id="ny-depth" type="number" min="1" max="200" value="${esc(task.prefs?.historyDepth || pack.tasks[selectedKind]?.config?.tpl?.historyDepth || 30)}"></label><label>剧情 / 分析偏好<textarea id="ny-prefs" rows="3">${esc(task.prefs?.userPref?.text || "")}</textarea></label><div class="ny-actions"><button id="ny-save" type="button" ${busy ? "disabled" : ""}>保存设置</button><button id="ny-run" type="button" ${busy || !selectedChat || selectedScope === "space" && chatState.settingsMode === "custom" ? "disabled" : ""}>单次分析</button><button id="ny-stop" type="button" ${busy ? "" : "disabled"}>停止</button></div></section>` +
      `<section><h3>当前聊天的分析报告 ${busy ? "· 正在生成" : ""}</h3>${reportTask.lastError ? `<p>上次自动分析未完成，原报告保留：${esc(reportTask.lastError)}</p>` : ""}${reportTask.result ? Object.entries(reportTask.result.tags || {}).map(([tag, text]) => `<label>${esc(tag)}<textarea data-ny-tag="${esc(tag)}" rows="5">${esc(text)}</textarea></label>`).join("") + '<button id="ny-save-report" type="button">保存报告修改</button>' : "<p>尚未生成。单次分析会调用副 API；打开此页面不会自动调用。</p>"}</section>` +
      (hasSummary || featureSummary || summaryBusy ? `<section id="ny-feature-summary"><h3>当前聊天的附加剧情总结${summaryBusy ? " · 正在生成" : ""}</h3><p>开启「当前楼层总结」或「全篇总结」等预设条目后，每轮结束使用副 API 更新，和三项分析报告分别保存。</p>${featureSummary ? `<label>总结内容<textarea id="ny-summary-content" rows="7" ${summaryBusy || !featureSummary.valid ? "readonly" : ""}>${esc(featureSummary.content)}</textarea></label>${featureSummary.valid ? "" : '<p>此总结的预设已切换、功能已关闭或来源消息已改变，当前不会注入回复。原文保留供查看。</p>'}<button id="ny-save-summary" type="button" ${summaryBusy || !featureSummary.valid ? "disabled" : ""}>保存总结修改</button>` : '<p>尚未生成；开启总结条目并完成下一轮回复后更新。</p>'}<button id="ny-summary-stop" type="button" ${summaryBusy ? "" : "disabled"}>停止本次总结</button></section>` : "") +
      `<details><summary>预设条目开关</summary><p>文风等条目按原预设开关载入；相同类型尽量只开一种。分析结果条目还受对应引擎开关控制，未生成时不会注入空占位符。改完点击「保存设置」。</p>${pack.prompts.filter((p) => p.content).map((p) => {
        const value = Object.prototype.hasOwnProperty.call(state.promptOverrides || {}, p.id) ? state.promptOverrides[p.id] : p.sourceEnabled || /\{\{\s*xbgetvar::/i.test(p.content);
        return `<article class="ny-prompt-row"><label><input type="checkbox" data-ny-prompt="${esc(p.id)}" ${p.nativeEnabled && value ? "checked" : ""} ${p.nativeEnabled ? "" : "disabled"}>${esc(p.name)}${p.reason ? `<small> · ${esc(p.reason)}</small>` : ""}</label><details class="ny-prompt-details"><summary>查看完整内容</summary><p>${esc(p.adaptation?.note || "按原条目参与回复")}。是否启用由上方勾选控制。</p><pre><code data-ny-content="${esc(p.id)}">${esc(p.content)}</code></pre></details></article>`;
      }).join("")}</details><details><summary>原生适配方式</summary><p>界面在隔离卡片里显示，选项可填入聊天输入框，双语版本可展开阅读；时间框使用统一时钟。总结条目开启后，每轮结束会额外调用副 API，保存为聊天专属总结。思考类条目用于检查人设、衔接与重复，不展示详细思维链。</p>${(pack.warnings || []).map((w) => `<p>${esc(w)}</p>`).join("")}</details>`;
  }
  async function open(chatId) { create(); selectedScope = "space"; if (chatId) selectedChat = chatId; else if (!selectedChat) selectedChat = window.EPhoneNyAdapter?.currentChatId() || ""; window.showScreen("ny-engine-screen"); await render(); }
  window.EPhoneNY = { open, importPreset, selectPack, configure, configureDefaults, useDefaults, configuration, getDefaults: () => ensureDefaults(), getState, run, stop, prompt, afterReply, saveReport,
    getArchiveBook: (chatId) => window.db.worldBooks.get(archiveId(database(), chatId)), isBusy: () => runs.size > 0,
    refreshView: async () => { if (screen?.classList.contains("active")) await render(); } };
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("me-ny-button")?.addEventListener("click", () => open());
    document.getElementById("chat-ny-button")?.addEventListener("click", () => open(window.EPhoneNyAdapter?.currentChatId()));
  });
})();
