(function () {
  "use strict";
  const core = window.ephoneLifeSimulationCore, social = window.ephoneCharacterSocialCore;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const now = () => window.ephoneTimeMachine?.nowMs() ?? Date.now();
  const fmt = (v) => window.ephoneTimeMachine?.formatDateTime(v, { withWeekday: true }) || new Date(v).toLocaleString("zh-CN");
  const database = () => window.db?.lifeSimulation?.db;
  const labels = { active: "已确认", pending: "待确认", done: "已完成", cancelled: "已取消", due: "到期待核实", running: "进行中", deferred: "已推迟", scene: "待当前剧情衔接", saw: "亲眼看见", told: "被告知", guess: "仅猜测" };
  let screen, data, settings, selected = "", tab = "life", threadId = "", message = "", busy = false, mutating = false, controller, attemptReal = 0, formKind = "", formId = null;
  function hasDraft() {
    if (document.activeElement?.matches("input:not([type=checkbox]):not([type=radio]),textarea")) return true;
    if (!screen?.classList.contains("active")) return false;
    return Boolean(formKind || mutating || screen.contains(document.activeElement) && document.activeElement.matches("input,textarea,select") || screen.querySelector("#ls-text")?.value.trim() || screen.querySelector("#ls-auto")?.checked !== settings?.enabled || Number(screen.querySelector("#ls-interval")?.value) !== settings?.intervalMinutes);
  }
  const name = (key) => data?.people.find((p) => p.key === key)?.name || "已移走的人物";
  const button = (action, label, id = "") => `<button type="button" data-ls-action="${action}" data-id="${esc(id)}">${label}</button>`;
  function notify(content) {
    const entry = document.getElementById("me-life-simulation-button"); if (entry) entry.querySelector(".me-menu-label").textContent = "生活与主动联系 · " + content;
  }
  function toastElement() {
    let toast = document.getElementById("life-message-toast");
    if (!toast) {
      toast = document.createElement("aside"); toast.id = "life-message-toast"; toast.setAttribute("role", "status");
      toast.innerHTML = '<span></span><button type="button" data-view>查看</button><button type="button" data-stop>停止</button><button type="button" data-close>关闭</button>'; document.body.append(toast);
    }
    toast.querySelector("[data-stop]").onclick = () => controller?.abort();
    toast.querySelector("[data-close]").onclick = () => toast.hidden = true;
    return toast;
  }
  function workingToast(pair, people) {
    const toast = toastElement(); toast.hidden = false; toast.dataset.processing = "true";
    toast.querySelector("span").textContent = pair.map((key) => people.find((p) => p.key === key)?.name || "角色").join(" ↔ ") + " · 正在主动联系…";
    toast.querySelector("[data-stop]").hidden = false; toast.querySelector("[data-view]").hidden = true;
  }
  function messageToast(pair, count, people) {
    const toast = toastElement(); toast.dataset.processing = "false";
    const spaceName = database()?.name;
    toast.hidden = false;
    toast.querySelector("[data-stop]").hidden = true; toast.querySelector("[data-view]").hidden = false;
    toast.querySelector("span").textContent = pair.map((key) => people.find((p) => p.key === key)?.name || "角色").join(" ↔ ") + " · " + count + "条新私聊";
    toast.querySelector("[data-view]").onclick = async () => {
      if (window.isPersonaSpaceBusy?.()) return;
      if (database()?.name !== spaceName) { toast.hidden = true; return; }
      toast.hidden = true; await open(); selected = pair[0]; tab = "messages"; threadId = "thread:" + social.pairId(...pair); await refresh();
    };
  }
  async function sync(vts = now(), chat = null) {
    const db = database(); if (!db) return;
    const service = new core.Service(db);
    if (!chat) { const id = window.ephoneTimeMachine?.getActiveChatId?.(); if (id) chat = await db.table("chats").get(id); }
    const chats = await db.table("chats").toArray(), activeKeys = chat ? window.ephonePlayerIdentity.participants(chat, chats).map((p) => p.key) : [];
    await service.sync(vts, { activeKeys }); await service.releaseItineraries(vts, activeKeys);
    const rows = await service.table.toArray(), due = ["commitment", "rule"].flatMap((k) => core.visible(rows, k, vts)).filter((r) => core.taskStatus(r, vts) === "due").length;
    if (due) notify(due + "项约定到期");
  }
  async function generatePair(pair, { signal } = {}) {
    if (busy) throw new Error("请先完成或停止当前模拟。");
    const db = database(); if (!db) throw new Error("生活资料还在加载。");
    const service = new core.Service(db), vts = now(), ownController = new AbortController();
    const abort = () => ownController.abort(); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    busy = true; controller = ownController; message = "正在生成双方私下联系…"; render();
    const run = async () => {
      const context = await service.conversationContext(pair, vts), prompt = core.conversationPrompt(context), batchId = "batch:" + crypto.randomUUID();
      workingToast(pair, context.people);
      let reason = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        ownController.signal.throwIfAborted();
        const raw = await window.EPhoneMarketAdapter.generate(prompt + (reason ? "\n上一轮未保存：" + reason + "。请修正JSON后完整返回。" : ""), ownController.signal);
        ownController.signal.throwIfAborted();
        if (database() !== db) throw new Error("空间已切换，未保存上一空间的生成结果。");
        try {
          const count = await service.saveConversation(raw, context, batchId);
          message = count ? "已保存" + count + "条双方私聊，仅参与者获得记忆。" : "这轮暂无新的合理联系，未硬凑消息。";
          if (count) { notify("有新的角色私聊"); messageToast(pair, count, context.people); } return count;
        } catch (error) { if (attempt || error.code !== "LIFE_SIM_INVALID") throw error; reason = error.message; }
      }
    };
    try { return await (navigator.locks ? navigator.locks.request("ephone-life-pair:" + db.name + ":" + social.pairId(...pair), { signal: ownController.signal }, run) : run()); }
    catch (error) { message = error.name === "AbortError" ? "已停止，未保存本轮消息。" : "主动联系失败：" + error.message; throw error; }
    finally {
      signal?.removeEventListener("abort", abort); busy = false; controller = null;
      const toast = document.getElementById("life-message-toast");
      if (toast?.dataset.processing === "true") { toast.dataset.processing = "false"; toast.querySelector("[data-stop]").hidden = true; toast.querySelector("span").textContent = message; }
      if (screen?.classList.contains("active")) await refresh();
    }
  }
  async function proactiveTick() {
    if (!window.ephoneAppReady || window.isPersonaSpaceBusy?.() || hasDraft() || document.visibilityState === "hidden" || Date.now() - attemptReal < 30000) return;
    const db = database(); if (!db) return;
    const service = new core.Service(db), config = await service.settings(); if (!config.enabled) return;
    const vts = now(), snapshot = await service.snapshot(), pairs = service.eligible(snapshot, vts); if (!pairs.length) return;
    // One bounded conversation per space tick, not one request per NPC or missed hour.
    let selectedPair = null;
    await db.transaction("rw", service.table, async () => {
      const clock = await service.table.get("scheduler") || { id: "scheduler", kind: "scheduler", cursor: 0 };
      if (clock.lastAttempt != null && vts >= clock.lastAttempt && vts - clock.lastAttempt < config.intervalMinutes * 60000 || Date.now() - Number(clock.lastReal || 0) < 30000) return;
      const slot = "slot:" + Math.floor(vts / (config.intervalMinutes * 60000));
      if (await service.table.get(slot)) return;
      const due = ["commitment", "rule"].flatMap((k) => core.visible(snapshot.rows, k, vts)).filter((r) => core.taskStatus(r, vts) === "due");
      for (const row of due) {
        const reminderId = "reminder:" + row.id + ":" + row.due;
        if (await service.table.get(reminderId)) continue;
        const pair = pairs.find((p) => p.includes(row.key) && (!row.otherKey || p.includes(row.otherKey)));
        if (pair) { selectedPair = pair; await service.table.add({ id: reminderId, kind: "reminder", targetId: row.id, vts }); break; }
      }
      selectedPair ||= pairs[clock.cursor % pairs.length];
      await service.table.put({ ...clock, cursor: clock.cursor + 1, lastAttempt: vts, lastReal: Date.now() });
      await service.table.put({ id: slot, kind: "slot", vts, participants: selectedPair });
    });
    if (!selectedPair) return;
    attemptReal = Date.now();
    try { await generatePair(selectedPair); }
    catch (error) { notify(error.name === "AbortError" ? "主动联系已停止" : "主动联系失败，可手动重试"); }
  }
  function create() {
    if (screen) return;
    screen = document.createElement("section"); screen.id = "life-simulation-screen"; screen.className = "screen";
    screen.innerHTML = '<header class="header"><button id="ls-back" type="button">‹</button><span>生活与主动联系</span><button id="ls-stop" type="button">停止</button></header><div class="ls-scroll"><p id="ls-notice" role="status" aria-live="polite"></p><div id="ls-controls"></div><nav id="ls-tabs"></nav><div id="ls-content"></div><div id="ls-editor"></div></div>';
    document.getElementById("phone-screen").append(screen);
    screen.querySelector("#ls-back").onclick = () => { controller?.abort(); window.showScreen("chat-list-screen"); document.querySelector('.nav-item[data-view="me-view"]')?.click(); };
    screen.querySelector("#ls-stop").onclick = () => controller?.abort();
    screen.addEventListener("click", async (event) => { if (mutating) return; mutating = true; try { await handle(event); } catch (e) { message = e.name === "AbortError" ? "已停止，未保存本轮消息。" : e.message; render(); } finally { mutating = false; } });
    screen.addEventListener("change", (event) => {
      if (event.target.id === "ls-person" && !busy) { selected = event.target.value; formKind = ""; render(); }
      if (event.target.id === "ls-form-kind") updateFormVisibility();
    });
  }
  async function refresh() {
    if (!database()) return;
    const service = new core.Service(database()); [data, settings] = await Promise.all([service.snapshot(), service.settings()]);
    if (!data.people.some((p) => p.key === selected)) selected = data.people[0]?.key || "";
    render();
  }
  async function open() {
    if (window.isPersonaSpaceBusy?.()) { window.alert("请先完成或停止当前操作。"); return; }
    create(); formKind = ""; threadId = ""; message = ""; window.showScreen("life-simulation-screen"); await sync(); await refresh();
    notify("本空间独立生活");
  }
  function options(value, exclude) { return data.people.filter((p) => p.key !== exclude).map((p) => `<option value="${esc(p.key)}" ${p.key === value ? "selected" : ""}>${esc(p.label)}</option>`).join(""); }
  function recordHtml(row) {
    const due = core.taskStatus(row, now()), evidence = row.evidence ? `<details><summary>聊天依据</summary><p>${esc(row.evidence.quote)}</p></details>` : "";
    return `<article><strong>${esc(row.title || row.content)}</strong><small>${esc(name(row.key))}${row.otherKey ? " ↔ " + esc(name(row.otherKey)) : ""} · ${labels[due] || labels[row.certainty] || esc(due)}${row.due ? " · " + esc(fmt(row.due)) : ""}</small>${row.kind === "knowledge" ? `<small>${labels[row.certainty]}：只对本人知情；猜测不当事实。</small>` : ""}${evidence}<div>${row.status === "pending" ? button("confirm", "确认设定", row.id) : ""}${row.kind === "commitment" && !["done", "cancelled"].includes(row.status) ? button("done", "确认完成", row.id) : ""}${row.kind !== "state" ? button("edit-record", "编辑", row.id) : ""}${button("remove", "撤销这条", row.id)}</div></article>`;
  }
  function render() {
    if (!screen || !data) return;
    screen.querySelector("#ls-notice").textContent = message;
    screen.querySelector("#ls-stop").disabled = !busy;
    screen.querySelector("#ls-controls").innerHTML = `<section class="ls-card"><label><input id="ls-auto" type="checkbox" ${settings.enabled ? "checked" : ""}>开启本空间主动联系</label><label>联系间隔（空间分钟）<input id="ls-interval" type="number" min="10" max="240" value="${settings.intervalMinutes}"></label>${button("settings", "保存主动联系设置")}${button("simulate", "模拟一次主动联系")}<small>使用已保存API；开启后页面可见且空闲时自动运行，每次只推进一段联系。关闭网页不会后台调用；大跨度跳时不补刷大量消息。</small><small>当前空间时间：${esc(fmt(now()))}。私聊与临时事件为新生成的模拟生活，可查看，不能冒充之前的事实。</small></section><label>查看人物<select id="ls-person">${options(selected)}</select></label>`;
    screen.querySelector("#ls-tabs").innerHTML = [["life", "生活状态"], ["tasks", "约定与规矩"], ["knowledge", "知情记录"], ["messages", "私下消息"]].map(([key, label]) => `<button type="button" data-ls-tab="${key}" class="${tab === key ? "active" : ""}">${label}</button>`).join("");
    const vts = now(), service = new core.Service(database()), content = screen.querySelector("#ls-content");
    if (tab === "life") {
      const state = core.stateAt(data.rows, selected, vts, data.lives.find((l) => l.key === selected)), itinerary = service.itineraries(data, selected, vts);
      const events = core.visible(data.rows, "event", vts).filter((r) => r.participants.includes(selected)).slice(-12).reverse();
      const proposals = core.visible(data.rows, "scheduleProposal", vts).filter((r) => r.key === selected && r.status === "pending");
      content.innerHTML = `<section class="ls-card"><h3>${esc(name(selected))}的持续状态</h3><p>${state ? `疲劳：${state.fatigue}/100<br>情绪：${esc(state.mood)}<br>身体：${esc(state.health)}<br>${Object.entries(state.trustByPerson).map(([k, v]) => "对" + esc(name(k)) + "的信任：" + v + "/100").join("<br>")}` : "尚未设置；不会凭空推断身体或情绪问题。"}</p><small>疲劳会参考空间时间里的休息恢复；身体状况不自动清零，信任分对象保存。</small>${button("state", "设置/调整状态")}</section><section class="ls-card"><h3>当天行程执行</h3><small>在当前聊天场景中的人物先自然衔接；场外行程按空间时间模拟，不会改钱包或把约定直接判成完成。</small>${itinerary.map((r) => `<article><strong>${esc(r.title)}</strong><small>${esc(fmt(r.vts))} → ${esc(fmt(r.until))}<br>${esc(r.place)} · ${labels[r.progress]}</small>${r.reason ? `<p>${esc(r.reason)}</p>` : ""}${button("delay", "推迟30分钟", r.id)}${button("done", "确认完成", r.id)}</article>`).join("") || "<p>暂无已到点行程，可先到人物关系中生成当天行程。</p>"}</section><section class="ls-card"><h3>独立生活事件</h3>${events.map((r) => `<article><strong>${esc(r.title)}</strong><p>${esc(r.content)}</p><small>${esc(fmt(r.vts))} · 仅${r.participants.map(name).map(esc).join("、")}知情</small></article>`).join("") || "<p>暂无事件；主动联系时可自然产生邀请、工作求助等临时事件。</p>"}</section>`;
      content.innerHTML += proposals.map((r) => `<section class="ls-card"><h3>临时行程调整 · 待确认</h3><p>${esc(r.title)} → ${esc(r.date)} ${esc(r.start)}–${esc(r.end)}<br>${esc(r.reason)}</p><small>本人原话：${esc(r.quote)}。只在你确认后调整，不覆盖已修改或有冲突的安排。</small>${button("confirm-schedule", "确认调整当天行程", r.id)}${button("remove", "忽略建议", r.id)}</section>`).join("");
    } else if (tab === "tasks" || tab === "knowledge") {
      const kinds = tab === "tasks" ? ["commitment", "rule"] : ["knowledge"];
      const records = kinds.flatMap((k) => core.visible(data.rows, k, vts)).filter((r) => r.key === selected || tab === "tasks" && r.otherKey === selected).sort((a, b) => b.vts - a.vts);
      const reviews = core.visible(data.rows, "review", vts).filter((r) => r.key === selected && r.status === "pending");
      content.innerHTML = `<section class="ls-card"><h3>${tab === "tasks" ? "约定、待办与规矩" : "本人知情范围"}</h3>${button(tab === "tasks" ? "add-task" : "add-knowledge", "添加记录")}<small>${tab === "tasks" ? "聊天提取先待确认；到期只提醒核实，不等于违约。规矩不会自动加码。" : "区分亲眼看见、别人告知与猜测。作者查看不等于其他角色获知。"}</small>${records.map(recordHtml).join("") || "<p>还没有记录。</p>"}${reviews.map((r) => `<article><strong>聊天中的完成情况 · 待复核</strong><p>${esc(r.evidence?.quote)}</p>${button("review", "确认这次完成", r.id)}${button("remove", "忽略", r.id)}</article>`).join("")}</section>`;
    } else {
      const threads = core.visible(data.rows, "thread", vts).filter((r) => r.participants.includes(selected));
      const current = threads.find((r) => r.id === threadId), messages = current ? core.visible(data.rows, "message", vts).filter((r) => r.threadId === current.id).sort((a, b) => a.vts - b.vts || a.order - b.order) : [];
      content.innerHTML = `<section class="ls-card"><h3>角色之间的私下消息</h3><small>作者/观看视角可看所有会话；只有实际参与者获得相应记忆，其他角色不自动知情。</small><label>与谁建立联系人会话<select id="ls-contact">${options("", selected)}</select></label>${button("start-thread", "建立/打开会话")}<div>${threads.map((t) => button("thread", t.participants.map(name).map(esc).join(" ↔ "), t.id)).join("")}</div></section>${current ? `<section class="ls-card"><h3>${current.participants.map(name).map(esc).join(" ↔ ")}</h3>${messages.map((m) => `<article class="ls-message"><strong>${esc(name(m.from))} → ${esc(name(m.to))}</strong><p>${esc(m.content)}</p><small>${esc(fmt(m.vts))}${m.source === "simulated" ? " · 主动联系" : " · 以角色身份发送"}</small></article>`).join("") || "<p>还没有消息，可推进双方联系。</p>"}${button("continue-thread", "推进双方联系", current.id)}<label>以谁的身份发送<select id="ls-speaker">${current.participants.map((k) => `<option value="${esc(k)}">${esc(name(k))}</option>`).join("")}</select></label><textarea id="ls-text" rows="3" placeholder="角色实际发出的消息"></textarea>${button("send", "发送")}${button("send-continue", "发送并让对方接着回复")}</section>` : ""}`;
    }
    screen.querySelectorAll("[data-ls-action], [data-ls-tab], select").forEach((el) => el.disabled = busy);
    if (!formKind) screen.querySelector("#ls-editor").innerHTML = "";
  }
  function form(kind, row) {
    formKind = kind; formId = row?.id || null;
    const state = kind === "state" ? core.stateAt(data.rows, selected, now(), data.lives.find((l) => l.key === selected)) : null;
    row = row || state || {};
    const due = row.due ? (() => { const d = new Date(row.due); return social.dayKey(row.due) + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); })() : "";
    screen.querySelector("#ls-editor").innerHTML = `<section class="ls-card ls-form"><h3>编辑生活记录</h3><label>类型<select id="ls-form-kind">${[["state", "持续状态"], ["commitment", "约定/待办"], ["rule", "明确规矩"], ["knowledge", "本人知情"]].map(([k, l]) => `<option value="${k}" ${kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>所属人物<select id="ls-form-owner">${options(row.key || selected)}</select></label><div data-ls-fields="record"><label>内容<textarea id="ls-title" rows="3">${esc(row.title || row.content || "")}</textarea></label><label>另一方（可留空）<select id="ls-other"><option value="">无</option>${options(row.otherKey || "", row.key || selected)}</select></label><label>截止空间时间（可不填）<input type="datetime-local" id="ls-due" value="${due}"></label><label>知情方式<select id="ls-certainty">${["saw", "told", "guess"].map((k) => `<option value="${k}" ${row.certainty === k ? "selected" : ""}>${labels[k]}</option>`).join("")}</select></label></div><div data-ls-fields="state"><label>疲劳 0–100<input id="ls-fatigue" type="number" min="0" max="100" value="${row.fatigue ?? 30}"></label><label>情绪<input id="ls-mood" value="${esc(row.mood || "")}"></label><label>情绪复核间隔（空间小时）<input id="ls-mood-hours" type="number" min="1" max="168" value="12"></label><label>身体状态<input id="ls-health" value="${esc(row.health || "")}"></label><label>信任对象<select id="ls-trust-key"><option value="">不设置</option>${options(row.trustKey || "", row.key || selected)}</select></label><label>对该人的信任 0–100<input id="ls-trust" type="number" min="0" max="100" value="${row.trust ?? 50}"></label></div>${button("save-record", "保存")}${button("cancel-form", "取消")}</section>`;
    if (formId) { screen.querySelector("#ls-form-kind").disabled = true; screen.querySelector("#ls-form-owner").disabled = true; }
    updateFormVisibility(); screen.querySelector("#ls-editor").scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function updateFormVisibility() {
    const state = screen.querySelector("#ls-form-kind").value === "state";
    screen.querySelector('[data-ls-fields="state"]').hidden = !state; screen.querySelector('[data-ls-fields="record"]').hidden = state;
  }
  async function handle(event) {
    const tabButton = event.target.closest("[data-ls-tab]"); if (tabButton && !busy) { tab = tabButton.dataset.lsTab; formKind = ""; render(); return; }
    const target = event.target.closest("[data-ls-action]"); if (!target || busy) return;
    if (window.isPersonaSpaceBusy?.()) throw new Error("请先完成或停止当前操作。");
    const action = target.dataset.lsAction, recordId = target.dataset.id, service = new core.Service(database()), vts = now();
    const value = (id) => screen.querySelector("#" + id).value;
    if (action === "settings") { await service.saveSettings({ enabled: screen.querySelector("#ls-auto").checked, intervalMinutes: value("ls-interval") }); message = "已保存；开启后空闲时按空间时间自动联系，不会每个角色都同时请求。"; }
    if (action === "state") { form("state"); return; }
    if (action === "add-task" || action === "add-knowledge") { form(action === "add-task" ? "commitment" : "knowledge"); return; }
    if (action === "edit-record") { const row = core.project(data.rows.find((r) => r.id === recordId), data.rows, vts); form(row.kind, row); return; }
    if (action === "cancel-form") { formKind = ""; }
    if (action === "save-record") {
      const kind = value("ls-form-kind"), key = value("ls-form-owner"), raw = { key, title: value("ls-title"), otherKey: value("ls-other"), due: value("ls-due"), certainty: value("ls-certainty"), fatigue: Number(value("ls-fatigue")), mood: value("ls-mood"), moodHours: Number(value("ls-mood-hours")), health: value("ls-health"), trustKey: value("ls-trust-key"), trust: value("ls-trust-key") ? Number(value("ls-trust")) : null };
      if (formId && kind !== "state") { if (!raw.title.trim()) throw new Error("请输入内容。"); await service.edit(formId, { title: raw.title.trim().slice(0, 800), content: raw.title.trim().slice(0, 1600), due: core.dateMs(raw.due), otherKey: raw.otherKey || null, ...(kind === "knowledge" ? { certainty: raw.certainty } : {}) }, vts); }
      else await service.addRecord(kind, raw, vts);
      formKind = ""; message = "已保存，只在本空间生效。";
    }
    if (["confirm", "done"].includes(action)) { await service.edit(recordId, { status: action === "confirm" ? "active" : "done" }, vts); message = "已确认，本空间聊天会参考。"; }
    if (action === "delay") { await service.edit(recordId, { deferUntil: vts + 30 * 60000, reason: "作者按当前剧情推迟30分钟；若与后续安排冲突，请调整当天行程。" }, vts); message = "已推迟，不会擅自挤掉其他行程。"; }
    if (action === "confirm-schedule") { await service.confirmSchedule(recordId, vts); await sync(vts); message = "已调整当天行程，后续聊天会承接新安排。"; }
    if (action === "remove" && window.confirm("撤销这条记录？当前及之后不再参考，过去时间的记录仍保留。")) await service.edit(recordId, { removed: true }, vts);
    if (action === "review") {
      const row = data.rows.find((r) => r.id === recordId), original = data.rows.find((r) => r.id === row.targetId);
      if (original?.kind === "commitment") await service.edit(original.id, { status: "done" }, vts);
      await service.edit(row.id, { status: "done" }, vts); message = "本次履行已确认；持续规矩仍保留，不会自动加码。";
    }
    if (action === "start-thread") { threadId = await service.startThread(selected, value("ls-contact"), vts); }
    if (action === "thread") threadId = recordId;
    if (action === "simulate") {
      const pairs = service.eligible(data, vts).filter((pair) => pair.includes(selected)); if (!pairs.length) throw new Error("请先设置人物关系，或在私下消息里建立联系人会话。");
      await generatePair(pairs[Math.floor(Math.random() * pairs.length)]); return;
    }
    if (["continue-thread", "send", "send-continue"].includes(action)) {
      const thread = data.rows.find((r) => r.id === (recordId || threadId)); if (!thread) throw new Error("会话不存在。");
      if (action !== "continue-thread") { const from = value("ls-speaker"), to = thread.participants.find((p) => p !== from); await service.send(from, to, value("ls-text"), vts); }
      if (action !== "send") { await generatePair(thread.participants); return; }
    }
    await refresh();
  }
  function observeSpace() {
    controller?.abort(); attemptReal = 0; data = null; settings = null; selected = ""; threadId = ""; formKind = ""; message = "";
    const toast = document.getElementById("life-message-toast"); if (toast) toast.hidden = true;
    screen?.querySelectorAll("#ls-controls,#ls-tabs,#ls-content,#ls-editor").forEach((el) => el.innerHTML = "");
    notify("本空间独立生活");
  }
  window.EPhoneLifeSimulation = { open, sync, generatePair, proactiveTick, observeSpace, isBusy: () => busy };
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("me-life-simulation-button")?.addEventListener("click", () => open().catch((e) => { message = e.message; render(); }));
    setInterval(async () => {
      if (!window.ephoneAppReady || window.isPersonaSpaceBusy?.() || document.visibilityState === "hidden") return;
      try { await sync(); if (screen?.classList.contains("active") && !hasDraft()) await refresh(); await proactiveTick(); } catch (e) { notify("生活同步待重试"); }
    }, 30000);
  });
})();
