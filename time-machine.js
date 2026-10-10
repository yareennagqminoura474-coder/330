(function () {
  "use strict";

  const STORAGE_KEY = "ephone_time_machine_v1";
  const MODES = Object.freeze({ REAL: "real", CUSTOM: "custom" });
  const FLOWS = Object.freeze({ FLOW: "flow", FROZEN: "frozen" });
  const SPACE_TIME_HINT = "本空间所有聊天共用时间。手动跳转仅在当前聊天留下标记，其他聊天静默同步。约定等待十/二十分钟后，说‘时间到了’会按约定推进。";
  let activeChatId = null;
  let activeBinding = null;
  let configs = loadConfigs();
  const durableConfigIds = new Set();
  let cacheWarningShown = false;
  let clockTimer = null;
  let spaceClock = null;
  let spaceTable = null;
  let spaceDatabaseName = null;
  const spaceWrites = new Map();

  function loadConfigs() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.fromEntries(Object.entries(parsed).map(([id, config]) => [id, normalizeConfig(config)]))
        : {};
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
      holdNextReply: source.holdNextReply === true || source.timeHoldNextReply === true,
      revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    };
  }

  function finiteOrNull(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function persistConfigs() {
    // IndexedDB chat settings/record vts are authoritative. Retain the legacy
    // maps of unopened chats until their database save has actually succeeded.
    const cache = Object.fromEntries(Object.entries(configs).map(([id, config]) => [
      id, durableConfigIds.has(id) ? { ...config, frozen: {} } : config,
    ]));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      cacheWarningShown = false;
    } catch (error) {
      if (!cacheWarningShown) {
        console.warn("辅助时间缓存无法写入；时间将随聊天保存在数据库中。", error);
        cacheWarningShown = true;
      }
    }
  }

  function recordsForBinding(binding) {
    return [...(binding?.getMessages?.() || []), ...(binding?.getMemories?.() || [])];
  }

  function rebuildFrozenIndex(binding, config) {
    // Timestamp-only UI callers still need an index, but it need not be stored
    // twice: rebuild it from message/memory vts whenever a chat is opened.
    for (const item of recordsForBinding(binding)) {
      const timestamp = parseTimestamp(item?.timestamp ?? item?.time);
      const virtualTimestamp = finiteOrNull(item?.vts);
      if (timestamp != null && virtualTimestamp != null)
        config.frozen[String(timestamp)] = virtualTimestamp;
    }
  }

  function databaseConfig(config, binding) {
    const snapshot = normalizeConfig(config);
    for (const item of recordsForBinding(binding)) {
      const timestamp = parseTimestamp(item?.timestamp ?? item?.time);
      const virtualTimestamp = finiteOrNull(item?.vts);
      if (timestamp != null && virtualTimestamp != null &&
          finiteOrNull(snapshot.frozen[String(timestamp)]) === virtualTimestamp)
        delete snapshot.frozen[String(timestamp)];
    }
    return snapshot;
  }

  async function persistToChat(binding, id, config) {
    if (typeof binding?.applyConfig !== "function") return;
    // The callback stores both updated records and settings in one chat row.
    // Only compact the old cache after that durable save, never before it.
    await binding.applyConfig(databaseConfig(config, binding));
    durableConfigIds.add(id);
    persistConfigs();
  }

  function getConfig(chatId = activeChatId) {
    if (!chatId) return spaceClock ? normalizeConfig(spaceClock) : normalizeConfig();
    if (!configs[chatId]) configs[chatId] = normalizeConfig();
    if (spaceClock) Object.assign(configs[chatId], { ...spaceClock, frozen: configs[chatId].frozen });
    return configs[chatId];
  }

  function setSpaceClock(config) {
    spaceClock = normalizeConfig({ ...config, frozen: {} });
    // Historical timestamp maps remain per chat, only the live clock is shared.
    for (const value of Object.values(configs)) Object.assign(value, { ...spaceClock, frozen: value.frozen });
  }

  function persistSpaceClock() {
    if (!spaceTable || !spaceClock) return Promise.resolve();
    const table = spaceTable, name = table.db.name;
    const snapshot = { ...spaceClock, frozen: {}, id: "main" };
    const write = (spaceWrites.get(name) || Promise.resolve()).catch(() => {}).then(() => table.put(snapshot));
    spaceWrites.set(name, write);
    // Callers that prepare a reply await the original promise and handle failure.
    write.catch((error) => console.warn("空间时间保存失败：", error));
    return write;
  }

  async function loadSpace(db) {
    await window.ephoneHolidayCalendar?.loadSpace(db);
    if (!db?.spaceClock) return;
    const table = db.spaceClock;
    if (spaceDatabaseName === table.db.name && spaceClock) return;
    await (spaceWrites.get(table.db.name) || Promise.resolve()).catch(() => {});
    let saved = await table.get("main");
    if (!saved) {
      const chats = await table.db.table("chats").toArray();
      // Choose the most recently adjusted existing clock deterministically,
      // rather than allowing whichever chat opens first to change space time.
      const candidates = chats.map((chat) => fromChatSettings(chat.settings) || configs[chat.id]).filter(Boolean);
      const latest = candidates.sort((a, b) => Number(b.anchorRealMs || 0) - Number(a.anchorRealMs || 0))[0];
      saved = { ...normalizeConfig(latest), frozen: {}, id: "main" };
      // Preserve each old chat's historical times before applying a shared clock.
      const migrated = [];
      for (const chat of chats) {
        const old = fromChatSettings(chat.settings) || configs[chat.id] || normalizeConfig();
        const config = normalizeConfig(old);
        if (preserveCollectionTimes(chat.history, config) + preserveCollectionTimes(chat.longTermMemory, config)) {
          migrated.push(chat);
        }
      }
      await table.db.transaction("rw", table, table.db.table("chats"), async () => {
        // Do not overwrite a clock another tab just initialized.
        const existing = await table.get("main");
        if (existing) { saved = existing; return; }
        if (migrated.length) await table.db.table("chats").bulkPut(migrated);
        await table.put(saved);
      });
    }
    spaceTable = table; spaceDatabaseName = table.db.name;
    activeChatId = null; activeBinding = null;
    setSpaceClock(saved); updateUi();
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
    if (value == null || value === "") return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed =
      typeof value === "string" ? Date.parse(value) : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function resolveWithConfig(value, config) {
    const timestamp = parseTimestamp(value);
    if (!Number.isFinite(timestamp) || config.mode !== MODES.CUSTOM)
      return timestamp;
    const frozen = finiteOrNull(config.frozen[String(timestamp)]);
    if (frozen != null) return frozen;
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
    const virtualTimestamp = finiteOrNull(message.vts);
    if (virtualTimestamp != null) return virtualTimestamp;
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
      holdNextReply: settings.timeHoldNextReply,
    });
  }

  function freezeCollection(collection, config) {
    if (!Array.isArray(collection) || config.mode !== MODES.CUSTOM) return 0;
    let changed = 0;
    collection.forEach((item) => {
      if (!item || item.type === "time_marker") return;
      const realTimestamp = parseTimestamp(item.timestamp ?? item.time);
      if (!Number.isFinite(realTimestamp)) return;
      const value = finiteOrNull(item.vts) != null
        ? Number(item.vts)
        : resolveWithConfig(realTimestamp, config);
      if (!Number.isFinite(value)) return;
      if (finiteOrNull(item.vts) !== value) changed++;
      item.vts = value;
      config.frozen[String(realTimestamp)] = value;
    });
    return changed;
  }

  function preserveCollectionTimes(collection, config) {
    if (!Array.isArray(collection)) return 0;
    let changed = 0;
    for (const item of collection) {
      if (!item || finiteOrNull(item.vts) != null) continue;
      const value = resolveWithConfig(item.timestamp ?? item.time, config);
      if (!Number.isFinite(value)) continue;
      item.vts = value; changed++;
    }
    return changed;
  }

  function clearVirtualCollection(collection) {
    if (!Array.isArray(collection)) return;
    collection.forEach((item) => {
      if (!item || item.type === "time_marker") return;
      delete item.vts;
    });
  }

  function freezeActiveRecords(config) {
    if (!activeBinding || String(activeBinding.id) !== activeChatId) return 0;
    return freezeCollection(activeBinding.getMessages?.(), config) +
      freezeCollection(activeBinding.getMemories?.(), config);
  }

  function clearActiveVirtualRecords() {
    if (!activeBinding || activeBinding.id !== activeChatId) return;
    clearVirtualCollection(activeBinding.getMessages?.());
    clearVirtualCollection(activeBinding.getMemories?.());
  }

  async function saveActive(config, refresh) {
    const chatId = activeChatId;
    const binding = activeBinding;
    configs[chatId] = normalizeConfig(config);
    setSpaceClock(configs[chatId]);
    await persistSpaceClock();
    await persistToChat(binding, chatId, configs[chatId]);
    if (activeChatId !== chatId || activeBinding !== binding) return;
    updateUi();
    if (refresh) await activeBinding?.refresh?.();
  }

  async function useRealTime() {
    if (!activeChatId) return;
    const config = getConfig();
    if (config.mode === MODES.CUSTOM) freezeActiveRecords(config);
    config.mode = MODES.REAL;
    config.anchorRealMs = Date.now();
    config.holdNextReply = false;
    config.revision++;
    await saveActive(config, true);
  }

  async function jumpTo(milliseconds, flow) {
    if (!activeChatId || !Number.isFinite(milliseconds)) return;
    const config = getConfig();
    const before = virtualNow(config);

    if (config.mode === MODES.CUSTOM) {
      freezeActiveRecords(config);
    } else {
      preserveCollectionTimes(activeBinding?.getMessages?.(), config);
      preserveCollectionTimes(activeBinding?.getMemories?.(), config);
      rebuildFrozenIndex(activeBinding, config);
    }

    const realNow = Date.now();
    config.mode = MODES.CUSTOM;
    config.flow = flow === FLOWS.FROZEN ? FLOWS.FROZEN : FLOWS.FLOW;
    config.anchorRealMs = realNow;
    config.anchorVirtualMs = milliseconds;
    config.holdNextReply = true;
    config.revision++;

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
    config.revision++;
    await saveActive(config, false);
  }

  function getPromptRule(chatId = activeChatId, currentMs = null) {
    const config = getConfig(chatId);
    const current = currentMs != null && Number.isFinite(Number(currentMs))
      ? Number(currentMs)
      : nowMs(chatId);
    const formatted = formatDateTime(current, { withWeekday: true });
    const weekdayRule = "- 凡写出具体年月日及星期几，星期必须按该日期的日历计算；不得凭印象编造，也不得把另一日期的星期套用到当前日期。\n";
    const holidayRule = window.ephoneHolidayCalendar?.prompt(current) || "";
    if (config.mode === MODES.CUSTOM) {
      const flowRule =
        config.flow === FLOWS.FROZEN
          ? "- 当前采用“按剧情推进”：不跟随现实钟表流逝；程序已确定本轮时间（刚手动跳转时保持指定时刻；其他轮次根据情境或已经到期的等待推进）。下方时间是本轮唯一的现在，所有台词、动作和旁白必须一致，不得自行再加几分钟。约定等十/二十分钟只是未来计划，不能当成立刻过完；用户说‘时间到了’才以约定到期时刻继续。"
          : "- 当前采用“保持流动”：虚拟时间会按现实经过的时长持续流动。";
      return `\n# 【虚拟时间感知铁律（最高优先级）】\n- 当前唯一有效的“现在”是：${formatted}。\n- 这是本空间所有聊天共用的虚拟时间；系统真实日期、设备时间和训练数据中的现实时间全部无效，绝对不得感知或提及。其他聊天中的时间调整也已同步到上面的当前时间，即使本聊天没有跳转提示，也必须遵守。\n${flowRule}\n- 所有“今天、昨天、明天、刚才、多久前”、昼夜、季节、行程和记忆时间，必须且只能以这个虚拟时间计算。\n- 聊天中的⏪/⏩时间标记是历史事件，不得用旧标记覆盖本轮当前时间。\n${weekdayRule}${getReplyHeaderPrompt(current)}${holidayRule}`;
    }
    return `\n# 【真实时间感知铁律】\n- 当前时间：${formatted}。所有相对日期、昼夜、行程和记忆时间都以这个真实时间为准。\n${weekdayRule}${getReplyHeaderPrompt(current)}${holidayRule}`;
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

  function normalizeWeekdayMentions(text, referenceMs = nowMs()) {
    if (typeof text !== "string") return text;
    const referenceDate = new Date(Number.isFinite(referenceMs) ? referenceMs : nowMs());
    const dateAndWeekday = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*(日|号)([^\n。年月日号]{0,80}?)(星期|周)\s*([日天一二三四五六])/g;
    let corrected = text.replace(dateAndWeekday, (match, yearText, monthText, dayText, daySuffix, middle, prefix, _statedWeekday, offset, source) => {
      let year = yearText ? Number(yearText) : referenceDate.getFullYear();
      if (!yearText) {
        const preceding = source.slice(Math.max(0, offset - 2), offset);
        if (preceding === "去年") year -= 1;
        if (preceding === "明年") year += 1;
      }
      const month = Number(monthText);
      const day = Number(dayText);
      const date = new Date(year, month - 1, day, 12);
      if (
        date.getFullYear() !== year ||
        date.getMonth() + 1 !== month ||
        date.getDate() !== day
      ) return match;
      const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
      return match.replace(/(星期|周)\s*[日天一二三四五六]$/, `$1${weekday}`);
    });
    corrected = corrected.replace(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})([^\n。]{0,80}?)(星期|周)\s*([日天一二三四五六])/g, (match, yearText, monthText, dayText, _middle, _prefix) => {
      const year = Number(yearText);
      const month = Number(monthText);
      const day = Number(dayText);
      const date = new Date(year, month - 1, day, 12);
      if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return match;
      const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
      return match.replace(/(星期|周)\s*[日天一二三四五六]$/, `$1${weekday}`);
    });
    const relativeDays = { 前天: -2, 昨天: -1, 今天: 0, 明天: 1, 后天: 2 };
    corrected = corrected.replace(/(前天|昨天|今天|明天|后天)([^\n。，；!?！？]{0,16}?)(星期|周)([日天一二三四五六])/g, (match, dayName, middle, prefix) => {
      const date = new Date(referenceDate);
      date.setDate(date.getDate() + relativeDays[dayName]);
      const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
      return `${dayName}${middle}${prefix}${weekday}`;
    });
    return corrected;
  }

  function normalizeChatMessageWeekday(message, chat) {
    if (
      (!chat?.isGroup && !chat?.isSpectatorGroup) ||
      !message ||
      message.role === "user" ||
      message.sentAsCharacter ||
      typeof message.content !== "string"
    ) return message;
    const content = normalizeWeekdayMentions(
      message.content,
      messageTime(message, chat.id),
    );
    return content === message.content ? message : { ...message, content };
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
    const text = visible.map(messageText).join(" ");
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
    // Mentioning a future ten-minute wait is not ten minutes already elapsed.
    // Explicit elapsed durations/deadlines are handled separately and exactly.
    let hash = 0;
    for (let index = 0; index < text.length; index++) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    minutes += hash % 3;
    return Math.max(1, Math.min(25, Math.round(minutes)));
  }

  function chineseNumber(value) {
    if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (value === "半") return 0.5;
    const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    let result = 0, current = 0;
    for (const char of value.replace(/个/g, "")) {
      if (char in digits) current = digits[char];
      else if (char === "十" || char === "百" || char === "千") { result += (current || 1) * ({ 十: 10, 百: 100, 千: 1000 })[char]; current = 0; }
      else return NaN;
    }
    return result + current;
  }

  function durations(text) {
    const pattern = /([\d.零〇一二两三四五六七八九十百千半]+)\s*(?:个)?\s*(半)?\s*(小时|分钟|分半钟|刻钟)(半)?/g;
    const values = [];
    for (const match of String(text).matchAll(pattern)) {
      const amount = chineseNumber(match[1]);
      const minutes = amount * (match[3] === "小时" ? 60 : match[3] === "刻钟" ? 15 : 1) +
        (match[2] || match[4] ? (match[3] === "小时" ? 30 : 0.5) : match[3] === "分半钟" ? 0.5 : 0);
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10080) continue;
      const entry = { minutes, start: match.index, end: match.index + match[0].length };
      const previous = values.at(-1);
      if (previous && /^\s*(?:又|零|多|和)?\s*$/.test(text.slice(previous.end, entry.start))) { previous.minutes += minutes; previous.end = entry.end; }
      else values.push(entry);
    }
    return values;
  }

  function messageText(item) {
    return [item?.content, item?.message, item?.dialogue, item?.description, item?.reply_content]
      .filter((value) => typeof value === "string" && !/^data:/i.test(value))
      .map((value) => value.slice(0, 8000)).join(" ");
  }

  function storyTarget(history, current, chatId) {
    const visible = (Array.isArray(history) ? history : []).filter((item) => item && !item.isHidden && item.type !== "thought_chain");
    const markerIndex = visible.findLastIndex((item) => item.type === "time_marker");
    const recent = visible.slice(markerIndex + 1).filter((item) => !item.isReplyHeader).slice(-100);
    const latest = recent.at(-1); if (!latest) return null;
    const text = messageText(latest);
    const negated = /(?:还没|还未|没有|没|未|不到|还不到)\s*(?:到)?\s*(?:时间|时候)|时间(?:还没|未|没|没有)到|时间到了[吗么？?]/.test(text);
    const reached = !negated && /时间到了|到时间了|时间到(?:了)?[！!。\s）)]|时间到$|时候到了|到时候了|到点了|等完了|等待结束|计时结束|闹钟响了|倒计时结束/.test(text);
    const ownDurations = durations(text);
    const elapsed = ownDurations.find((duration) => {
      const before = text.slice(Math.max(0, duration.start - 14), duration.start);
      const after = text.slice(duration.end, duration.end + 12);
      const elapsedScene = (latest.role === "user" || latest.type === "narration" || latest.type === "offline_text") &&
        /^\s*(?:已经)?(?:过去|过后|过去了|之后|后[，,。\s）)]|后$)/.test(after) &&
        !/^\s*(?:之后|以后|后)\s*(?:再|才|要|能|会|可以|准备)/.test(after);
      return !/(?:再等|等上|需要|还有|要等|还要|至少|最多|能否|能不能|等待|等)\s*$/.test(before) &&
        (/(?:过了|过去了|经过了?|已经等了|已等了|等了|耗时|花了)\s*$/.test(before) ||
        elapsedScene);
    });
    if (elapsed && !negated) {
      // An explicit elapsed scene is measured from that message's scene time,
      // not repeatedly added again whenever an old user message stays in history.
      const base = finiteOrNull(latest.vts) ?? current;
      return Math.max(current, base + elapsed.minutes * 60000);
    }
    if (!reached) return null;
    for (let index = recent.length - 2; index >= 0; index--) {
      const item = recent[index], content = messageText(item);
      const planned = durations(content).filter((duration) => {
        const before = content.slice(Math.max(0, duration.start - 22), duration.start);
        const after = content.slice(duration.end, duration.end + 20);
        const completed = /(?:过了|过去了|已经等了|已等了|等了|耗时|花了)\s*$/.test(before) || /^\s*(?:过去了|已过去|过去)/.test(after);
        return !completed && (/(?:等|等待|再过|过|还有|需要|计时|倒计时|限时|持续|休息|站|坐|罚|写|背|练|睡|煮|蒸|烤|跑|走|看)/.test(before) || /^\s*(?:后|之后|以后)/.test(after));
      });
      if (!planned.length) continue;
      const duration = planned.at(-1);
      const base = finiteOrNull(item.vts) ?? current;
      return Math.max(current, base + duration.minutes * 60000);
    }
    return null;
  }

  function latestReplyContext(history) {
    if (!Array.isArray(history)) return [];
    const recentContext = history
      .filter(
        (item) =>
          item &&
          !item.isHidden &&
          item.type !== "time_marker" &&
          (item.role === "user" || item.role === "assistant"),
      )
      .slice(-3);
    return recentContext;
  }

  function prepareReplyTime(history, options = {}) {
    const chatId = String(options.chatId || activeChatId || "");
    const beforeMs = nowMs(chatId || activeChatId);
    const preparation = {
      chatId,
      beforeMs,
      afterMs: beforeMs,
      minutes: 0,
      changed: false,
      spaceDatabaseName,
      beforeConfig: spaceClock ? { ...spaceClock, frozen: {} } : normalizeConfig(getConfig(chatId)),
    };
    if (options.advance === false || !chatId) return preparation;
    const config = getConfig(chatId);
    if (config.mode !== MODES.CUSTOM) return preparation;
    if (String(chatId) === activeChatId) freezeActiveRecords(config);
    if (config.holdNextReply) {
      preparation.afterMs = config.anchorVirtualMs;
      preparation.manualHold = true;
      config.holdNextReply = false;
    } else if (config.flow === FLOWS.FROZEN) {
      const target = storyTarget(history, beforeMs, chatId);
      preparation.afterMs = target == null ? beforeMs + replyAdvanceMinutes(latestReplyContext(history)) * 60000 : target;
      preparation.storyDeadline = target != null;
    } else return preparation;
    preparation.minutes = preparation.manualHold ? 0 : (preparation.afterMs - beforeMs) / 60000;
    config.anchorVirtualMs = preparation.afterMs;
    config.anchorRealMs = Date.now(); config.revision++;
    setSpaceClock(config);
    preparation.revision = spaceClock.revision;
    preparation.changed = true;
    preparation.ready = persistSpaceClock();
    updateUi();
    return preparation;
  }

  async function rollbackPreparedReplyTime(preparation) {
    if (
      !preparation?.changed ||
      preparation.spaceDatabaseName !== spaceDatabaseName
    ) {
      return;
    }
    const config = getConfig(preparation.chatId);
    if (
      config.mode !== MODES.CUSTOM ||
      config.revision !== preparation.revision
    ) {
      return;
    }
    setSpaceClock({ ...preparation.beforeConfig, revision: config.revision + 1 });
    await persistSpaceClock();
    if (activeBinding && preparation.chatId === activeChatId)
      await persistToChat(activeBinding, activeChatId, getConfig());
    updateUi();
  }

  function ensureReplyHeader(items, options = {}) {
    const chatId = String(options.chatId || activeChatId || "");
    if (!Array.isArray(items) || !chatId) return items;
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
    const replyTimeMs = Number.isFinite(Number(options.replyTimeMs))
      ? Number(options.replyTimeMs)
      : nowMs(chatId);
    for (const item of items) {
      if (item && typeof item.content === "string") {
        item.content = normalizeWeekdayMentions(item.content, replyTimeMs);
      }
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
      content: formatReplyHeader(replyTimeMs, location),
      isReplyHeader: true,
      vts: replyTimeMs,
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
      timeHoldNextReply: config.holdNextReply,
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
    const originalConfig = configs[activeChatId];
    rebuildFrozenIndex(binding, originalConfig);
    // Migrate historical lookup values to the records before dropping any
    // duplicate map. Existing vts always wins, including after time jumps.
    const migratedRecords = freezeActiveRecords(originalConfig);
    if (spaceClock) preserveCollectionTimes(binding.getMessages?.(), originalConfig);
    if (!spaceClock) setSpaceClock(originalConfig);
    const config = getConfig();
    const storedMapSize = Object.keys(settingsConfig?.frozen || {}).length;
    const remainingMapSize = Object.keys(databaseConfig(config, binding).frozen).length;
    const clockChanged = settingsConfig && ["mode", "flow", "anchorRealMs", "anchorVirtualMs", "holdNextReply"].some((key) => settingsConfig[key] !== config[key]);
    if (!settingsConfig || migratedRecords || clockChanged || storedMapSize !== remainingMapSize) {
      persistToChat(binding, activeChatId, config).catch(
        (error) => console.warn("历史时间迁移保存失败；原时间缓存仍保留。", error),
      );
    } else {
      // This chat is already migrated in IndexedDB. Avoid rewriting its entire
      // history merely because the user reopens it or loads more messages.
      durableConfigIds.add(activeChatId);
      persistConfigs();
    }
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
        <div class="time-machine-title" id="time-machine-title">本空间时间</div>
        <div class="time-machine-current" id="time-machine-current"></div>
        <div class="time-machine-tabs" role="radiogroup" aria-label="时间模式">
          <button type="button" data-time-mode="real">真实时间</button>
          <button type="button" data-time-mode="custom">虚拟时间</button>
        </div>
        <div id="time-machine-custom-options">
          <label class="time-machine-label" for="time-machine-datetime">跳转到时间</label>
          <div class="time-machine-datetime-row">
            <input id="time-machine-datetime" type="datetime-local">
            <span id="time-machine-selected-weekday" aria-live="polite"></span>
          </div>
          <div class="time-machine-flow" role="radiogroup" aria-label="虚拟时间流速">
            <label><input type="radio" name="time-machine-flow" value="flow" checked><span><b>保持流动</b><small>现实过 10 分钟，虚拟时间也走 10 分钟</small></span></label>
            <label><input type="radio" name="time-machine-flow" value="frozen"><span><b>按剧情推进</b><small>手动跳转后首轮保持原时刻；其余按剧情推进</small></span></label>
          </div>
          <p class="time-machine-hint">${SPACE_TIME_HINT}</p>
        </div>
        <div class="time-machine-actions">
          <button type="button" id="time-machine-cancel">取消</button>
          <button type="button" id="time-machine-confirm">确认</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    window.ephoneHolidayCalendar?.attachUi(modal);

    modal.querySelector("#time-machine-datetime").addEventListener("input", updateSelectedWeekday);
    modal.querySelector("#time-machine-datetime").addEventListener("change", updateSelectedWeekday);

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
        if (window.isPersonaSpaceBusy?.()) {
          modal.querySelector(".time-machine-hint").textContent = "正在回复或处理付款，请先停止或等它完成，再调整时间。";
          return;
        }
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
    window.ephoneHolidayCalendar?.renderPreview(modal);
  }

  function openModal() {
    if (!activeChatId) return;
    const modal = document.getElementById("time-machine-modal");
    modal.querySelector(".time-machine-hint").textContent = SPACE_TIME_HINT;
    const config = getConfig();
    selectDraftMode(config.mode);
    modal.querySelector("#time-machine-datetime").value =
      toDateTimeLocal(nowMs());
    updateSelectedWeekday();
    window.ephoneHolidayCalendar?.openUi(modal);
    const flowInput = modal.querySelector(
      `input[name="time-machine-flow"][value="${config.flow}"]`,
    );
    if (flowInput) flowInput.checked = true;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function updateSelectedWeekday() {
    const modal = document.getElementById("time-machine-modal");
    const value = modal?.querySelector("#time-machine-datetime")?.value;
    const label = modal?.querySelector("#time-machine-selected-weekday");
    if (!label) return;
    const date = value ? new Date(value) : null;
    label.textContent = date && Number.isFinite(date.getTime())
      ? `星期${["日", "一", "二", "三", "四", "五", "六"][date.getDay()]}`
      : "";
    window.ephoneHolidayCalendar?.renderPreview(modal);
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
    loadSpace,
    clearActiveChat,
    getConfig,
    nowMs,
    nowDate,
    resolveTimestamp,
    messageTime,
    formatDateTime,
    formatReplyHeader,
    normalizeWeekdayText: normalizeWeekdayMentions,
    normalizeChatMessageWeekday,
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
