(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ephoneChatRounds = api;
})(typeof window === "undefined" ? null : window, function () {
  "use strict";
  const prose = new Set(["text", "narration"]);
  function visible(message) {
    return message && !message.isHidden && !message.walletEntry && !message.moneyReceipt && !message.marketOrder;
  }
  function generated(message) {
    return visible(message) && !message.sentAsCharacter &&
      (message.role === "assistant" || message.role === "system" && message.type === "narration");
  }
  function opening(message) {
    return message.isReplyHeader === true || message.isReplyHeader == null && !message.isSceneTimeHeader &&
      message.type === "narration" && /^\s*\d{4}年\s*\d{1,2}月\s*\d{1,2}日[，,\s]/.test(message.content || "");
  }
  function rounds(chat) {
    const result = [], tagged = new Map();
    const saved = new Set([...(chat?.ephoneLastReplyBatch?.timestamps || []),
      ...(chat?.ephoneReplyEditor?.timestamps || [])].map(String));
    let current = null, wasSaved = false;
    for (const [index, message] of (chat?.history || []).entries()) {
      if (!visible(message)) continue;
      if (!generated(message)) {
        if (message.role === "user" || message.sentAsCharacter || message.type === "time_marker") current = null;
        wasSaved = false;
        continue;
      }
      const id = message.ephoneReplyRoundId, inSaved = saved.has(String(message.timestamp));
      // Older ordinary chats sometimes recorded only assistant timestamps,
      // leaving the system-role opening header out of the saved batch.
      const afterOpening = current?.messages.length === 1 && opening(current.messages[0]);
      if (id) {
        current = tagged.get(id);
        if (!current) {
          current = { id, index, messages: [] };
          tagged.set(id, current); result.push(current);
        }
      } else if (!current || (current.tagged && !inSaved && prose.has(message.type || "text")) ||
        opening(message) || (inSaved && !wasSaved && !afterOpening)) {
        current = { id: "legacy:" + String(message.timestamp), index, messages: [] };
        result.push(current);
      }
      current.tagged ||= Boolean(id);
      current.messages.push(message);
      wasSaved = inSaved;
    }
    return result.sort((a, b) => a.index - b.index);
  }
  function target(chat, previous = false, reference = null) {
    const all = rounds(chat);
    let current = all.length - 1;
    const pinned = reference?.roundId ? all.findIndex(round => round.id === reference.roundId) : -1;
    if (pinned >= 0) current = pinned;
    else if (reference?.timestamp != null) {
      const index = (chat?.history || []).findIndex(message => String(message.timestamp) === String(reference.timestamp));
      if (index >= 0) current = Math.max(0, all.findLastIndex(round => round.index <= index));
    }
    const index = current - (previous ? 1 : 0);
    const found = index >= 0 ? all[index] : null;
    return found ? { index: found.index, timestamp: found.messages[0].timestamp, roundId: found.id } : null;
  }
  function speakers(chat) {
    const members = chat?.isGroup || chat?.isSpectatorGroup ? chat.members || [] : [chat];
    return [...new Set(members.map(member => member?.originalName || member?.name || member?.groupNickname).filter(Boolean))];
  }
  function canConvert(message) {
    return visible(message) && prose.has(message.type || "text") && typeof message.content === "string" &&
      message.content.trim().length > 0 && !message.quote && !message.marketOrder && !message.walletFunded &&
      !opening(message) && !message.isSceneTimeHeader &&
      (message.role === "assistant" || message.type === "narration");
  }
  function convert(message, kind, speaker, chat) {
    if (!canConvert(message)) throw new Error("只能转换普通角色文字或旁白；时间标题、图片、订单和收付款卡片不能转换。");
    if (!prose.has(kind)) throw new Error("消息类型无效。");
    if (kind === "text" && !speakers(chat).includes(speaker)) throw new Error("请选择当前聊天中的角色。");
    const manual = message.role === "user" || Boolean(message.sentAsCharacter);
    return { ...message, type: kind, content: message.content,
      role: kind === "text" ? "assistant" : manual ? "user" : message.role,
      senderName: kind === "narration" ? "旁白" : speaker,
      ...(manual ? { sentAsCharacter: true } : {}), ephoneMessageKindOverride: kind };
  }
  return { rounds, target, speakers, canConvert, convert };
});
