(function (root) {
  "use strict";

  const text = (value) => typeof value === "string" ? value : "";
  const list = (value) => Array.isArray(value) ? value : [];
  const isGroup = (chat) => Boolean(chat?.isGroup || chat?.isSpectatorGroup);
  const validMessage = (message) => message && !message.isHidden &&
    !String(message.content || "").includes("已被用户删除");

  function recentHistory(chat, count = chat?.settings?.maxMemory) {
    const limit = Math.max(1, Math.floor(Number(count) || 10));
    return list(chat?.history).filter(validMessage).slice(-limit);
  }

  function memberProfile(member, chats, npcs) {
    const npc = member.isNpc || String(member.id).startsWith("npc_")
      ? list(npcs).find((item) => String(item.id) === String(member.id).replace(/^npc_/, ""))
      : null;
    const source = npc || (!isGroup(chats[member.id]) ? chats[member.id] : null);
    const sourcePersona = text(npc ? npc.persona : source?.settings?.aiPersona);
    const savedPersona = text(member.persona);
    // Older groups have no provenance. Preserve differing group-specific settings;
    // new groups track their source snapshot so later source edits can be followed.
    const override = member.ephonePersonaOverride === true ||
      (member.ephonePersonaOverride !== false && member.ephoneSourcePersona == null &&
        savedPersona && savedPersona !== sourcePersona);
    return {
      member, source, npc, sourcePersona,
      persona: override ? savedPersona : sourcePersona || savedPersona,
      override,
      originalName: member.originalName || source?.originalName || source?.name || member.groupNickname || "未命名角色",
      nickname: member.groupNickname || member.originalName || source?.name || "未命名角色",
    };
  }

  function describeMessage(chat, message, formatTime) {
    const members = list(chat.members);
    const member = members.find((item) =>
      [item.originalName, item.groupNickname].filter(Boolean).includes(message.senderName));
    const narration = message.type === "narration" || message.type === "time_marker" || message.role === "system";
    const speaker = narration ? "旁白/场景" : member?.originalName || message.senderName ||
      (message.role === "user" ? chat.settings?.myNickname || "我" : chat.originalName || chat.name);
    let content = text(message.content);
    if (Array.isArray(message.content)) {
      content = message.content.map((part) => text(part?.text)).filter(Boolean).join("\n") || "[图片消息]";
    }
    if (/^data:.*;base64,/i.test(content)) content = message.description || message.meaning || "[图片消息]";
    if (["ai_image", "user_photo"].includes(message.type)) content = `[图片：${content}]`;
    if (message.type === "sticker") content = `[表情：${message.meaning || "表情"}]`;
    if (message.type === "voice_message") content = `[语音：${content}]`;
    if (message.quote) content = `[引用 ${message.quote.senderName || "消息"}：${text(message.quote.content)}] ${content}`;
    const time = Number(message.vts ?? message.timestamp);
    const date = Number.isFinite(time) && formatTime ? ` [${formatTime(time)}]` : "";
    const reference = message.timestamp != null ? ` (Timestamp: ${message.timestamp})` : "";
    return `${speaker}${member && member.groupNickname !== speaker ? `（群昵称：${member.groupNickname || speaker}）` : ""}${date}${reference}: ${content}`;
  }

  function resolveSpeaker(profiles, name) {
    const matches = profiles.filter((profile) =>
      [profile.originalName, profile.nickname, profile.source?.name, profile.source?.originalName]
        .filter(Boolean).includes(name));
    return matches.length === 1 ? matches[0].originalName : null;
  }

  function buildContext({ chat, chats = {}, npcs = [], formatTime }) {
    const profiles = list(chat.members).map((member) => memberProfile(member, chats, npcs));
    const memberIds = new Set(profiles.map((profile) => String(profile.member.id)));
    const identityRules = "\n# 人物身份与关系核对（普通群聊和观看群聊共用）\n" +
      "先完整阅读每位成员的人设，再逐一核对人物之间的身份、年龄、辈分和关系。群昵称、私聊备注不是另一个人；JSON name 必须使用下列本名。" +
      "不同人设中的第一人称‘我’仅指该人设的主人，不能互换。{{char}}指该档案角色；{{user}}指该档案明确标注的原聊天对象，不能自动替换成当前发言角色。" +
      "同一分组和NPC绑定只表示社交关联，不自动意味着亲属、恋人或师徒；具体关系只能根据人设、世界书和已确立的剧情判断，未设定的关系不要编造。" +
      "创作者需参考所有人设，但角色不因此拥有其他角色的私密想法或亲历记忆。当前群内专用设定优先于基础档案，事实设定优先于历史回复中的错误关系。\n";
    const membersText = identityRules + profiles.map((profile) => {
      const { member, source, npc, sourcePersona, persona, originalName, nickname, override } = profile;
      let result = `\n## 本名：${originalName}；群昵称：${nickname}${source?.name && !npc ? `；私聊备注：${source.name}` : ""}\n`;
      result += `基础人设（最新角色/NPC档案）：\n${sourcePersona || persona || "（未设置）"}\n`;
      if (override && persona !== sourcePersona) result += `本群专用人设（优先遵守）：\n${persona || "（未设置）"}\n`;
      if (source?.settings?.myPersona || source?.settings?.myNickname || /\{\{user\}\}/.test(persona || sourcePersona)) {
        result += `该角色基础档案中的原聊天对象（{{user}}）：${source?.settings?.myNickname || "我"}\n`;
        result += `原聊天对象人设：${source?.settings?.myPersona || "（未设置；不能据此推测其是某个群成员）"}\n`;
      }
      const associated = npc ? list(npc.associatedWith).map((id) => {
        if (id === "user") return "原用户（不自动等于当前角色）";
        const target = chats[id];
        return target && !isGroup(target) ? target.originalName || target.name : "";
      }).filter(Boolean) : Object.values(chats).filter((other) =>
        source?.groupId != null && !isGroup(other) && other.id !== member.id && other.groupId === source.groupId,
      ).map((other) => other.originalName || other.name).filter(Boolean);
      if (associated.length) result += `社交关联（具体关系以人设为准）：${associated.join("、")}\n`;
      return result;
    }).join("\n");

    function memories(owner, title) {
      const items = list(owner?.longTermMemory).filter((memory) => text(memory.content));
      return items.length ? `\n## ${title}\n` + items.map((memory) => {
        const time = Number(memory.vts ?? memory.timestamp);
        return `- ${formatTime && Number.isFinite(time) ? `[${formatTime(time)}] ` : ""}${memory.content}`;
      }).join("\n") + "\n" : "";
    }
    let memoryText = "\n# 已总结的记忆（区分记忆主人；‘我’只指该主人）\n";
    memoryText += memories(chat, `本群“${chat.name}”的剧情总结`);
    profiles.forEach((profile) => {
      memoryText += memories(profile.source, `${profile.originalName}的个人记忆`);
    });
    const linkedIds = [...new Set(list(chat.settings?.linkedMemoryChatIds).map(String))]
      .filter((id) => id !== String(chat.id));
    const linked = linkedIds.map((id) => chats[id]).filter(Boolean).sort((a, b) =>
      Number(list(b.history).at(-1)?.timestamp || 0) - Number(list(a.history).at(-1)?.timestamp || 0));
    let linkedMemoryText = "";
    for (const source of linked) {
      linkedMemoryText += `\n## 已勾选参考聊天：[${isGroup(source) ? "群聊" : "私聊"}]“${source.name}”\n`;
      // A member's personal summaries have already been included above.
      if (!memberIds.has(String(source.id))) linkedMemoryText += memories(source, "该聊天的总结记忆");
      const messages = recentHistory(source, chat.settings?.linkedMemoryCount);
      linkedMemoryText += messages.map((message) => describeMessage(source, message, formatTime)).join("\n") || "（暂无有效聊天记录）";
      linkedMemoryText += "\n";
    }
    if (linkedMemoryText) linkedMemoryText = "\n# 已勾选的其他聊天记忆（只作历史参考，不能覆盖当前虚拟时间或擅自改变人物关系）\n" + linkedMemoryText;
    return { membersText, memoryText, linkedMemoryText, profiles };
  }

  const api = { buildContext, recentHistory, describeMessage, memberProfile, resolveSpeaker };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ephoneGroupContext = api;
})(typeof window !== "undefined" ? window : globalThis);
