(function () {
  "use strict";
  const core = window.EPhoneNyCore, kinds = ["sigon", "sogon", "archive"], labels = { sigon: "Sigon · 偏好与文风", sogon: "Sogon · 人设与关系", archive: "档案馆 · 背景世界书" };
  const clone = (v) => structuredClone(v), esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&#39;" })[c]);
  const runs = new Map(); let screen, selectedChat = "", selectedKind = "sigon", notice = "", viewToken = 0;
  const database = () => window.db.spaceProfiles.db;
  const archiveId = (db, chatId) => "ny-archive:" + encodeURIComponent(db.name) + ":" + chatId;
  const hash = (value) => { let h = 2166136261; for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(16); };
  const validHistory = (chat) => (chat.history || []).filter((m) => !m.isHidden && m.type !== "thought_chain");
  const stamp = (row) => hash(JSON.stringify([row.role, row.type, row.content, row.senderName, row.vts]));
  const matches = (result, chat) => !result?.basis || result.basis.every((b) => (chat.history || []).some((r) => String(r.timestamp) === b.id && stamp(r) === b.hash));
  const packs = (db) => db.spaceProfiles.filter((r) => r.kind === "ny-pack").toArray();
  async function getState(chatId, db = database()) {
    return await db.spaceProfiles.get("ny:chat:" + chatId) || { id: "ny:chat:" + chatId, chatId, packId: "auto", enabled: false, tasks: {} };
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
    return imported.length === 1 ? imported[0] : imported;
  }
  async function configure(chatId, patch, db = database()) {
    if (!await db.chats.get(chatId)) throw new Error("聊天已移走或删除。");
    if ([...runs.values()].some((r) => r.db === db && r.chatId === chatId)) throw new Error("请先停止本聊天的分析，再修改设置。");
    const old = await getState(chatId, db), packChanged = patch.packId && patch.packId !== old.packId;
    const next = { ...old, ...patch, id: old.id, chatId, tasks: packChanged ? {} : clone(old.tasks || {}) };
    for (const kind of kinds) if (patch.tasks?.[kind]) {
      next.tasks[kind] = { ...(next.tasks[kind] || {}), ...clone(patch.tasks[kind]),
        prefs: { ...(next.tasks[kind]?.prefs || {}), ...(patch.tasks[kind].prefs || {}) } };
      if (next.tasks[kind].auto && !old.tasks?.[kind]?.auto) next.tasks[kind].autoEnabledAt = Date.now();
    }
    await db.spaceProfiles.put(next); await syncArchive(db, chatId, next); return next;
  }
  async function selectPack(id) {
    if (!selectedChat) return;
    const old = await getState(selectedChat);
    if (old.packId === id && Object.keys(old.tasks || {}).length) return old;
    const pack = id === "auto" ? await activePack({ packId: "auto" }, database()) : await database().spaceProfiles.get(id);
    if (!pack) throw new Error("请先导入预设。");
    const initial = core.defaults(pack); initial.enabled = true;
    for (const kind of kinds) initial.tasks[kind] = { ...initial.tasks[kind], enabled: !!pack.tasks[kind], auto: false, interval: pack.tasks[kind]?.interval || 20 };
    return configure(selectedChat, { ...initial, packId: id, enabled: old.enabled || true });
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
    for (const kind of kinds) if (effective.tasks?.[kind]?.result && !matches(effective.tasks[kind].result, chat)) effective.tasks[kind].result = null;
    let text = core.promptText(pack, effective, await contextFor(chat, db));
    // The archive is a real editable worldbook, read through this chat-bound
    // path rather than globally binding it to a character or leaking stale
    // contents through the ordinary book renderer after deleting source chat.
    if (effective.tasks?.archive?.enabled && effective.tasks.archive.result) {
      const book = await window.db.worldBooks.get(archiveId(db, chat.id));
      if (book?.nyChatId === chat.id && book.nyDatabase === db.name) text += "\n# 本聊天的 NY 档案馆世界书\n" + (book.content || []).filter((r) => r.enabled !== false).map((r) => r.comment + "\n" + r.content).join("\n\n");
    }
    return text ? "\n# 本聊天的 NY 叙事预设与分析资料\n" + text + "\n# 小手机输出约定\n上面的预设只控制人设、文风和剧情，不改变本应用的消息协议。仍须只输出原规定的 JSON 消息数组，每轮第一条是当前虚拟时间地点旁白，台词 text 与动作 narration 分开。不得输出整页 HTML、思维链、重复时间框或额外总结；不得改写账本余额、支付状态、已有关系与当前时间。分析资料中每人的私有心理和经历不等于其他角色已经知情；观看模式继续按所选角色身份和当前场景推进。\n" : "";
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
      for (const item of kinds) if (effective.tasks?.[item]?.result && !matches(effective.tasks[item].result, chat)) effective.tasks[item].result = null;
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
      await db.transaction("rw", db.spaceProfiles, db.chats, async () => {
        controller.signal.throwIfAborted(); const freshChat = await db.chats.get(chatId), fresh = await getState(chatId, db);
        if (!freshChat || !matches(result, freshChat)) throw new Error("分析期间相关聊天已修改或删除，本次结果未覆盖旧报告。");
        if (fresh.packId !== state.packId || JSON.stringify(fresh.tasks?.[kind]?.prefs) !== JSON.stringify(state.tasks[kind].prefs)) throw new Error("分析设置已变化，本次结果未写入。");
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
  function stop(kind, chatId) { for (const ticket of runs.values()) if ((!kind || ticket.kind === kind) && (!chatId || ticket.chatId === chatId)) ticket.controller.abort(); }
  async function afterReply(chatId) {
    const finishedAt = Date.now();
    const db = database(), state = await getState(chatId, db); if (!state.enabled) return;
    const chat = await db.chats.get(chatId); if (!chat) return;
    const count = validHistory(chat).length, last = validHistory(chat).at(-1)?.timestamp;
    await Promise.all(kinds.map(async (kind) => {
      const task = state.tasks?.[kind];
      if (!task?.enabled || !task.auto || task.autoEnabledAt > finishedAt || task.lastRound === last || count - (task.lastCount || 0) < Math.max(1, Number(task.interval) || 20)) return;
      try { await run(kind, chatId); } catch (e) {
        if (e.name !== "AbortError") {
          console.warn("NY 自动分析保留原报告：", e.message);
          await db.transaction("rw", db.spaceProfiles, async () => { const fresh = await getState(chatId, db); if (fresh.tasks?.[kind]) { fresh.tasks[kind].lastError = e.message; await db.spaceProfiles.put(fresh); } });
        }
      }
    }));
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
    screen.innerHTML = '<header class="header"><button id="ny-back" type="button">‹</button><span>NY 预设与叙事引擎</span><button id="ny-import" type="button">导入</button></header><div class="ny-scroll"><input id="ny-file" type="file" accept=".json,application/json" multiple hidden><div id="ny-notice" role="status"></div><label>当前聊天<select id="ny-chat"></select></label><label>回复预设<select id="ny-pack"></select></label><div id="ny-body"></div></div>';
    document.getElementById("phone-screen").append(screen);
    screen.querySelector("#ny-back").onclick = () => { window.showScreen("chat-list-screen"); document.querySelector('.nav-item[data-view="me-view"]')?.click(); };
    screen.querySelector("#ny-import").onclick = () => screen.querySelector("#ny-file").click();
    screen.querySelector("#ny-file").onchange = async (e) => action(async () => {
      let names = []; for (const file of e.target.files) {
        if (file.size > 20 * 1024 * 1024) throw new Error("预设文件超过20MB，请检查文件。");
        const imported = await importPreset(JSON.parse(await file.text()), file.name); names.push(...(Array.isArray(imported) ? imported : [imported]).map((p) => p.name));
      }
      e.target.value = ""; if (selectedChat) await selectPack("auto"); notice = "已导入 " + names.join("、") + "。三项分析可手动运行；自动分析默认关闭。";
    });
    screen.querySelector("#ny-chat").onchange = async (e) => { selectedChat = e.target.value; notice = ""; await render(); };
    screen.querySelector("#ny-pack").onchange = async (e) => action(async () => { await selectPack(e.target.value); notice = "预设已切换，分析报告按当前聊天保存；请重新运行所需分析。"; });
    screen.addEventListener("click", async (e) => {
      if (e.target.id === "ny-save") await action(saveForm);
      if (e.target.id === "ny-stop") { stop(selectedKind, selectedChat); notice = "已停止；尚未完成的结果不会覆盖原报告。"; }
      if (e.target.id === "ny-run") {
        const kind = selectedKind, chatId = selectedChat;
        await action(async () => { await saveForm(); const result = await run(kind, chatId); notice = result.complete ? `分析完成，使用副 API ${result.requests} 次。` : "已保存有效部分，缺失标签保留旧内容；可再次分析。"; });
      }
      if (e.target.id === "ny-save-report") await action(async () => { const tags = Object.fromEntries([...screen.querySelectorAll("[data-ny-tag]")].map((el) => [el.dataset.nyTag, el.value])); await saveReport(selectedChat, selectedKind, tags); notice = "报告已保存，下一次回复会读取修改后的内容。"; });
    });
    screen.addEventListener("change", async (e) => { if (e.target.id === "ny-kind" && selectedKind !== e.target.value) { selectedKind = e.target.value; await render(); } });
  }
  async function action(fn) { try { await fn(); } catch (e) { notice = e.name === "AbortError" ? "已停止，原报告保留。" : e.message; } finally { await render(); } }
  async function saveForm() {
    if (!selectedChat) throw new Error("请先选择聊天。");
    // Snapshot the clicked form before awaiting IndexedDB. A report completion
    // may rebuild the panel while settings are saving.
    const db = database(), chatId = selectedChat, kind = selectedKind, v = (id) => screen.querySelector("#" + id);
    const form = { enabled: v("ny-enabled").checked, taskEnabled: v("ny-task-enabled").checked,
      auto: v("ny-auto").checked, interval: Math.max(1, Number(v("ny-interval").value) || 20),
      depth: Math.max(1, Number(v("ny-depth").value) || 30), pref: v("ny-prefs").value };
    const promptOverrides = Object.fromEntries([...screen.querySelectorAll("[data-ny-prompt]")].map((el) => [el.dataset.nyPrompt, el.checked]));
    const state = await getState(chatId, db), old = state.tasks?.[kind] || {};
    await configure(chatId, { enabled: form.enabled, promptOverrides, tasks: { [kind]: { ...old,
      enabled: form.taskEnabled, auto: form.auto, interval: form.interval,
      prefs: { ...old.prefs, historyDepth: form.depth, userPref: { enabled: !!form.pref.trim(), text: form.pref } } } } }, db);
    notice = "设置已保存；分析使用副 API，聊天回复仍只请求主 API 一次。";
  }
  async function render() {
    if (!screen) return; const token = ++viewToken, db = database();
    const [available, chats] = await Promise.all([packs(db), db.chats.toArray()]);
    if (token !== viewToken) return;
    if (!chats.some((c) => c.id === selectedChat)) selectedChat = chats[0]?.id || "";
    const state = await getState(selectedChat, db), pack = await activePack(state, db), task = state.tasks?.[selectedKind] || {}, busy = [...runs.values()].some((r) => r.db === db && r.chatId === selectedChat && r.kind === selectedKind);
    if (token !== viewToken || db !== database()) return;
    const choices = (rows, value) => rows.map(([id, name]) => `<option value="${esc(id)}" ${id === value ? "selected" : ""}>${esc(name)}</option>`).join("");
    screen.querySelector("#ny-chat").innerHTML = choices(chats.map((c) => [c.id, c.name]), selectedChat);
    screen.querySelector("#ny-pack").innerHTML = choices([["auto", "按主 API 模型选择 Claude / Gemini"], ...available.map((p) => [p.id, p.name])], state.packId || "auto");
    screen.querySelector("#ny-notice").textContent = notice;
    screen.querySelector("#ny-body").innerHTML = !pack ? '<p>导入作者的 Claude / Gemini JSON 或本地合并包。文件只保存在浏览器内，不会上传到 GitHub；无需安装酒馆。</p>' :
      `<section><strong>${esc(pack.name)}</strong><p>已接入三项分析的原提示词模板。自动分析默认关闭；每项可单独运行、停止及编辑结果。报告属于当前空间和当前聊天。</p><label><input id="ny-enabled" type="checkbox" ${state.enabled ? "checked" : ""}>本聊天启用 NY 预设</label><label>分析功能<select id="ny-kind">${choices(kinds.map((k) => [k, labels[k]]), selectedKind)}</select></label><label><input id="ny-task-enabled" type="checkbox" ${task.enabled ? "checked" : ""}>读取此功能的分析结果</label><label><input id="ny-auto" type="checkbox" ${task.auto ? "checked" : ""}>回复后按间隔自动分析</label><label>间隔（消息条数）<input id="ny-interval" type="number" min="1" value="${esc(task.interval || pack.tasks[selectedKind]?.interval || 20)}"></label><label>分析最近多少条消息<input id="ny-depth" type="number" min="1" max="200" value="${esc(task.prefs?.historyDepth || pack.tasks[selectedKind]?.config?.tpl?.historyDepth || 30)}"></label><label>剧情 / 分析偏好<textarea id="ny-prefs" rows="3">${esc(task.prefs?.userPref?.text || "")}</textarea></label><div class="ny-actions"><button id="ny-save" type="button" ${busy ? "disabled" : ""}>保存设置</button><button id="ny-run" type="button" ${busy ? "disabled" : ""}>单次分析</button><button id="ny-stop" type="button" ${busy ? "" : "disabled"}>停止</button></div></section>` +
      `<section><h3>分析报告 ${busy ? "· 正在生成" : ""}</h3>${task.lastError ? `<p>上次自动分析未完成，原报告保留：${esc(task.lastError)}</p>` : ""}${task.result ? Object.entries(task.result.tags || {}).map(([tag, text]) => `<label>${esc(tag)}<textarea data-ny-tag="${esc(tag)}" rows="5">${esc(text)}</textarea></label>`).join("") + '<button id="ny-save-report" type="button">保存报告修改</button>' : "<p>尚未生成。单次分析会调用副 API；打开此页面不会自动调用。</p>"}</section><details><summary>预设条目开关</summary><p>文风等条目按原预设开关载入；相同类型尽量只开一种。分析结果条目还受对应引擎开关控制，未生成时不会注入空占位符。改完点击「保存设置」。</p>${pack.prompts.filter((p) => p.content).map((p) => {
        const value = Object.prototype.hasOwnProperty.call(state.promptOverrides || {}, p.id) ? state.promptOverrides[p.id] : p.sourceEnabled || /\{\{\s*xbgetvar::/i.test(p.content);
        return `<label><input type="checkbox" data-ny-prompt="${esc(p.id)}" ${p.nativeEnabled && value ? "checked" : ""} ${p.nativeEnabled ? "" : "disabled"}>${esc(p.name)}${p.reason ? `<small> · ${esc(p.reason)}</small>` : ""}</label>`;
      }).join("")}</details><details><summary>适配说明与未运行项目</summary><p>自由 HTML 前端、额外时间框、双语正文和思维链展示不参与小手机回复，避免破坏消息格式。Gemini 的酒馆传输补丁和任意脚本不会执行。原有记忆总结、时间机器、钱包与生图设置保持各自职责。</p>${(pack.warnings || []).map((w) => `<p>${esc(w)}</p>`).join("")}</details>`;
  }
  async function open(chatId) { create(); if (chatId) selectedChat = chatId; else if (!selectedChat) selectedChat = window.EPhoneNyAdapter?.currentChatId() || ""; window.showScreen("ny-engine-screen"); await render(); }
  window.EPhoneNY = { open, importPreset, selectPack, configure, getState, run, stop, prompt, afterReply, saveReport,
    getArchiveBook: (chatId) => window.db.worldBooks.get(archiveId(database(), chatId)), isBusy: () => runs.size > 0 };
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("me-ny-button")?.addEventListener("click", () => open());
    document.getElementById("chat-ny-button")?.addEventListener("click", () => open(window.EPhoneNyAdapter?.currentChatId()));
  });
})();
