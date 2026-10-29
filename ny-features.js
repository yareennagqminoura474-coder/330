(function () {
  "use strict";
  const pending = new Map(), summaries = new Map();
  const database = () => window.db.spaceProfiles.db;
  const rowId = (chatId) => "ny:feature-summary:" + chatId;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c.charCodeAt(0) === 34 ? "&quot;" : "&#39;");
  const text = (value) => typeof value === "string" ? value : "";
  const rows = (chat) => (chat.history || []).filter((r) => !r.isHidden && r.type !== "thought_chain");
  const stamp = (r) => JSON.stringify([r.timestamp, r.role, r.type, r.content, r.vts, r.senderName]);
  const basis = (chat) => rows(chat).map(stamp);
  const same = (old, chat) => { const current = new Set(basis(chat)); return Array.isArray(old?.basis) && old.basis.every((s) => current.has(s)); };
  const signature = (config) => JSON.stringify([config?.state.enabled, config?.state.packId, config?.pack.id, config?.features.summaries.map((p) => [p.id, p.content])]);
  const liveSettings = async (config, chatId, db) => { const state = await window.EPhoneNY.getState(chatId, db); return { state, pack: config.pack, features: window.EPhoneNyCore.features(config.pack, state) }; };
  const revision = (row) => row ? JSON.stringify([row.timestamp, row.content, row.basis]) : "";
  const refresh = () => { Promise.resolve(window.EPhoneNY?.refreshView?.()).catch(() => {}); };

  function extract(items) {
    const extra = {};
    for (const item of items || []) {
      const value = item?.ny_extra; if (!value || typeof value !== "object") continue;
      if (Array.isArray(value.options)) extra.options = value.options.map((o) => typeof o === "string" ? o : text(o?.text)).filter((s) => s.trim());
      if (text(value.translation?.content).trim()) extra.translation = { language: text(value.translation.language), content: value.translation.content };
      if (text(value.panel_html).trim()) { extra.panel_html = value.panel_html; extra.title = text(value.title) || "剧情互动界面"; }
    }
    return extra;
  }
  async function capture(controller, raw, chatId) {
    if (!controller) return;
    controller.nyExtra = {};
    const db = database();
    try {
      const config = await window.EPhoneNY.configuration(chatId, db);
      if (!config?.state.enabled || controller.signal?.aborted) return;
      const allowed = config.features, received = extract(window.ephoneChatResponse.recover(raw));
      if (allowed.options && received.options) controller.nyExtra.options = received.options;
      if (allowed.translation && received.translation) controller.nyExtra.translation = received.translation;
      if (allowed.panel && received.panel_html) { controller.nyExtra.panel_html = received.panel_html; controller.nyExtra.title = received.title; }
      controller.nyFeatureSource = { db, chatId };
    } catch (error) { console.warn("NY 附加界面未影响正文：", error.message); }
  }
  function finish(chat, controller) {
    // A stopped playback must not reveal options or panels from its unseen end.
    if (!controller?.nyPlaybackComplete || !controller?.ephoneRoundId || controller.signal?.aborted || controller.nyFeatureSource?.db !== database() || controller.nyFeatureSource?.chatId !== chat.id || !Object.keys(controller.nyExtra || {}).length) return;
    const message = (chat.history || []).findLast((r) => r.ephoneReplyRoundId === controller.ephoneRoundId && !r.isReplyHeader);
    if (message) { message.nyFeatures = { ...controller.nyExtra, sourceContent: message.content }; schedule(); }
  }
  function draft(value) {
    if (window.isEPhoneTimeChangeBusy?.()) return;
    const watch = document.querySelector('#chat-interface-screen.active .ephone-spectator-compose textarea');
    const input = watch || document.querySelector('#chat-interface-screen.active #chat-input');
    if (!input || !value) return;
    input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus();
  }
  function frameDocument(source) {
    const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
    // The original slash-command host is replaced with a draft-only bridge.
    // Sandboxing excludes same-origin access, forms, popups and top navigation.
    const bridge = `<script>window.STscript=async function(s){if(typeof s!=='string'||!/^\\/(?:send|sendas)\\s/.test(s))return '';var t=s.replace(/^\\/\\w+\\s*/, '').replace(/^(?:(?:name|compact)=(?:"[^"]*"|'[^']*'|\\S+)\\s*)+/, '').split(/\\s+\\|\\s*\\/trigger/)[0];parent.postMessage({type:'ephone-ny-draft',text:t},'*');return t;};<\/script>`;
    const inner = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="' + esc(csp) + '">' + bridge + source;
    // A trusted outer document owns the inner frame. Its frame-src policy also
    // blocks the generated document from navigating itself to an external URL;
    // a sandbox on a single frame alone would still permit that navigation.
    const outerCsp = csp + "; frame-src about: data: blob:";
    const literal = JSON.stringify(inner).replace(/</g, "\\u003c");
    return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="' + esc(outerCsp) + '"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style><iframe title="互动内容" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><script>const contentFrame=document.querySelector("iframe");contentFrame.srcdoc=' + literal + ';window.addEventListener("message",function(event){if(event.source===contentFrame.contentWindow&&event.data?.type==="ephone-ny-draft"&&typeof event.data.text==="string")parent.postMessage({type:"ephone-ny-draft",text:event.data.text},"*");});<\/script>';
  }
  function paint() {
    const host = document.querySelector("#chat-interface-screen.active #chat-messages"), chat = window.EPhoneNyAdapter?.currentChat?.();
    if (!host || !chat) return;
    const source = new Map((chat.history || []).map((m) => [String(m.timestamp), m]));
    for (const section of host.querySelectorAll(".ny-reply-features")) {
      const message = source.get(section.dataset.nyTimestamp), data = message?.nyFeatures;
      if (!data || data.sourceContent !== message.content || section.dataset.nyContent !== JSON.stringify(data)) section.remove();
    }
    const rendered = new Map();
    for (const bubble of host.querySelectorAll("[data-timestamp]")) if (!rendered.has(String(bubble.dataset.timestamp))) rendered.set(String(bubble.dataset.timestamp), bubble.closest(".message-wrapper"));
    for (const message of chat.history || []) {
      const data = message.nyFeatures; if (!data || data.sourceContent !== message.content) continue;
      const row = rendered.get(String(message.timestamp)); if (!row || row.querySelector(".ny-reply-features")) continue;
      const section = document.createElement("section"); section.className = "ny-reply-features";
      section.dataset.nyTimestamp = String(message.timestamp); section.dataset.nyContent = JSON.stringify(data);
      if (data.options?.length) {
        const title = document.createElement("strong"); title.textContent = "接下来可以…"; section.append(title);
        for (const value of data.options) { const button = document.createElement("button"); button.type = "button"; button.textContent = value; button.onclick = (e) => { e.stopPropagation(); draft(value); }; section.append(button); }
        const help = document.createElement("small"); help.textContent = "点击选项填入输入框，可以修改后发送。"; section.append(help);
      }
      if (data.translation) {
        const details = document.createElement("details"), title = document.createElement("summary"), body = document.createElement("div");
        title.textContent = (data.translation.language || "外文") + "版本"; body.textContent = data.translation.content; details.append(title, body); section.append(details);
      }
      if (data.panel_html) {
        const details = document.createElement("details"), title = document.createElement("summary"), frame = document.createElement("iframe"), help = document.createElement("small");
        title.textContent = data.title; frame.setAttribute("sandbox", "allow-scripts"); frame.setAttribute("referrerpolicy", "no-referrer"); frame.title = data.title; frame.srcdoc = frameDocument(data.panel_html);
        help.textContent = "界面里的发送或选择会填入原聊天输入框，可以修改后发送。"; details.append(title, help, frame); section.append(details);
        pending.set(frame, { chatId: chat.id });
      }
      row.append(section);
    }
    for (const frame of pending.keys()) if (!frame.isConnected) pending.delete(frame);
  }
  let scheduled = false;
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; paint(); }); } }
  window.addEventListener("message", (event) => {
    if (event.data?.type !== "ephone-ny-draft" || typeof event.data.text !== "string") return;
    const found = [...pending.entries()].find(([frame]) => frame.isConnected && frame.contentWindow === event.source);
    if (found && found[1].chatId === window.EPhoneNyAdapter?.currentChatId()) draft(event.data.text);
  });
  async function readSummary(chatId, db = database()) {
    const [saved, chat, config] = await Promise.all([db.spaceProfiles.get(rowId(chatId)), db.chats.get(chatId), window.EPhoneNY.configuration(chatId, db)]);
    if (!saved) return null;
    return { ...saved, valid: !!(chat && config?.state.enabled && config?.features.summaries.length && saved.packId === config.pack.id && same(saved, chat)) };
  }
  async function summaryContext(chat, config, db = database()) {
    if (!config?.state.enabled || !config?.features.summaries.length) return "";
    const saved = await db.spaceProfiles.get(rowId(chat.id));
    return saved?.packId === config.pack.id && same(saved, chat) ? "\n# NY 附加剧情总结\n" + saved.content : "";
  }
  async function saveSummary(chatId, content, db = database()) {
    if (!text(content).trim()) throw new Error("总结不能为空。原总结保留。");
    if (isBusy(chatId, db)) throw new Error("请先停止本聊天的附加总结，再编辑保存。");
    const config = await window.EPhoneNY.configuration(chatId, db);
    if (!config?.state.enabled || !config.features.summaries.length) throw new Error("请先开启本聊天的 NY 总结条目。");
    return db.transaction("rw", db.spaceProfiles, db.chats, async () => {
      const old = await db.spaceProfiles.get(rowId(chatId)), chat = await db.chats.get(chatId), current = await liveSettings(config, chatId, db);
      if (!old || !chat || old.packId !== config.pack.id || !same(old, chat)) throw new Error("总结来源已修改、删除或切换，请先重新生成总结。");
      if (signature(config) !== signature(current)) throw new Error("总结设置已改变，原总结保留。");
      const next = { ...old, content, timestamp: Date.now() }; await db.spaceProfiles.put(next); return { ...next, valid: true };
    });
  }
  function afterReply(chatId, db = database()) {
    const key = db.name + ":" + chatId;
    if (summaries.has(key)) { const ticket = summaries.get(key); ticket.dirty = true; return ticket.promise; }
    const controller = new AbortController(), ticket = { db, chatId, controller };
    // Reserve before any await so duplicate notifications share the same work.
    summaries.set(key, ticket);
    ticket.promise = (async () => {
      const config = await window.EPhoneNY.configuration(chatId, db);
      controller.signal.throwIfAborted();
      if (!config?.state.enabled || !config.features.summaries.length) return;
      refresh();
      const chat = await db.chats.get(chatId); if (!chat) return;
      const id = rowId(chatId), old = await db.spaceProfiles.get(id), source = rows(chat), currentBasis = basis(chat);
      ticket.sourceBasis = currentBasis;
      if (!source.length || old?.packId === config.pack.id && JSON.stringify(old.basis) === JSON.stringify(currentBasis)) return;
      const previous = old?.packId === config.pack.id && same(old, chat) ? old : null;
      const scope = config.features.summaries.some((p) => /当前楼层/.test(p.name)) && !config.features.summaries.some((p) => /全篇/.test(p.name)) ? "本轮" : "全篇";
      const seen = new Set(previous?.basis || []), fresh = source.filter((r) => !seen.has(stamp(r)));
      const lastRound = source.at(-1)?.ephoneReplyRoundId;
      const context = scope === "本轮" && lastRound ? source.filter((r) => r.ephoneReplyRoundId === lastRound) : fresh;
      const instructions = config.features.summaries.map((p) => p.content).join("\n\n");
      const raw = await window.EPhoneMarketAdapter.generateMessages([{ role: "system", content: "按下面原条目的内容要求整理客观剧情总结。小手机会保存结果，不使用原条目中的 details/HTML 外壳；只返回 {\"summary\":\"完整总结\"}。不得添加未发生事实。已有总结与新增聊天合并成完整更新版本，不丢弃旧事实。\n" + instructions },
        { role: "user", content: JSON.stringify({ previous: previous?.content || "", scope, messages: context.map((r) => ({ name: r.senderName, role: r.role, type: r.type, content: r.content, vts: r.vts })) }) }], controller.signal);
      controller.signal.throwIfAborted();
      let content = text(raw); try { const data = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); if (typeof data.summary === "string") content = data.summary; } catch {}
      if (!content.trim()) throw new Error("附加总结为空，保留原内容。");
      const finishConfig = await window.EPhoneNY.configuration(chatId, db);
      if (signature(config) !== signature(finishConfig)) return;
      await db.transaction("rw", db.spaceProfiles, db.chats, async () => {
        controller.signal.throwIfAborted();
        const saved = await db.chats.get(chatId), current = await db.spaceProfiles.get(id), freshConfig = await liveSettings(config, chatId, db);
        if (!saved || !same({ basis: currentBasis }, saved) || signature(config) !== signature(freshConfig) || revision(old) !== revision(current)) return;
        await db.spaceProfiles.put({ id, kind: "ny-feature-summary", packId: config.pack.id, content, basis: currentBasis, timestamp: Date.now() });
      });
    })().catch((error) => { if (error.name !== "AbortError") console.warn("NY 附加总结未覆盖原内容：", error.message); }).finally(async () => {
      // A genuinely newer completed round queues its own update. Repeated
      // notifications for the same history do not create another API request.
      let follow = false;
      try { if (ticket.dirty && !controller.signal.aborted && ticket.sourceBasis) { const latest = await db.chats.get(chatId); follow = !!latest && JSON.stringify(basis(latest)) !== JSON.stringify(ticket.sourceBasis); } }
      catch (error) { console.warn("NY 后续总结暂未启动：", error.message); }
      if (summaries.get(key) === ticket) summaries.delete(key);
      if (follow && !controller.signal.aborted) return afterReply(chatId, db);
      refresh();
    });
    return ticket.promise;
  }
  function isBusy(chatId, db = database()) { return [...summaries.values()].some((ticket) => !chatId || ticket.db === db && ticket.chatId === chatId); }
  function stop(chatId, db = database()) { for (const ticket of summaries.values()) if (!chatId || ticket.db === db && ticket.chatId === chatId) { ticket.dirty = false; ticket.controller.abort(); } }
  window.EPhoneNYFeatures = { capture, finish, extract, paint: schedule, summaryContext, afterReply, readSummary, saveSummary, isBusy, stop };
  document.addEventListener("DOMContentLoaded", () => {
    const host = document.getElementById("chat-messages"); if (host) new MutationObserver(schedule).observe(host, { childList: true, subtree: true });
  });
})();
