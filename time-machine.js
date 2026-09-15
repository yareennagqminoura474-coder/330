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
      return `\n# 【虚拟时间感知铁律（最高优先级）】\n- 当前唯一有效的“现在”是：${formatted}。\n- 这是本对话的虚拟时间；系统真实日期、设备时间和训练数据中的现实时间全部无效，绝对不得感知或提及。\n- 所有“今天、昨天、明天、刚才、多久前”、昼夜、季节、行程和记忆时间，必须且只能以这个虚拟时间计算。\n- 遇到聊天中的⏪/⏩时间标记，立即把角色的当前感知更新到该时刻，后续不得沿用跳转前的“现在”。\n`;
    }
    return `\n# 【真实时间感知铁律】\n- 当前时间：${formatted}。所有相对日期、昼夜、行程和记忆时间都以这个真实时间为准。\n`;
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
            <label><input type="radio" name="time-machine-flow" value="frozen"><span><b>完全静止</b><small>只有手动跳转时才改变</small></span></label>
          </div>
          <p class="time-machine-hint">每次跳转都会留下可见的时间标记，也可以回到过去。</p>
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
