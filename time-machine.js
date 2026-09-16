(function () {
  "use strict";

  const STORAGE_KEY = "ephone_time_machine_v1";
  const MODES = Object.freeze({ REAL: "real", CUSTOM: "custom" });
  const FLOWS = Object.freeze({ FLOW: "flow", FROZEN: "frozen" });
  let activeChatId = null;
  let activeBinding = null;
  let configs = loadConfigs();
  let clockTimer = null;

  function loadConfigs() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      console.warn("时间轴配置读取失败：", error);
      return {};
    }
  }

  function normalizeConfig(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      mode:
        source.mode === MODES.CUSTOM || source.timeMode === MODES.CUSTOM
          ? MODES.CUSTOM
          : MODES.REAL,
      flow:
        source.flow === FLOWS.FROZEN || source.customTimeFlow === FLOWS.FROZEN
          ? FLOWS.FROZEN
          : FLOWS.FLOW,
      anchorRealMs: finiteOrNull(
        source.anchorRealMs ?? source.customAnchorRealMs,
      ),
      anchorVirtualMs: finiteOrNull(
        source.anchorVirtualMs ?? source.customAnchorVirtualMs,
      ),
      frozen:
        source.frozen && typeof source.frozen === "object"
          ? { ...source.frozen }
          : {},
    };
  }

  function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function persistConfigs() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  }

  function getConfig(chatId = activeChatId) {
    if (!chatId) return normalizeConfig();
    if (!configs[chatId]) configs[chatId] = normalizeConfig();
    return configs[chatId];
  }

  function virtualNow(config, realNow = Date.now()) {
    if (
      config.mode !== MODES.CUSTOM ||
      !Number.isFinite(config.anchorRealMs) ||
      !Number.isFinite(config.anchorVirtualMs)
    ) {
      return realNow;
    }
    return config.flow === FLOWS.FROZEN
      ? config.anchorVirtualMs
      : config.anchorVirtualMs + (realNow - config.anchorRealMs);
  }

  function nowMs(chatId = activeChatId) {
    return virtualNow(getConfig(chatId));
  }

  function nowDate(chatId = activeChatId) {
    return new Date(nowMs(chatId));
  }

  function parseTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed =
      typeof value === "string" ? Date.parse(value) : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function resolveWithConfig(value, config) {
    const timestamp = parseTimestamp(value);
    if (!Number.isFinite(timestamp) || config.mode !== MODES.CUSTOM)
      return timestamp;
    const frozen = Number(config.frozen[String(timestamp)]);
    if (Number.isFinite(frozen)) return frozen;
    if (
      !Number.isFinite(config.anchorRealMs) ||
      !Number.isFinite(config.anchorVirtualMs)
    ) {
      return timestamp;
    }
    return config.flow === FLOWS.FROZEN
      ? config.anchorVirtualMs
      : config.anchorVirtualMs + (timestamp - config.anchorRealMs);
  }

  function resolveTimestamp(value, chatId = activeChatId) {
    return resolveWithConfig(value, getConfig(chatId));
  }

  function messageTime(message, chatId = activeChatId) {
    if (!message) return null;
    const config = getConfig(chatId);
    if (config.mode !== MODES.CUSTOM)
      return parseTimestamp(message.timestamp ?? message.time);
    if (Number.isFinite(Number(message.vts))) return Number(message.vts);
    return resolveWithConfig(message.timestamp ?? message.time, config);
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatDateTime(milliseconds, options = {}) {
    if (!Number.isFinite(milliseconds)) return "";
    const date = new Date(milliseconds);
    let output = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (options.withWeekday) {
      output += ` 周${["日", "一", "二", "三", "四", "五", "六"][date.getDay()]}`;
    }
    if (options.direction === "backward") output = `⏪ ${output}`;
    if (options.direction === "forward") output = `⏩ ${output}`;
    return output;
  }

  function toDateTimeLocal(milliseconds) {
    const date = new Date(milliseconds);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fromChatSettings(settings) {
    if (!settings || typeof settings !== "object") return null;
    if (!settings.timeMode && !settings.customAnchorVirtualMs) return null;
    return normalizeConfig({
      timeMode: settings.timeMode,
      customTimeFlow: settings.customTimeFlow,
      customAnchorRealMs: settings.customAnchorRealMs,
      customAnchorVirtualMs: settings.customAnchorVirtualMs,
      frozen: settings.virtualTimeFrozenMap,
    });
  }

  function freezeCollection(collection, config) {
    if (!Array.isArray(collection) || config.mode !== MODES.CUSTOM) return;
    collection.forEach((item) => {
      if (!item || item.type === "time_marker") return;
      const realTimestamp = parseTimestamp(item.timestamp ?? item.time);
      if (!Number.isFinite(realTimestamp)) return;
      const value = Number.isFinite(Number(item.vts))
        ? Number(item.vts)
        : resolveWithConfig(realTimestamp, config);
      if (!Number.isFinite(value)) return;
      item.vts = value;
      config.frozen[String(realTimestamp)] = value;
    });
  }

  function clearVirtualCollection(collection) {
    if (!Array.isArray(collection)) return;
    collection.forEach((item) => {
      if (!item || item.type === "time_marker") return;
      delete item.vts;
    });
  }

  function freezeActiveRecords(config) {
    if (!activeBinding || activeBinding.id !== activeChatId) return;
    freezeCollection(activeBinding.getMessages?.(), config);
    freezeCollection(activeBinding.getMemories?.(), config);
  }

  function clearActiveVirtualRecords() {
    if (!activeBinding || activeBinding.id !== activeChatId) return;
    clearVirtualCollection(activeBinding.getMessages?.());
    clearVirtualCollection(activeBinding.getMemories?.());
  }

  async function saveActive(config, refresh) {
    configs[activeChatId] = normalizeConfig(config);
    persistConfigs();
    await activeBinding?.applyConfig?.(configs[activeChatId]);
    updateUi();
    if (refresh) await activeBinding?.refresh?.();
  }

  async function useRealTime() {
    if (!activeChatId) return;
    const config = getConfig();
    if (config.mode === MODES.CUSTOM) freezeActiveRecords(config);
    config.mode = MODES.REAL;
    await saveActive(config, true);
  }

  async function jumpTo(milliseconds, flow) {
    if (!activeChatId || !Number.isFinite(milliseconds)) return;
    const config = getConfig();
    const before = virtualNow(config);

    if (config.mode === MODES.CUSTOM) {
      freezeActiveRecords(config);
    } else {
      clearActiveVirtualRecords();
      config.frozen = {};
    }

    const realNow = Date.now();
    config.mode = MODES.CUSTOM;
    config.flow = flow === FLOWS.FROZEN ? FLOWS.FROZEN : FLOWS.FLOW;
    config.anchorRealMs = realNow;
    config.anchorVirtualMs = milliseconds;

    const direction =
      milliseconds < before
        ? "backward"
        : milliseconds > before
          ? "forward"
          : null;
    const markerText = formatDateTime(milliseconds, {
      withWeekday: true,
      direction,
    });
    const marker = {
      role: "system",
      senderName: "时间",
      type: "time_marker",
      content: markerText,
      contextText: `🕐 ${markerText}`,
      includeInContext: true,
      timestamp: realNow,
      vts: milliseconds,
    };
    const history = activeBinding?.getMessages?.();
    if (Array.isArray(history)) history.push(marker);
    config.frozen[String(realNow)] = milliseconds;
    await saveActive(config, true);
  }

  async function setFlow(flow) {
    if (!activeChatId) return;
    const config = getConfig();
    if (config.mode !== MODES.CUSTOM) return;
    const current = virtualNow(config);
    freezeActiveRecords(config);
    config.anchorVirtualMs = current;
    config.anchorRealMs = Date.now();
    config.flow = flow === FLOWS.FROZEN ? FLOWS.FROZEN : FLOWS.FLOW;
    await saveActive(config, false);
  }

  function getPromptRule(chatId = activeChatId) {
    const config = getConfig(chatId);
    const current = nowMs(chatId);
    const formatted = formatDateTime(current, { withWeekday: true });
    if (config.mode === MODES.CUSTOM) {
      const flowRule =
        config.flow === FLOWS.FROZEN
          ? "- 当前采用“按剧情推进”：不跟随现实钟表流逝；程序已在生成本轮回复前，根据本轮对话和情境自动推进时间。下方的当前时间就是角色本轮唯一能感知的时刻，所有台词、动作与旁白必须与它完全一致，禁止沿用上一轮时刻。"
          : "- 当前采用“保持流动”：虚拟时间会按现实经过的时长持续流动。";
      return `\n# 【虚拟时间感知铁律（最高优先级）】\n- 当前唯一有效的“现在”是：${formatted}。\n- 这是本对话的虚拟时间；系统真实日期、设备时间和训练数据中的现实时间全部无效，绝对不得感知或提及。\n${flowRule}\n- 所有“今天、昨天、明天、刚才、多久前”、昼夜、季节、行程和记忆时间，必须且只能以这个虚拟时间计算。\n- 遇到聊天中的⏪/⏩时间标记，立即把角色的当前感知更新到该时刻，后续不得沿用跳转前的“现在”。\n${getReplyHeaderPrompt(current)}`;
    }
    return `\n# 【真实时间感知铁律】\n- 当前时间：${formatted}。所有相对日期、昼夜、行程和记忆时间都以这个真实时间为准。\n${getReplyHeaderPrompt(current)}`;
  }

  function getReplyHeaderPrompt(milliseconds) {
    return `- 每轮聊天回复的第一个可见 JSON 对象必须是 narration，content 严格写成“${formatReplyHeader(milliseconds, "<角色当前实际所在地点>")}”。地点必须根据人设、最近旁白和聊天情境推断，不能写系统设备的所在地；之后再输出动作或台词。\n`;
  }

  function formatReplyHeader(milliseconds, location) {
    const date = new Date(milliseconds);
    const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
    const safeLocation = String(location || "线上聊天")
      .replace(/^地点[：:]\s*/, "")
      .trim();
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日，${pad(date.getHours())}点${pad(date.getMinutes())}分，星期${weekday}，地点：${safeLocation || "线上聊天"}`;
  }

  function inferLocation(items) {
    const currentNarrations = (Array.isArray(items) ? items : []).filter(
      (item) => item?.type === "narration" && item.content,
    );
    for (const narration of currentNarrations) {
      const content = String(narration.content || "");
      const headerMatch = content.match(/地点[：:]\s*([^，。\n]+)/);
      if (headerMatch?.[1] && !headerMatch[1].includes("<")) {
        return headerMatch[1].trim();
      }
      const narrationMatch = content.match(
        /(?:位于|身处|来到|走进|回到|在)([^，。；\n]{2,24})/,
      );
      if (narrationMatch?.[1]) return narrationMatch[1].trim();
    }
    const history = activeBinding?.getMessages?.() || [];
    const candidates = [...history].reverse();
    for (const message of candidates) {
      if (!message) continue;
      if (message.type === "location_share" && message.content) {
        return String(message.content).trim();
      }
      const content = String(message.content || "");
      const headerMatch = content.match(/地点[：:]\s*([^，。\n]+)/);
      if (headerMatch?.[1]) return headerMatch[1].trim();
    }
    const settings = activeBinding?.settings || {};
    return (
      settings.currentLocation ||
      settings.sceneLocation ||
      settings.location ||
      settings.scenarioLocation ||
      "线上聊天"
    );
  }

  function replyAdvanceMinutes(items) {
    const visible = (Array.isArray(items) ? items : []).filter(
      (item) => item && item.type !== "thought_chain",
    );
    const text = visible
      .map((item) =>
        [
          item.content,
          item.message,
          item.dialogue,
          item.description,
          item.reply_content,
        ]
          .filter(Boolean)
          .join(" "),
      )
      .join(" ");
    let minutes = 1;
    minutes += Math.min(4, Math.floor(Math.max(0, visible.length - 1) / 2));
    minutes += Math.min(4, Math.floor(text.length / 120));
    if (visible.some((item) => item.type === "narration" || item.type === "offline_text")) {
      minutes += 2;
    }
    if (/(起身|坐下|开门|关门|拿起|放下|走到|收拾|换衣|洗漱|泡茶|做饭)/.test(text)) {
      minutes += 2;
    }
    if (/(吃饭|午餐|晚餐|早餐|洗澡|做完|结束|写完|看完|会议)/.test(text)) {
      minutes += 5;
    }
    if (/(出门|到达|赶到|开车|打车|地铁|公交|回家|去往|前往|路上)/.test(text)) {
      minutes += 8;
    }
    if (/(过了一会|片刻后|稍后|不久后|转眼|场景|天色)/.test(text)) {
      minutes += 4;
    }
    const explicitMinutes = [...text.matchAll(/(\d{1,2})\s*分钟/g)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (explicitMinutes.length) minutes = Math.max(minutes, Math.max(...explicitMinutes));
    let hash = 0;
    for (let index = 0; index < text.length; index++) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    minutes += hash % 3;
    return Math.max(1, Math.min(25, Math.round(minutes)));
  }

  function advanceFrozenForReply(items) {
    const config = getConfig();
    if (config.mode !== MODES.CUSTOM || config.flow !== FLOWS.FROZEN) return 0;
    freezeActiveRecords(config);
    const minutes = replyAdvanceMinutes(items);
    config.anchorVirtualMs = virtualNow(config) + minutes * 60 * 1000;
    config.anchorRealMs = Date.now();
    configs[activeChatId] = normalizeConfig(config);
    persistConfigs();
    Promise.resolve(activeBinding?.applyConfig?.(configs[activeChatId])).catch(
      (error) => console.warn("剧情时间保存失败：", error),
    );
    updateUi();
    return minutes;
  }

  function latestReplyContext(history) {
    if (!Array.isArray(history)) return [];
    const latestUserMessage = [...history]
      .reverse()
      .find(
        (item) =>
          item &&
          item.role === "user" &&
          !item.isHidden &&
          item.type !== "time_marker",
      );
    if (!latestUserMessage) return [];
    const recentContext = history
      .filter(
        (item) =>
          item &&
          !item.isHidden &&
          item.type !== "time_marker" &&
          (item.role === "user" || item.role === "assistant"),
      )
      .slice(-3);
    return recentContext.includes(latestUserMessage)
      ? recentContext
      : [latestUserMessage];
  }

  function prepareReplyTime(history, options = {}) {
    const beforeMs = nowMs();
    const preparation = {
      chatId: activeChatId,
      beforeMs,
      afterMs: beforeMs,
      minutes: 0,
      changed: false,
    };
    if (options.advance === false || !activeChatId) return preparation;
    const minutes = advanceFrozenForReply(latestReplyContext(history));
    if (!minutes) return preparation;
    preparation.minutes = minutes;
    preparation.afterMs = nowMs();
    preparation.changed = true;
    return preparation;
  }

  async function rollbackPreparedReplyTime(preparation) {
    if (
      !preparation?.changed ||
      !activeChatId ||
      preparation.chatId !== activeChatId
    ) {
      return;
    }
    const config = getConfig();
    if (
      config.mode !== MODES.CUSTOM ||
      config.flow !== FLOWS.FROZEN ||
      config.anchorVirtualMs !== preparation.afterMs
    ) {
      return;
    }
    config.anchorVirtualMs = preparation.beforeMs;
    config.anchorRealMs = Date.now();
    await saveActive(config, false);
  }

  function ensureReplyHeader(items, options = {}) {
    if (!Array.isArray(items) || !activeChatId) return items;
    const chatTypes = new Set([
      "text",
      "narration",
      "voice_message",
      "sticker",
      "quote_reply",
      "offline_text",
      "ai_image",
      "naiimag",
      "realimag",
    ]);
    if (!items.some((item) => item && chatTypes.has(item.type || "text"))) {
      return items;
    }
    const advancedMinutes = Number.isFinite(Number(options.advancedMinutes))
      ? Number(options.advancedMinutes)
      : 0;
    const headerPattern = /^\d{4}年\d{1,2}月\d{1,2}日，\d{1,2}点\d{1,2}分，星期[日一二三四五六]，地点[：:]/;
    const existingIndex = items.findIndex(
      (item) => item?.type === "narration" && headerPattern.test(String(item.content || "")),
    );
    let location = inferLocation(items);
    if (existingIndex >= 0) {
      const match = String(items[existingIndex].content).match(/地点[：:]\s*(.+)$/);
      if (match?.[1] && !match[1].includes("<")) location = match[1].trim();
      items.splice(existingIndex, 1);
    }
    const header = {
      type: "narration",
      name: "时间",
      content: formatReplyHeader(nowMs(), location),
      isReplyHeader: true,
      vts: nowMs(),
      autoAdvancedMinutes: advancedMinutes,
    };
    const thoughtCount = items.findIndex((item) => item?.type !== "thought_chain");
    items.splice(thoughtCount < 0 ? items.length : thoughtCount, 0, header);
    return items;
  }

  function configForChatSettings(config) {
    return {
      timeMode: config.mode,
      customTimeFlow: config.flow,
      customAnchorRealMs: config.anchorRealMs,
      customAnchorVirtualMs: config.anchorVirtualMs,
      virtualTimeFrozenMap: config.frozen,
    };
  }

  function bindChat(binding) {
    if (!binding || !binding.id) return;
    activeChatId = String(binding.id);
    activeBinding = binding;
    const settingsConfig = fromChatSettings(binding.settings);
    configs[activeChatId] = normalizeConfig(
      settingsConfig || configs[activeChatId],
    );
    persistConfigs();
    updateUi();
  }

  function clearActiveChat() {
    activeChatId = null;
    activeBinding = null;
    updateUi();
  }

  function buildUi() {
    const button = document.getElementById("time-mode-btn");
    if (!button || document.getElementById("time-machine-modal")) return;
    const modal = document.createElement("div");
    modal.id = "time-machine-modal";
    modal.className = "time-machine-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="time-machine-card" role="dialog" aria-modal="true" aria-labelledby="time-machine-title">
        <div class="time-machine-title" id="time-machine-title">时间模式</div>
        <div class="time-machine-current" id="time-machine-current"></div>
        <div class="time-machine-tabs" role="radiogroup" aria-label="时间模式">
          <button type="button" data-time-mode="real">真实时间</button>
          <button type="button" data-time-mode="custom">虚拟时间</button>
        </div>
        <div id="time-machine-custom-options">
          <label class="time-machine-label" for="time-machine-datetime">跳转到时间</label>
          <input id="time-machine-datetime" type="datetime-local">
          <div class="time-machine-flow" role="radiogroup" aria-label="虚拟时间流速">
            <label><input type="radio" name="time-machine-flow" value="flow" checked><span><b>保持流动</b><small>现实过 10 分钟，虚拟时间也走 10 分钟</small></span></label>
            <label><input type="radio" name="time-machine-flow" value="frozen"><span><b>按剧情推进</b><small>不跟现实时间；每次回复按内容前进几分钟</small></span></label>
          </div>
          <p class="time-machine-hint">手动跳转会留下可见的时间标记；按剧情推进时也会自动走时。</p>
        </div>
        <div class="time-machine-actions">
          <button type="button" id="time-machine-cancel">取消</button>
          <button type="button" id="time-machine-confirm">确认</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    button.addEventListener("click", openModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
    modal
      .querySelector("#time-machine-cancel")
      .addEventListener("click", closeModal);
    modal.querySelectorAll("[data-time-mode]").forEach((modeButton) => {
      modeButton.addEventListener("click", () =>
        selectDraftMode(modeButton.dataset.timeMode),
      );
    });
    modal
      .querySelector("#time-machine-confirm")
      .addEventListener("click", async () => {
        const selected = modal.querySelector("[data-time-mode].active")?.dataset
          .timeMode;
        if (selected === MODES.REAL) {
          await useRealTime();
        } else {
          const value = modal.querySelector("#time-machine-datetime").value;
          const milliseconds = new Date(value).getTime();
          if (!Number.isFinite(milliseconds)) return;
          const flow = modal.querySelector(
            'input[name="time-machine-flow"]:checked',
          )?.value;
          await jumpTo(milliseconds, flow);
        }
        closeModal();
      });

    document
      .getElementById("back-to-list-btn")
      ?.addEventListener("click", clearActiveChat);
    clockTimer = setInterval(updateUi, 1000);
  }

  function selectDraftMode(mode) {
    const modal = document.getElementById("time-machine-modal");
    if (!modal) return;
    modal.querySelectorAll("[data-time-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.timeMode === mode);
    });
    modal.querySelector("#time-machine-custom-options").hidden =
      mode !== MODES.CUSTOM;
    modal.querySelector("#time-machine-confirm").textContent =
      mode === MODES.CUSTOM ? "跳转" : "使用真实时间";
  }

  function openModal() {
    if (!activeChatId) return;
    const modal = document.getElementById("time-machine-modal");
    const config = getConfig();
    selectDraftMode(config.mode);
    modal.querySelector("#time-machine-datetime").value =
      toDateTimeLocal(nowMs());
    const flowInput = modal.querySelector(
      `input[name="time-machine-flow"][value="${config.flow}"]`,
    );
    if (flowInput) flowInput.checked = true;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    const modal = document.getElementById("time-machine-modal");
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  function updateUi() {
    const button = document.getElementById("time-mode-btn");
    const current = document.getElementById("time-machine-current");
    if (!button) return;
    button.disabled = !activeChatId;
    if (!activeChatId) {
      button.classList.remove("virtual");
      button.title = "时间模式";
      return;
    }
    const config = getConfig();
    const formatted = formatDateTime(nowMs(), { withWeekday: true });
    const virtual = config.mode === MODES.CUSTOM;
    button.classList.toggle("virtual", virtual);
    button.title = virtual
      ? `虚拟时间：${formatted}`
      : `真实时间：${formatted}`;
    button.setAttribute("aria-label", button.title);
    if (current) {
      current.textContent = `${virtual ? "当前虚拟时间" : "当前真实时间"}：${formatted}`;
    }
  }

  window.ephoneTimeMachine = {
    MODES,
    FLOWS,
    bindChat,
    clearActiveChat,
    getConfig,
    nowMs,
    nowDate,
    resolveTimestamp,
    messageTime,
    formatDateTime,
    formatReplyHeader,
    ensureReplyHeader,
    prepareReplyTime,
    rollbackPreparedReplyTime,
    getPromptRule,
    configForChatSettings,
    jumpTo,
    useRealTime,
    setFlow,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildUi, { once: true });
  } else {
    buildUi();
  }
})();
