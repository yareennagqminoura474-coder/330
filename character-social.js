(function () {
  "use strict";
  const core = window.ephoneCharacterSocialCore;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const now = () => window.ephoneTimeMachine?.nowMs() || Date.now();
  const time = (v) => window.EPhoneMarketAdapter?.formatTime(v) || new Date(v).toLocaleString("zh-CN");
  let screen, service, data, key = "", busy = false, controller, message = "", editRelation = null, editLife = null, draftLife, token = 0;
  const person = (k) => data?.people.find((p) => p.key === k);
  const reach = { available: "方便联系", busy: "忙碌中", rest: "休息中" };
  function create() {
    if (screen) return;
    screen = document.createElement("section"); screen.id = "character-social-screen"; screen.className = "screen";
    screen.innerHTML = '<header class="header"><button id="cs-back" aria-label="返回">‹</button><span>人物关系</span><span class="cs-header-note">独立生活</span></header><div class="cs-scroll"><select id="cs-person" aria-label="选择关系主人"></select><p id="cs-notice" role="status" aria-live="polite"></p><div id="cs-body"></div></div>';
    document.getElementById("phone-screen").append(screen);
    screen.querySelector("#cs-back").onclick = () => { controller?.abort(); window.showScreen("chat-list-screen"); document.querySelector('.nav-item[data-view="me-view"]')?.click(); };
    screen.querySelector("#cs-person").onchange = (e) => { if (!busy) { key = e.target.value; editRelation = null; editLife = null; render(); } };
    screen.addEventListener("click", (event) => handle(event).catch((error) => { message = error.message; render(); }));
  }
  async function reload() {
    data = await service.snapshot(); if (!person(key)) key = data.people[0]?.key || "";
    const select = screen.querySelector("#cs-person"); select.innerHTML = data.people.map((p) => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join(""); select.value = key;
  }
  async function open() {
    if (window.isPersonaSpaceBusy?.()) { window.alert("请先停止回复或完成当前操作，再打开人物关系。"); return; }
    create(); window.showScreen("character-social-screen"); busy = true; const current = ++token;
    try { service = new core.Service(window.db); message = ""; editRelation = null; editLife = null; await reload(); }
    finally { if (current === token) { busy = false; render(); } }
  }
  async function operate(fn) {
    if (busy || window.isPersonaSpaceBusy?.()) { message = "请先完成或停止当前操作。"; render(); return; }
    busy = true;
    try { await fn(); } catch (error) { message = error.name === "AbortError" ? "已停止，未保存本次生成。" : error.message; }
    finally { busy = false; render(); }
  }
  const sourceLabel = (r) => ({ manual: "手动设定", generated: "新拟定设定", history: "参考聊天建立", confirmed_chat: "聊天变化已确认" })[r.source] || "关系设定";
  function evidenceHtml(records) {
    return records?.length ? `<details class="cs-evidence"><summary>相关聊天 · ${records.length}条依据</summary>${records.map((e) => `<blockquote><small>${esc(e.chatName)} · ${esc(time(e.vts))}${e.kind === "memory" ? " · 总结记忆" : ""}</small>${esc(e.quote)}</blockquote>`).join("")}</details>` : "";
  }
  function render() {
    if (!screen) return;
    screen.querySelector("#cs-notice").textContent = message;
    screen.querySelector("#cs-person").disabled = busy;
    const body = screen.querySelector("#cs-body"), owner = person(key);
    if (!owner) { body.innerHTML = "<p>本空间还没有人物，请先建立角色或NPC。</p>"; return; }
    const relations = data.relations.filter((r) => (r.a === key || r.b === key) && person(r.a) && person(r.b)), life = data.lives.find((l) => l.key === key), activity = core.activityAt(life, now());
    const pending = data.events.filter((e) => e.status === "pending" && (e.a === key || e.b === key));
    body.innerHTML = `<section class="cs-hero"><small>${esc(window.EPHONE_SPACE_NAME || "默认空间")} · 本空间人物关系</small><h2>${esc(owner.name)}的生活圈</h2><p>关系不等于在场。朋友、同事各自有生活，不会默认一直陪着你或绑定角色。</p><button data-cs-action="generate">一键生成人物、关系和作息</button>${busy && controller ? '<button data-cs-action="stop">停止生成</button>' : ""}<small>每次点击调用已配置API，新建约3至5位有完整人设的NPC，自动绑定双向关系，并生成各自一周作息；遗漏或冲突会单独补全。保留已有设定，不自动进群；格式不完整时最多重试一次。</small></section>` +
      `<section class="cs-panel"><div class="cs-title"><h3>独立生活</h3><button data-cs-action="generate-life">一键生成/补全作息</button><button data-cs-action="edit-life">编辑作息</button></div><p>${esc(life?.job || "身份 / 工作依人设")} · ${esc(life?.home || "常住处未设置")}</p><div class="cs-activity"><strong>${activity ? esc(activity.activity) : "暂无当前安排"}</strong><span>${activity ? esc(activity.place) + " · " + reach[activity.reachability] : "依当前情节自然行动"}</span><small>${activity?.source === "chat" ? "来自实际聊天，短时状态" : activity ? "作息预期，不代表此刻一定在场；当前聊天情节和假期优先" : "不会因没设置计划就凭空离场"}</small></div><small>空间时间：${esc(time(now()))}${life?.enabled === false ? " · 作息已暂停" : ""}</small><p>${esc(life?.note || "一键生成工作学习、睡眠休息、兴趣社交和周末安排；可编辑，已有手动作息不会自动覆盖。")}</p><details><summary>一周安排 · ${(life?.routine || []).length}项</summary>${(life?.routine || []).map((r) => `<p>${r.days.map((d) => "周" + "日一二三四五六"[d]).join("、")} ${esc(r.start)}–${esc(r.end)}<br>${esc(r.activity)} · ${esc(r.place)} · ${reach[r.reachability]}</p>`).join("")}</details></section><div id="cs-life-editor"></div>` +
      `<section class="cs-panel"><div class="cs-title"><h3>人物关系 · ${relations.length}</h3><button data-cs-action="add-relation">添加关系</button></div><p class="cs-help">双方关系分别保存，例如：对你而言是下属，对他而言你是上司。新拟定设定不会伪装成旧聊天事实。</p>${relations.map((r) => { const from = r.a === key, other = person(from ? r.b : r.a); return `<article class="cs-relation"><button class="cs-contact" data-cs-action="person" data-key="${esc(other.key)}">${esc(other.name)} <small>查看TA的关系 ›</small></button><div class="cs-labels"><span>TA是你的${esc(from ? r.aToB : r.bToA)}</span><span>你是TA的${esc(from ? r.bToA : r.aToB)}</span></div><p>${esc(r.detail)}</p><small>${sourceLabel(r)}</small>${evidenceHtml(r.evidence)}<details><summary>人物档案</summary><p class="cs-persona">${esc(other.persona || "未设置")}</p></details><div><button data-cs-action="edit-relation" data-id="${esc(r.id)}">编辑</button> <button data-cs-action="delete-relation" data-id="${esc(r.id)}">解除关系</button></div></article>`; }).join("") || "<p>还没有关系，可以一键生成或手动连接已有角色。</p>"}</section><div id="cs-relation-editor"></div>` +
      (pending.length ? `<section class="cs-panel"><h3>聊天中的关系变化 · 待确认</h3><small>聊天会提取有原文依据的变化，先由你确认，不自动改掉人设和辈分。</small>${pending.map((e) => `<article class="cs-relation"><strong>${esc(person(e.a)?.name || "已移走的人物")} ↔ ${esc(person(e.b)?.name || "已移走的人物")}</strong><p>${esc(e.aToB)} / ${esc(e.bToA)} · ${esc(e.detail)}</p>${evidenceHtml(e.evidence)}<button data-cs-action="accept-event" data-id="${esc(e.id)}">确认这段关系</button> <button data-cs-action="dismiss-event" data-id="${esc(e.id)}">忽略</button></article>`).join("")}</section>` : "");
    if (editRelation) renderRelationForm(); if (editLife) renderLifeForm(draftLife);
    body.querySelectorAll("button").forEach((b) => { if (b.dataset.csAction !== "stop") b.disabled = busy; });
  }
  const field = (id, label, value, type = "text") => `<label>${label}<input id="${id}" type="${type}" value="${esc(value)}"></label>`;
  function renderRelationForm() {
    const r = editRelation, from = r.a === key, otherKey = r.id ? from ? r.b : r.a : "";
    screen.querySelector("#cs-relation-editor").innerHTML = `<section class="cs-panel cs-form"><h3>${r.id ? "编辑" : "添加"}关系</h3><label>另一位人物<select id="cs-target" ${r.id ? "disabled" : ""}>${data.people.filter((p) => p.key !== key).map((p) => `<option value="${esc(p.key)}" ${p.key === otherKey ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></label>${field("cs-a-label", "TA对你而言是（例如：同事 / 下属）", r.id ? from ? r.aToB : r.bToA : "")}${field("cs-b-label", "你对TA而言是（例如：同事 / 上司）", r.id ? from ? r.bToA : r.aToB : "")}<label>关系来由与相处边界<textarea id="cs-detail" rows="4">${esc(r.detail || "")}</textarea></label><button data-cs-action="save-relation">保存关系</button> <button data-cs-action="cancel-relation">取消</button></section>`;
  }
  function renderLifeForm(form) {
    draftLife = form;
    screen.querySelector("#cs-life-editor").innerHTML = `<section class="cs-panel cs-form"><h3>日常生活安排</h3>${field("cs-job", "身份 / 工作", form.job || "")}${field("cs-home", "常住处", form.home || "")}<label>生活节奏与依据<textarea id="cs-note" rows="3">${esc(form.note || "")}</textarea></label><label><input id="cs-enabled" type="checkbox" ${form.enabled !== false ? "checked" : ""}>聊天参考这些日常安排</label><p>跨夜可以写22:00至07:00；周几表示开始的那天。计划不是强制行动，正在发生的剧情优先。</p><div id="cs-routines">${(form.routine || []).map((r, i) => `<div class="cs-routine" data-id="${esc(r.id || "routine-" + i)}"><div class="cs-days">${[1,2,3,4,5,6,0].map((d) => `<label><input data-day="${d}" type="checkbox" ${r.days.includes(d) ? "checked" : ""}>周${"日一二三四五六"[d]}</label>`).join("")}</div><div class="cs-times"><label>开始<input type="time" data-field="start" value="${esc(r.start)}"></label><label>结束<input type="time" data-field="end" value="${esc(r.end)}"></label></div><input data-field="activity" aria-label="活动" placeholder="活动，例如工作" value="${esc(r.activity)}"><input data-field="place" aria-label="地点" placeholder="地点，例如公司" value="${esc(r.place)}"><select data-field="reachability">${Object.entries(reach).map(([k, label]) => `<option value="${k}" ${r.reachability === k ? "selected" : ""}>${label}</option>`).join("")}</select><button data-cs-action="remove-routine" data-index="${i}">移除安排</button></div>`).join("")}</div><button data-cs-action="add-routine">添加安排</button> <button data-cs-action="save-life">保存作息</button> <button data-cs-action="cancel-life">取消</button></section>`;
  }
  function readLife() {
    const value = (id) => screen.querySelector("#" + id).value;
    return draftLife = { job: value("cs-job"), home: value("cs-home"), note: value("cs-note"), enabled: screen.querySelector("#cs-enabled").checked,
      routine: [...screen.querySelectorAll(".cs-routine")].map((row) => ({ id: row.dataset.id, days: [...row.querySelectorAll("[data-day]:checked")].map((e) => Number(e.dataset.day)), ...Object.fromEntries([...row.querySelectorAll("[data-field]")].map((e) => [e.dataset.field, e.value])) })) };
  }
  async function fillSchedules(targets) {
    let completed = 0;
    try {
      for (let offset = 0; offset < targets.length; offset += 6) {
        const group = targets.slice(offset, offset + 6), prompt = core.schedulePrompt(group);
        let reason = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          controller.signal.throwIfAborted();
          message = `正在生成一周作息：已保存${completed}/${targets.length}人，当前：${group.map((p) => p.name).join("、")}` + (attempt ? "（正在修正冲突或遗漏，最多重试一次）" : ""); render();
          const raw = await window.EPhoneMarketAdapter.generate(prompt + (reason ? "\n上一轮未保存，原因：" + reason + "。请重新返回名单内所有人的完整、不重叠作息。" : ""), controller.signal); controller.signal.throwIfAborted();
          try { completed += await service.saveSchedules(raw, group, now()); break; }
          catch (error) { if (attempt || error.code !== "SOCIAL_GENERATION_INVALID") throw error; reason = error.message; }
        }
      }
      return completed;
    } catch (error) { error.completedSchedules = completed; throw error; }
  }
  async function handle(event) {
    const button = event.target.closest("[data-cs-action]"); if (!button) return;
    const action = button.dataset.csAction, id = button.dataset.id;
    if (action === "stop") { controller?.abort(); return; } if (busy) return;
    if (action === "person") { key = button.dataset.key; editRelation = null; editLife = null; screen.querySelector("#cs-person").value = key; render(); screen.querySelector(".cs-scroll").scrollTop = 0; }
    if (action === "add-relation") { editRelation = {}; render(); screen.querySelector("#cs-relation-editor").scrollIntoView({ block: "start", behavior: "smooth" }); }
    if (action === "edit-relation") { editRelation = data.relations.find((r) => r.id === id); render(); screen.querySelector("#cs-relation-editor").scrollIntoView({ block: "start", behavior: "smooth" }); }
    if (action === "cancel-relation") { editRelation = null; render(); }
    if (action === "save-relation") await operate(async () => {
      const other = screen.querySelector("#cs-target").value, aToB = screen.querySelector("#cs-a-label").value, bToA = screen.querySelector("#cs-b-label").value, detail = screen.querySelector("#cs-detail").value;
      await service.saveRelation({ a: key, b: other, aToB, bToA, detail, evidence: editRelation.evidence || [] }, now(), { revision: editRelation.revision || 0 });
      editRelation = null; message = "关系已保存，双方聊天会参考这段关系，其他人不会自动知情。"; await reload();
    });
    if (action === "delete-relation" && window.confirm("只解除这段关系，不删除人物和聊天记录，确定吗？")) await operate(async () => {
      await service.characterRelations.delete(id); message = "已解除关系，人物与聊天记录仍保留。"; await reload();
    });
    if (action === "edit-life") { const life = data.lives.find((l) => l.key === key); editLife = { revision: life?.revision || 0 }; draftLife = structuredClone(life || { enabled: true, routine: [] }); render(); screen.querySelector("#cs-life-editor").scrollIntoView({ block: "start", behavior: "smooth" }); }
    if (action === "cancel-life") { editLife = null; render(); }
    if (action === "add-routine") { const form = readLife(); form.routine.push({ id: crypto.randomUUID(), days: [1,2,3,4,5], start: "09:00", end: "18:00", activity: "", place: "", reachability: "busy" }); renderLifeForm(form); }
    if (action === "remove-routine") { const form = readLife(); form.routine.splice(Number(button.dataset.index), 1); renderLifeForm(form); }
    if (action === "save-life") await operate(async () => { await service.saveLife(key, readLife(), now(), editLife.revision); editLife = null; message = "日常安排已保存，所有聊天按本空间时间参考，不会强行打断当前剧情。"; await reload(); });
    if (["accept-event", "dismiss-event"].includes(action)) await operate(async () => { await service.review(id, action === "accept-event", now()); message = action === "accept-event" ? "已确认，人物关系已更新。" : "已忽略，原关系未改变。"; await reload(); });
    if (action === "generate-life") await operate(async () => {
      let targets = await service.scheduleTargets(key);
      if (!targets.length) {
        if (!window.confirm("当前角色及生活圈已有作息。是否重新生成当前角色的作息？只有你确认才会替换；已有身份、住处和暂停状态保留。")) return;
        targets = await service.scheduleTargets(key, { includeCircle: false, replaceOwner: true });
      }
      controller = new AbortController(); editRelation = null; editLife = null;
      try { const completed = await fillSchedules(targets); message = `已为${completed}位人物生成并保存一周作息，没有新增NPC；已有安排未自动覆盖。`; }
      catch (error) { message = `已保存${error.completedSchedules || 0}人的作息；` + (error.name === "AbortError" ? "已停止，其余人物未修改。" : "其余尚未完成：" + error.message + " 可再点一键生成/补全作息。"); }
      finally { controller = null; await reload(); }
    });
    if (action === "generate") await operate(async () => {
      controller = new AbortController(); message = "第1步：正在调用API生成完整NPC人设（含职业、性格、家庭、双向关系和一周作息）…"; editRelation = null; editLife = null; render();
      try {
        const context = await service.context(key); controller.signal.throwIfAborted();
        const prompt = core.newCirclePrompt(context); let result;
        for (let attempt = 0; attempt < 2; attempt++) {
          const raw = await window.EPhoneMarketAdapter.generate(prompt + (attempt ? "\n上一轮格式不完整，原因：" + message + "。本次必须返回至少2位全新、完整人设且包含双向关系的NPC。" : ""), controller.signal); controller.signal.throwIfAborted();
          message = "第2步：正在保存NPC，并自动绑定人物关系…"; render();
          try { result = await service.generateNew(key, raw, now(), context); break; }
          catch (error) {
            if (attempt || error.code !== "SOCIAL_GENERATION_INVALID") throw error;
            message = error.message + " 正在重新调用API补全（最多一次）…"; render();
          }
        }
        const savedNotice = `已新增${result.created.length}位NPC、建立${result.linked}段关系：${result.created.map((p) => p.name).join("、")}。完整人设已保存。`;
        try {
          const targets = await service.scheduleTargets(key), completed = await fillSchedules(targets);
          message = savedNotice + ` 作息已一并生成保存${completed ? "（单独补全" + completed + "人）" : ""}；已有手动安排保持不变。` + result.warnings.filter((w) => !w.includes("作息待补全")).join("\n");
        } catch (error) {
          message = savedNotice + ` 已另保存${error.completedSchedules || 0}人的作息；` + (error.name === "AbortError" ? "作息生成已停止" : "其余作息未完成：" + error.message) + "。人物及关系已保留，可点一键生成/补全作息继续，不必重新创建NPC。";
        }
        await reload(); await window.refreshPersonaSpaceData?.();
      } finally { controller = null; }
    });
  }
  window.EPhoneCharacterSocial = { open, isBusy: () => busy };
  document.addEventListener("DOMContentLoaded", () => document.getElementById("me-character-social-button")?.addEventListener("click", () => open().catch((error) => { message = error.message; render(); })));
})();
