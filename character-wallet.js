(function () {
  "use strict";
  const core = window.ephoneCharacterWalletCore, esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (v) => Number(v || 0).toFixed(2), now = () => window.ephoneTimeMachine?.nowMs() || Date.now();
  let screen, service, people = [], key = "", account, entries = [], busy = false, controller, message = "", editing = false, token = 0, space, draftCache;
  async function sync(vts = now()) {
    if (!window.db?.characterWallets) return;
    const result = await new core.Service(window.db).settle(vts);
    await window.EPhoneMarketAdapter?.onPaid({ balance: result.balance }); return result;
  }
  function create() {
    if (screen) return;
    screen = document.createElement("section"); screen.id = "character-wallet-screen"; screen.className = "screen";
    screen.innerHTML = '<header class="header"><button type="button" id="cw-back" aria-label="返回">‹</button><span>角色钱包</span><button type="button" id="cw-settle">结算</button></header><div class="cw-scroll"><select id="cw-person" aria-label="选择角色"></select><div id="cw-notice" role="status"></div><div id="cw-body"></div></div>';
    document.getElementById("phone-screen").append(screen);
    screen.querySelector("#cw-back").onclick = () => { if (controller) controller.abort(); window.showScreen("chat-list-screen"); document.querySelector('.nav-item[data-view="me-view"]')?.click(); };
    screen.querySelector("#cw-person").onchange = async (e) => { if (!busy) { key = e.target.value; editing = false; await load(); } };
    screen.querySelector("#cw-settle").onclick = () => operate(async () => { const result = await sync(); message = result?.pending ? "已结算一批，还有未结算日期；再点结算继续，不会漏记或重复记账。" : "已按本空间时间结算，没有重复入账。"; await load(); });
    screen.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-cw-action]")?.dataset.cwAction;
      if (!action) return;
      if (action === "stop") { controller?.abort(); return; }
      if (busy) return;
      if (action === "edit") { editing = true; draftCache = account; render(); }
      if (action === "cancel-edit") { editing = false; render(); }
      if (action === "generate") await generate(false);
      if (action === "generate-all") await generate(true);
      if (action === "add-rule") { const form = readForm(); form.rules.push({ id: crypto.randomUUID(), label: "日常开销", category: "other", direction: "expense", cadence: "daily", day: 1, hour: 20, min: 10, max: 30, enabled: true }); renderForm(form); }
      if (action === "remove-rule") { const form = readForm(); form.rules.splice(Number(event.target.closest("button").dataset.index), 1); renderForm(form); }
      if (action === "save") await operate(async () => {
        const form = readForm(), settled = await sync();
        if (settled?.pending) throw new Error("仍有未结算日期，请先继续结算，再改收支计划。");
        await service.save(key, form, now(), account.revision);
        await window.EPhoneMarketAdapter?.onPaid({ balance: Number((await service.userWallet.get("main"))?.balance || 0) });
        editing = false; message = "已保存，计划从当前空间时间起生效。"; await load();
      });
      if (action === "book") await operate(async () => {
        const direction = screen.querySelector("#cw-book-direction").value, value = screen.querySelector("#cw-book-amount").value;
        await service.book(key, value, direction, { id: crypto.randomUUID(), vts: now(), category: "manual", description: screen.querySelector("#cw-book-note").value || "手动记账" });
        await window.EPhoneMarketAdapter?.onPaid({ balance: Number((await service.userWallet.get("main"))?.balance || 0) }); message = "收支已记入该角色钱包。"; await load();
      });
    });
  }
  async function operate(fn) {
    if (window.isPersonaSpaceBusy?.()) { message = "请先停止回复或完成当前操作，再修改角色钱包。"; render(); return; }
    busy = true;
    try { await fn(); } catch (error) { message = error.message; } finally { busy = false; render(); }
  }
  async function open() {
    if (window.isPersonaSpaceBusy?.()) { window.alert("请先停止回复或完成当前操作，再打开角色钱包。"); return; }
    create(); window.showScreen("character-wallet-screen"); busy = true;
    try {
      service = new core.Service(window.db); space = window.EPHONE_SPACE_ID || "default"; editing = false; message = "";
      const result = await sync(); if (result?.pending) message = "尚有未结算日期，可点击结算继续。";
      people = await service.people();
      if (!people.some((p) => p.key === key)) key = people[0]?.key || "";
      const select = screen.querySelector("#cw-person"); select.innerHTML = people.map((p) => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join(""); select.value = key;
      await load();
    } finally { busy = false; render(); }
  }
  async function load() {
    const current = ++token;
    if (!key) { account = null; entries = []; render(); return; }
    const [next, ledger] = await Promise.all([service.account(key), service.ledger(key, Infinity)]);
    if (current !== token || space !== (window.EPHONE_SPACE_ID || "default")) return;
    account = next; entries = ledger; render();
  }
  function render() {
    if (!screen) return;
    screen.querySelector("#cw-notice").textContent = message;
    screen.querySelector("#cw-person").disabled = busy; screen.querySelector("#cw-settle").disabled = busy;
    const body = screen.querySelector("#cw-body");
    if (!account) { body.innerHTML = "<p>本空间还没有角色，请先建立角色或NPC。</p>"; return; }
    const person = people.find((p) => p.key === key), month = core.dayKey(now()).slice(0, 7);
    const monthly = entries.filter((e) => !e.adjustment && e.status === "posted" && core.dayKey(e.vts).startsWith(month));
    const sum = (direction) => monthly.filter((e) => e.direction === direction).reduce((s, e) => s + e.amount, 0);
    body.innerHTML = `<section class="cw-balance"><small>${esc(window.EPHONE_SPACE_NAME || "默认空间")} · ${esc(person?.name)}</small><h2>¥ ${money(account.balance)}</h2><p>可用余额 · 其他资产 ¥${money(account.otherAssets)}<br>总资产 ¥${money(account.balance + (account.otherAssets || 0))}</p><small>${account.bound ? "此角色充当你，与本空间钱包共用余额；原有独立账户不自动转移。" : "角色独立钱包，不与其他人或空间混用。"}</small></section>` +
      `<section class="cw-summary"><span>${esc(month)} 收入<br>+${money(sum("income"))}</span><span>支出<br>−${money(sum("expense"))}</span></section>` +
      `<section class="cw-panel"><h3>${esc(account.job || "身份 / 工作尚未设置")}</h3><p>${esc(account.family || "家庭条件以角色人设为准")}</p><small>${esc(account.note || "可按人设生成资产及工资、零花钱和生活开销计划，也可手动设置。未设置不代表角色没有财富。")}</small><p>本空间时间：${esc(window.EPhoneMarketAdapter.formatTime(now()))}</p><p>${account.configured ? account.automatic ? "自动结算已开启" : "自动结算已暂停" : "尚未设置收支计划"}</p><button data-cw-action="edit">编辑资产与计划</button> <button data-cw-action="generate">按人设生成</button> <button data-cw-action="generate-all">初始化未设置角色</button>${busy && controller ? ' <button data-cw-action="stop">停止生成</button>' : ""}</section><div id="cw-editor"></div>` +
      `<section class="cw-panel"><h3>记一笔</h3><div class="cw-book"><select id="cw-book-direction"><option value="expense">支出</option><option value="income">收入</option></select><input id="cw-book-amount" type="number" min="0.01" step="0.01" placeholder="金额"><input id="cw-book-note" placeholder="用途 / 收入来源"><button data-cw-action="book">记账</button></div></section>` +
      `<section class="cw-panel"><h3>收支明细</h3><small>按虚拟日期显示最近200笔；资产初始设定不计工资收入。</small>${entries.length ? entries.slice(0, 200).map((e) => `<article class="cw-entry"><div><strong>${esc(e.description)}</strong><small>${esc(window.EPhoneMarketAdapter.formatTime(e.vts))} · ${e.source === "story_text" ? "聊天支出 · 有原文依据" : e.source === "scheduled" ? "定期收支" : e.adjustment ? "资产调整" : "实际收支"}</small></div><span class="${e.direction}">${e.status === "unconfigured" ? "未设置资产，未扣款" : e.status === "insufficient" ? "余额不足，未扣款" : (e.direction === "income" ? "+" : "−") + money(e.amount)}</span></article>`).join("") : "<p>暂无流水。</p>"}</section>`;
    if (editing) renderForm(draftCache || account);
    body.querySelectorAll("button").forEach((b) => { if (b.dataset.cwAction !== "stop") b.disabled = busy; });
  }
  const input = (id, label, value, type = "text") => `<label>${label}<input id="${id}" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="0" step="0.01"' : ""}></label>`;
  const options = (pairs, value) => pairs.map(([id, label]) => `<option value="${id}"${String(value) === String(id) ? " selected" : ""}>${label}</option>`).join("");
  function renderForm(form) {
    draftCache = form;
    screen.querySelector("#cw-editor").innerHTML = `<section class="cw-panel cw-form"><h3>资产与定期收支</h3>${input("cw-job", "身份 / 工作", form.job || "")}${input("cw-family", "家庭条件依据", form.family || "")}${input("cw-cash", account.bound ? "可用余额（会同步空间钱包）" : "可用余额", form.balance, "number")}${input("cw-assets", "其他资产估值（不能直接消费）", form.otherAssets || 0, "number")}${input("cw-note", "计划说明 / 拟定依据", form.note || "")}<label><input id="cw-auto" type="checkbox" ${form.automatic !== false ? "checked" : ""}>随空间时间自动结算</label><p>工资可每月发；生活开销可每天或每周按金额范围浮动。月末不足31日按当月最后一天。改计划不回溯发钱，往回跳也不会重复记账。</p><div id="cw-rules">${(form.rules || []).map((r, i) => `<div class="cw-rule" data-rule-id="${esc(r.id || crypto.randomUUID())}"><input data-field="label" aria-label="收支名称" value="${esc(r.label)}"><input data-field="category" aria-label="分类" value="${esc(r.category || "other")}"><select data-field="direction" aria-label="收支方向">${options([["income", "收入"], ["expense", "支出"]], r.direction)}</select><select data-field="cadence" aria-label="结算周期">${options([["monthly", "每月"], ["weekly", "每周"], ["daily", "每天"]], r.cadence)}</select><label>月几日 / 周几（0周日）<input data-field="day" type="number" min="0" max="31" value="${r.day ?? 1}"></label><label>几点结算<input data-field="hour" type="number" min="0" max="23" value="${r.hour ?? 9}"></label><label>金额下限<input data-field="min" type="number" min="0.01" step="0.01" value="${r.min ?? r.amount}"></label><label>金额上限<input data-field="max" type="number" min="0.01" step="0.01" value="${r.max ?? r.amount ?? r.min}"></label><label><input data-field="enabled" type="checkbox" ${r.enabled !== false ? "checked" : ""}>启用</label><button data-cw-action="remove-rule" data-index="${i}">移除这项计划</button></div>`).join("")}</div><button data-cw-action="add-rule">添加收支计划</button> <button data-cw-action="save">保存资产与计划</button> <button data-cw-action="cancel-edit">取消</button></section>`;
  }
  function readForm() {
    const value = (id) => screen.querySelector("#" + id).value;
    return draftCache = { job: value("cw-job"), family: value("cw-family"), balance: Number(value("cw-cash")), otherAssets: Number(value("cw-assets")), note: value("cw-note"), automatic: screen.querySelector("#cw-auto").checked,
      rules: [...screen.querySelectorAll(".cw-rule")].map((row) => Object.fromEntries([["id", row.dataset.ruleId], ...[...row.querySelectorAll("[data-field]")].map((el) => [el.dataset.field, el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value])])) };
  }
  async function generate(all) {
    await operate(async () => {
      controller = new AbortController(); message = "正在按各角色本人的性格、家庭条件和职业拟定资产及收支…"; render();
      try {
        const targets = all ? (await Promise.all(people.map(async (p) => ({ ...p, account: await service.account(p.key) })))).filter((p) => !p.account.configured).slice(0, 30) : people.filter((p) => p.key === key);
        if (!targets.length) { message = "所有角色都已经设置，未覆盖已有资产和计划。"; return; }
        const raw = await window.EPhoneMarketAdapter.generate(core.profilePrompt(targets), controller.signal); controller.signal.throwIfAborted();
        const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
        if (!Array.isArray(parsed) || parsed.length !== targets.length || new Set(parsed.map((p) => p.key)).size !== parsed.length || targets.some((p) => !parsed.some((r) => r.key === p.key))) throw new Error("返回的人物钱包不完整，未修改，请重试。");
        const clean = parsed.map((p) => ({ ...core.normalize(p), key: p.key }));
        if (all) {
          // One transaction for the whole generated set: partial saves are not a successful initialization.
          await service.db.transaction("rw", ...service.tables(), service.chats, service.npcs, async () => {
            for (const draft of clean) { const a = await service.account(draft.key); await service.save(draft.key, draft, now(), a.revision, { preserveBalance: a.bound || a.balance > 0 }); }
          });
          editing = false; message = `已初始化${clean.length}个未设置角色；工资、资产与消费均为人设拟定，可编辑。已有余额保留，未回溯结算。`; await load();
        } else {
          const draft = clean[0]; if (account.bound || account.configured || account.balance > 0) draft.balance = account.balance;
          draftCache = draft; editing = true; render(); message = "已拟定，请检查资产、工资与日常开销，点击保存后才生效。已有余额没有被生成结果覆盖。";
        }
      } finally { controller = null; }
    });
  }
  window.EPhoneCharacterWallet = { open, sync, isBusy: () => busy };
  document.addEventListener("DOMContentLoaded", () => {
    for (const id of ["me-character-wallet-button", "alipay-character-wallet-button"]) document.getElementById(id)?.addEventListener("click", () => open().catch((error) => { message = error.message; render(); }));
  });
})();
