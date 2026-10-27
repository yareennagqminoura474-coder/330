(function () {
  "use strict";
  const core = window.ephoneCharacterWalletCore, esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (v) => Number(v || 0).toFixed(2), now = () => window.ephoneTimeMachine?.nowMs() || Date.now();
  let screen, service, people = [], key = "", account, entries = [], busy = false, mutating = false, controller, message = "", editing = false, token = 0, space, draftCache;
  let ledgerEditing = null, entryLimit = 200;
  let walletPlans = [], duplicates = [], playerBinding;
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
    screen.querySelector("#cw-back").onclick = () => { window.showScreen("chat-list-screen"); document.querySelector('.nav-item[data-view="me-view"]')?.click(); };
    screen.querySelector("#cw-person").onchange = async (e) => { if (!busy) { key = e.target.value; editing = false; ledgerEditing = null; entryLimit = 200; await load(); } };
    screen.querySelector("#cw-settle").onclick = () => operate(async () => { const result = await sync(); message = result?.pending ? "已结算一批，还有未结算日期；再点结算继续，不会漏记或重复记账。" : "已按本空间时间结算，没有重复入账。"; await load(); });
    screen.addEventListener("change", (event) => {
      if (["counterpartyKey", "direction"].includes(event.target.dataset.field)) {
        const row = event.target.closest(".cw-rule"), form = readForm(), r = form.rules.find((r) => r.id === row.dataset.ruleId);
        if (event.target.dataset.field === "counterpartyKey") r.counterpartyName = "";
        r.linkedRuleId = ""; r.independentTransfer = false; renderForm(form);
      }
      if (event.target.dataset.field === "linkedRuleId") renderForm(readForm());
      rememberEntryInput(event.target);
    });
    screen.addEventListener("input", (event) => rememberEntryInput(event.target));
    screen.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-cw-action]"), action = button?.dataset.cwAction;
      if (!action) return;
      if (action === "stop") { controller?.abort(); return; }
      if (busy) return;
      if (action === "undo-duplicate") {
        const candidate = duplicates[Number(button.dataset.duplicateIndex)]; if (!candidate) return;
        const original = structuredClone(candidate.entry);
        if (!window.confirm(`撤销这笔疑似重复款项？\n${candidate.from} → ${candidate.to} · ¥${money(original.amount)}\n保留付款方计划产生的另一笔款项；这笔会同时退回付款方、扣回收款方，关联账单标为已撤销。同一笔不会重复回退。`)) return;
        await operate(async () => {
          const result = await recordsService().deleteLedger(original.key, original);
          await refreshRecords(result); message = "重复款项已撤销，双方余额已同步回退，原来的另一笔保留。"; await load();
        }); return;
      }
      if (action === "more-entries") { entryLimit += 200; render(); return; }
      if (action === "edit-entry") {
        const entry = entries[Number(button.dataset.entryIndex)]; if (!entry) return;
        editing = false; ledgerEditing = { original: structuredClone(entry), draft: structuredClone(entry), key, space };
        render(); screen.querySelector("#cw-entry-editor")?.scrollIntoView({ block: "nearest" }); return;
      }
      if (action === "cancel-entry-edit") { ledgerEditing = null; render(); return; }
      if (action === "save-entry") { await saveEntry(); return; }
      if (action === "delete-entry") {
        const entry = entries[Number(button.dataset.entryIndex)]; if (!entry) return;
        const original = structuredClone(entry), personKey = key;
        if (!window.confirm(`删除这条账单？\n${entry.description || "收支记录"} · ¥${money(entry.amount)}\n删除支出会退回对应款项，删除收入会扣回款项；已撤销的同笔资金不会重复回退。\n只删除这里的账单，商城订单、商品和另一方账单不会被删除；关联记录会标明资金已撤销。`)) return;
        await operate(async () => {
          const result = await recordsService().deleteLedger(personKey, original);
          ledgerEditing = null; await refreshRecords(result); message = "本处账单已删除，对应资金已按实际入账情况撤销；其他位置的记录已保留，不会重复回退。"; await load();
        }); return;
      }
      if (action === "correct-estimate") {
        const entry = entries.find((e) => e.id === event.target.closest("button").dataset.entryId); if (!entry) return;
        const value = window.prompt("校正这笔估算支出（原扣款会同步调整，不会另扣一笔）", String(entry.amount));
        if (value != null) await operate(async () => { const updated = await service.correctEstimate(entry.id, value); await window.ephoneRefreshFinanceChat?.(updated.chatId); await window.EPhoneMarketAdapter?.onPaid({ balance: Number((await service.userWallet.get("main"))?.balance || 0) }); message = "已校正金额，余额和原流水已同步调整。"; await load(); });
      }
      if (action === "edit") { editing = true; ledgerEditing = null; draftCache = account; render(); }
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
        editing = false; message = "已保存，关联的双方计划已同步，今后同一周期只结算一笔；已有流水不因改计划重新扣款。"; await load();
      });
      if (action === "book") await operate(async () => {
        const direction = screen.querySelector("#cw-book-direction").value, value = screen.querySelector("#cw-book-amount").value;
        await service.book(key, value, direction, { id: crypto.randomUUID(), vts: now(), category: "manual", description: screen.querySelector("#cw-book-note").value || "手动记账" });
        await window.EPhoneMarketAdapter?.onPaid({ balance: Number((await service.userWallet.get("main"))?.balance || 0) }); message = "收支已记入该角色钱包。"; await load();
      });
    });
  }
  async function operate(fn, { generation = false } = {}) {
    if (busy || window.isEPhoneMutationBusy?.() || !generation && window.isEPhoneTimeChangeBusy?.()) { message = "请先完成当前收付款或回复，再修改钱包；资产生成可与回复同时进行。"; render(); return; }
    busy = true; mutating = !generation;
    // Disable controls without rebuilding the form: readForm/saveEntry still
    // need its current values, and a mid-save role switch must not mislabel it.
    screen?.querySelectorAll("#cw-person, #cw-settle, #cw-body button, #cw-entry-editor input, #cw-entry-editor textarea, #cw-entry-editor select").forEach((field) => {
      if (field.dataset.cwAction !== "stop") field.disabled = true;
    });
    try { await fn(); } catch (error) { message = error.name === "AbortError" ? "已停止生成。" : error.message; } finally { busy = false; mutating = false; render(); }
  }
  async function open() {
    if (busy) { window.showScreen("character-wallet-screen"); render(); return; }
    if (window.isEPhoneMutationBusy?.()) { window.alert("正在保存收付款，请稍后打开角色钱包。"); return; }
    create(); window.showScreen("character-wallet-screen"); busy = true;
    try {
      service = new core.Service(window.db); space = window.EPHONE_SPACE_ID || "default"; editing = false; ledgerEditing = null; entryLimit = 200; message = "";
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
    const [next, ledger, plans, repeated, binding] = await Promise.all([service.account(key), service.ledger(key, Infinity), service.characterWallets.toArray(), service.duplicateTransfers(key), service.spaceProfiles.get("player")]);
    if (current !== token || space !== (window.EPHONE_SPACE_ID || "default")) return;
    account = next; entries = ledger.filter((entry) => !entry.ledgerHidden); walletPlans = plans; duplicates = repeated; playerBinding = binding; render();
  }
  function recordsService() {
    if (!window.ephoneFinanceRecordsCore?.Service) throw new Error("账单编辑组件尚未加载，请刷新后重试。");
    if (space !== (window.EPHONE_SPACE_ID || "default") || service.db !== window.db.characterWallets.db) throw new Error("空间已切换，请重新打开角色资产。");
    return new window.ephoneFinanceRecordsCore.Service(service.db);
  }
  async function refreshRecords(result) {
    // Financial writes have already committed. A failed UI refresh must not
    // encourage another debit/refund or turn a successful edit into a failure.
    try {
      await window.EPhoneMarketAdapter?.onPaid(result);
      for (const chat of result.chats || []) await window.ephoneRefreshFinanceChat?.(chat.id);
    } catch (error) { console.warn("账单已保存，界面同步稍后刷新", error); }
  }
  function localDateTime(value) {
    const date = new Date(Number(value)); if (!Number.isFinite(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function rememberEntryInput(field) {
    if (!ledgerEditing || !field.closest("#cw-entry-editor")) return;
    const name = field.id.replace("cw-entry-", "");
    if (["description", "category", "direction"].includes(name)) ledgerEditing.draft[name] = field.value;
    if (name === "amount") ledgerEditing.draft.amount = field.value;
    if (name === "time") ledgerEditing.draft.vts = new Date(field.value).getTime();
  }
  function renderEntry(entry, index) {
    const source = entry.estimated ? entry.estimateCorrected ? "估算支出 · 已由你校正" : "估算支出 · 不是明说的实际金额" :
      entry.source === "story_text" ? "聊天支出 · 有原文依据" : entry.source === "scheduled" ? "定期收支" : entry.adjustment ? "资产调整" : "实际收支";
    const voided = entry.status === "voided";
    const amount = voided ? `原${entry.direction === "income" ? "收入" : "支出"}<br>¥${money(entry.amount)}<small>款项已撤销</small>` :
      entryStatus(entry) || (entry.direction === "income" ? "+" : "−") + money(entry.amount);
    return `<article class="cw-entry${voided ? " cw-entry-voided" : ""}"><div><strong>${esc(entry.description)}</strong>` +
      `<small>${esc(window.EPhoneMarketAdapter.formatTime(entry.vts))} · ${esc(entry.category || "其他")} · ${source}</small>` +
      (entry.estimated ? `<small>${esc(entry.estimate?.reason || "按商品参考估算")}</small>` : "") +
      `<div class="cw-entry-actions"><button type="button" data-cw-action="edit-entry" data-entry-index="${index}">编辑</button> ` +
      `<button type="button" class="cw-danger" data-cw-action="delete-entry" data-entry-index="${index}">删除</button>` +
      (entry.estimated && entry.status === "posted" ? ` <button type="button" data-cw-action="correct-estimate" data-entry-id="${esc(entry.id)}">校正金额</button>` : "") +
      `</div></div><span class="${voided ? "cw-reversed" : entry.direction}">${amount}</span></article>`;
  }
  function renderEntryEditor() {
    const slot = screen.querySelector("#cw-entry-editor"); if (!slot || !ledgerEditing) return;
    const entry = ledgerEditing.original, draft = ledgerEditing.draft, posted = (entry.status || "posted") === "posted";
    const linked = Boolean(entry.orderId || entry.transferId || entry.source === "card" || entry.moneyReceipt);
    slot.innerHTML = `<section class="cw-entry-edit cw-form"><h3>编辑这条账单</h3><small>金额按新旧差额同步余额，不会重新全额记账。这里只修改记录，不改商品、订单归属或收支计划。</small><label>收支方向<select id="cw-entry-direction" ${linked || !posted ? "disabled" : ""}>${options([["expense", "支出"], ["income", "收入"]], draft.direction)}</select></label><label>金额（元）<input id="cw-entry-amount" type="number" min="0.01" step="0.01" value="${esc(draft.amount)}" ${!posted || (entry.source === "card" || entry.moneyReceipt) ? "disabled" : ""}></label><label>用途 / 收入来源<textarea id="cw-entry-description" rows="3" maxlength="600">${esc(draft.description || "")}</textarea></label><label>分类<input id="cw-entry-category" maxlength="30" value="${esc(draft.category || "other")}"></label><label>虚拟日期和时间<input id="cw-entry-time" type="datetime-local" value="${esc(localDateTime(draft.vts ?? draft.timestamp))}"></label>${!posted ? '<small>这笔资金未入账或已撤销，可修改说明和时间，不会因此恢复收付款。</small>' : ""}${(entry.source === "card" || entry.moneyReceipt) ? '<small>转账 / 红包卡片金额保持不变，以免已领取的份额和卡片不一致。</small>' : ""}${linked ? '<small>关联款项的方向保持不变；金额调整会核对相应账单，避免重复增减。</small>' : ""}<button type="button" data-cw-action="save-entry">保存账单</button> <button type="button" data-cw-action="cancel-entry-edit">取消</button></section>`;
  }
  async function saveEntry() {
    if (!ledgerEditing) return;
    const edit = ledgerEditing, value = (id) => screen.querySelector("#" + id).value;
    const timeText = value("cw-entry-time"), vts = new Date(timeText).getTime();
    if (!timeText || !Number.isFinite(vts) || localDateTime(vts) !== timeText) { message = "请选择有效的虚拟日期和时间。"; screen.querySelector("#cw-notice").textContent = message; return; }
    const originalTime = Number(edit.original.vts ?? edit.original.timestamp);
    const patch = { description: value("cw-entry-description"), category: value("cw-entry-category"),
      vts: timeText === localDateTime(originalTime) ? originalTime : vts };
    if (!screen.querySelector("#cw-entry-amount").disabled) patch.amount = Number(value("cw-entry-amount"));
    if (!screen.querySelector("#cw-entry-direction").disabled) patch.direction = value("cw-entry-direction");
    edit.draft = { ...edit.draft, ...patch };
    await operate(async () => {
      if (edit.space !== space || edit.key !== key) throw new Error("角色或空间已切换，请重新编辑账单。");
      const result = await recordsService().editLedger(edit.key, edit.original, patch);
      ledgerEditing = null; await refreshRecords(result); message = "账单已保存，余额与关联流水已按差额同步。"; await load();
    });
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
      (duplicates.length ? `<section class="cw-panel"><h3>疑似重复的定向收支</h3><small>下面的两笔分别来自付款方和收款方的旧计划。核对后可撤销多出的一笔，双方余额一起回退；正常独立款项请保留。</small>${duplicates.map((d, i) => `<div class="cw-entry"><div><strong>${esc(d.from)} → ${esc(d.to)}</strong><small>保留：${esc(window.EPhoneMarketAdapter.formatTime(d.kept.vts))} · ¥${money(d.kept.amount)}<br>疑似多记：${esc(window.EPhoneMarketAdapter.formatTime(d.entry.vts))} · ¥${money(d.entry.amount)}<br>${esc(d.entry.description)}</small><button type="button" class="cw-danger" data-cw-action="undo-duplicate" data-duplicate-index="${i}">撤销多记的这一笔</button></div></div>`).join("")}</section>` : "") +
      `<section class="cw-panel"><h3>${esc(account.job || "身份 / 工作尚未设置")}</h3><p>${esc(account.family || "家庭条件以角色人设为准")}</p><small>${esc(account.note || "可按人设生成资产及工资、零花钱和生活开销计划，也可手动设置。未设置不代表角色没有财富。")}</small><p>本空间时间：${esc(window.EPhoneMarketAdapter.formatTime(now()))}</p><p>${account.configured ? account.automatic ? "自动结算已开启" : "自动结算已暂停" : "尚未设置收支计划"}</p><button data-cw-action="edit">编辑资产与计划</button> <button data-cw-action="generate">按人设生成</button> <button data-cw-action="generate-all">初始化未设置角色</button>${busy && controller ? ' <button data-cw-action="stop">停止生成</button>' : ""}</section><div id="cw-editor"></div>` +
      `<section class="cw-panel"><h3>记一笔</h3><div class="cw-book"><select id="cw-book-direction"><option value="expense">支出</option><option value="income">收入</option></select><input id="cw-book-amount" type="number" min="0.01" step="0.01" placeholder="金额"><input id="cw-book-note" placeholder="用途 / 收入来源"><button data-cw-action="book">记账</button></div></section>` +
      `<section class="cw-panel"><h3>收支明细</h3><small>按虚拟日期显示${Math.min(entryLimit, entries.length)} / ${entries.length}笔；资产初始设定不计工资收入。删账单只隐藏这里的记录，同一笔资金最多撤销一次。</small><div id="cw-entry-editor"></div>${entries.length ? entries.slice(0, entryLimit).map(renderEntry).join("") : "<p>暂无流水。</p>"}${entries.length > entryLimit ? '<button type="button" data-cw-action="more-entries">查看更多账单</button>' : ""}</section>`;
    if (editing) renderForm(draftCache || account);
    if (ledgerEditing) renderEntryEditor();
    body.querySelectorAll("button").forEach((b) => { if (b.dataset.cwAction !== "stop") b.disabled = busy; });
  }
  const input = (id, label, value, type = "text") => `<label>${label}<input id="${id}" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="0" step="0.01"' : ""}></label>`;
  const options = (pairs, value) => pairs.map(([id, label]) => `<option value="${esc(id)}"${String(value) === String(id) ? " selected" : ""}>${esc(label)}</option>`).join("");
  function counterpartOptions(r) {
    const pairs = [["", "自动识别计划中明确提到的人物"], ["__external__", "外部收支，不联动角色"], ...people.filter((p) => p.key !== key).map((p) => [p.key, p.label])];
    if (r.counterpartyKey && !pairs.some(([id]) => id === r.counterpartyKey)) pairs.push([r.counterpartyKey, "原关联角色已移走，请重新选择"]);
    return options(pairs, r.counterpartyKey || "");
  }
  function renderRuleLink(r) {
    const binding = playerBinding, other = core.counterparty(r, key, people, binding), peer = walletPlans.find((w) => w.key === other?.key);
    const candidates = (peer?.rules || []).filter((p) => p.direction !== r.direction && core.counterparty(p, peer.key, people, binding)?.key === key);
    const choices = [["", "自动关联对方同类计划"], ["__independent__", "这是独立的一笔，另行结算"], ...candidates.map((p) => [p.id, `关联：${p.label}（${({ monthly: "每月", weekly: "每周", daily: "每天" })[p.cadence]} · ¥${money(p.min)}—${money(p.max)}）`])];
    const value = r.independentTransfer ? "__independent__" : r.linkedRuleId || "";
    if (value && !choices.some(([id]) => id === value)) choices.push([value, "原关联计划已变化，请重新选择"]);
    const draft = walletPlans.filter((w) => w.key !== key).concat({ ...account, key, rules: draftCache.rules });
    const resolved = core.transferPlans(draft, people, binding), token = JSON.stringify([key, r.id]), pair = resolved.pairs.get(token);
    const note = value === "__independent__" ? "作为独立款项结算，仍会同步双方余额和账单。" : pair ? `已与「${pair.r.label}」关联；修改任意一边的金额、日期、时刻或启用状态，保存后同步另一边。` :
      resolved.ambiguous.has(token) ? "有多个可能的对应计划，请选择明确关联；未确认的收入计划不再另扣一笔。" : "只设这一边也会同步双方余额和账单；对方建立同类计划后自动关联。";
    return `<label>与对方计划的关系<select data-field="linkedRuleId" aria-label="与对方计划的关系">${options(choices, value)}</select></label><small>${esc(other && !other.error ? note : "选择本空间收付款角色后，可关联对方计划；外部收支不参与关联。")}</small>`;
  }
  const entryStatus = (e) => ({ unconfigured: "未设置资产，未扣款", insufficient: e.transferId ? "付款方余额不足，未转账" : "余额不足，未扣款",
    missing_counterparty: "关联角色已移走，未记账", ambiguous_counterparty: "同名人物不明确，未记账", self_counterparty: "不能给自己转账，未记账" }[e.status]);
  function renderForm(form) {
    draftCache = form;
    screen.querySelector("#cw-editor").innerHTML = `<section class="cw-panel cw-form"><h3>资产与定期收支</h3>${input("cw-job", "身份 / 工作", form.job || "")}${input("cw-family", "家庭条件依据", form.family || "")}${input("cw-cash", account.bound ? "可用余额（会同步空间钱包）" : "可用余额", form.balance, "number")}${input("cw-assets", "其他资产估值（不能直接消费）", form.otherAssets || 0, "number")}${input("cw-note", "计划说明 / 拟定依据", form.note || "")}<label><input id="cw-auto" type="checkbox" ${form.automatic !== false ? "checked" : ""}>随空间时间自动结算</label><p>工资可每月发；生活开销可每天或每周按金额范围浮动。月末不足31日按当月最后一天。给本空间角色的生活费等会同步扣付款方、加收款方，并生成双方账单，两边都设置同一笔时会关联成一个计划；旧计划有差异时以付款方为准，保存任意一边会同步对方的金额、日期和时刻。同两人之间不同款项可选择独立结算。改计划不回溯发钱。</p><div id="cw-rules">${(form.rules || []).map((r, i) => `<div class="cw-rule" data-rule-id="${esc(r.id || crypto.randomUUID())}"><input data-field="label" aria-label="收支名称" value="${esc(r.label)}"><input data-field="category" aria-label="分类" value="${esc(r.category || "other")}"><select data-field="direction" aria-label="收支方向">${options([["income", "收入"], ["expense", "支出"]], r.direction)}</select><label>关联收付款角色<select data-field="counterpartyKey" aria-label="关联收付款角色">${counterpartOptions(r)}</select></label><input type="hidden" data-field="counterpartyName" value="${esc(r.counterpartyName || "")}"><small>支出＝给对方，收入＝从对方收款；空选项按计划名称识别。${r.counterpartyName ? "原计划指定：" + esc(r.counterpartyName) : ""}</small>${renderRuleLink(r)}<select data-field="cadence" aria-label="结算周期">${options([["monthly", "每月"], ["weekly", "每周"], ["daily", "每天"]], r.cadence)}</select><label>月几日 / 周几（0周日）<input data-field="day" type="number" min="0" max="31" value="${r.day ?? 1}"></label><label>几点结算<input data-field="hour" type="number" min="0" max="23" value="${r.hour ?? 9}"></label><label>金额下限<input data-field="min" type="number" min="0.01" step="0.01" value="${r.min ?? r.amount}"></label><label>金额上限<input data-field="max" type="number" min="0.01" step="0.01" value="${r.max ?? r.amount ?? r.min}"></label><label><input data-field="enabled" type="checkbox" ${r.enabled !== false ? "checked" : ""}>启用</label><button data-cw-action="remove-rule" data-index="${i}">移除这项计划</button></div>`).join("")}</div><button data-cw-action="add-rule">添加收支计划</button> <button data-cw-action="save">保存资产与计划</button> <button data-cw-action="cancel-edit">取消</button></section>`;
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
        const targets = (await Promise.all(people.filter((p) => all || p.key === key).map(async (p) => ({ ...p, account: await service.account(p.key) })))).filter((p) => !all || !p.account.configured).slice(0, 30);
        if (!targets.length) { message = "所有角色都已经设置，未覆盖已有资产和计划。"; return; }
        const raw = await window.EPhoneMarketAdapter.generate(core.profilePrompt(targets, people), controller.signal); controller.signal.throwIfAborted();
        const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
        if (!Array.isArray(parsed) || parsed.length !== targets.length || new Set(parsed.map((p) => p.key)).size !== parsed.length || targets.some((p) => !parsed.some((r) => r.key === p.key))) throw new Error("返回的人物钱包不完整，未修改，请重试。");
        const clean = parsed.map((p) => ({ ...core.normalize(p), key: p.key }));
        if (all) {
          // One transaction for the whole generated set: partial saves are not a successful initialization.
          mutating = true;
          try { await service.db.transaction("rw", ...service.tables(), service.chats, service.npcs, async () => {
            for (const draft of clean) { const a = targets.find((p) => p.key === draft.key).account; await service.save(draft.key, draft, now(), a.revision, { preserveBalance: a.bound || a.balance > 0 }); }
          }); } finally { mutating = false; }
          editing = false; message = `已初始化${clean.length}个未设置角色；工资、资产与消费均为人设拟定，可编辑。已有余额保留，未回溯结算。`; await load();
        } else {
          const draft = clean[0]; if (account.bound || account.configured || account.balance > 0) draft.balance = account.balance;
          draftCache = draft; editing = true; render(); message = "已拟定，请检查资产、工资与日常开销，点击保存后才生效。已有余额没有被生成结果覆盖。";
        }
      } finally { controller = null; }
    }, { generation: true });
  }
  window.EPhoneCharacterWallet = { open, sync, isBusy: () => busy, isMutating: () => mutating };
  document.addEventListener("DOMContentLoaded", () => {
    for (const id of ["me-character-wallet-button", "alipay-character-wallet-button"]) document.getElementById(id)?.addEventListener("click", () => open().catch((error) => { message = error.message; render(); }));
  });
})();
