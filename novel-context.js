(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EPhoneNovelContext = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const text = (value) => typeof value === "string" ? value : "";
  const list = (value) => Array.isArray(value) ? value : [];
  const isGroup = (chat) => Boolean(chat?.isGroup || chat?.isSpectatorGroup);
  const nameOf = (person) => person?.originalName || person?.name || person?.groupNickname || "未命名人物";
  const readable = (row) => row && !row.isHidden && row.type !== "thought_chain" &&
    !text(row.content).includes("已被用户删除");
  function contentOf(row) {
    if (Array.isArray(row.content)) return row.content.map((part) => text(part?.text)).filter(Boolean).join("\n") || "[图片消息]";
    const content = text(row.content);
    return /^data:.*;base64,/i.test(content) ? text(row.description) || text(row.meaning) || "[图片消息]" : content;
  }
  function build(options = {}) {
    const chats = Array.isArray(options.chats) ? options.chats : Object.values(options.chats || {}), npcs = list(options.npcs);
    const records = Object.fromEntries(chats.map((chat) => [String(chat.id), chat]));
    const identity = options.identity || {}, groupContext = options.groupContext || {}, aliases = { ...options.aliases };
    const canonical = (key) => {
      if (identity.canonicalKey) return identity.canonicalKey(key, aliases);
      const seen = new Set();
      while (Object.hasOwn(aliases, key) && typeof aliases[key] === "string" && !seen.has(key)) { seen.add(key); key = aliases[key]; }
      return key;
    };
    const personKey = (source, type = "chat") => canonical(identity.personKey?.(source, type) || source.ephonePersonKey || type + ":" + source.id);
    const memberKey = (profile) => canonical(identity.memberKey?.(profile.member, chats, npcs) ||
      (profile.npc ? personKey(profile.npc, "npc") : profile.source ? personKey(profile.source) : profile.member.ephonePersonKey || "member:" + profile.member.id));
    const roster = new Map(), originalUserProfiles = new Map(), selectedChats = [], groupNotes = [], warnings = [], selectedIds = [...new Set(list(options.selectedIds).map(String))];
    const addAlias = (from, to) => { if (from && from !== to) aliases[from] = to; };
    function addPerson({ key, source, npc, member, persona, basePersona, origin, group, override }) {
      let person = roster.get(key);
      if (!person) {
        person = { key, name: nameOf(npc || source || member), aliases: new Set(), bases: new Map(), overrides: new Map(), sources: new Map(), originalUsers: new Map() };
        roster.set(key, person);
      }
      for (const value of [source?.name, source?.originalName, npc?.name, member?.originalName, member?.groupNickname]) if (value) person.aliases.add(value);
      const base = text(basePersona) || text(npc?.persona) || text(source?.settings?.aiPersona) || text(persona);
      if (base && !person.bases.has(base)) person.bases.set(base, origin);
      if (group && override && persona && persona !== base) person.overrides.set(String(group.id), { groupName: group.name, persona });
      if (source && !npc) person.sources.set(String(source.id), source);
      if (npc) person.sources.set("npc:" + npc.id, npc);
      const originalName = source?.settings?.myNickname, originalPersona = source?.settings?.myPersona;
      if (originalName || originalPersona || /\{\{user\}\}/.test(base)) {
        const value = JSON.stringify([originalName, originalPersona]);
        const persona = text(originalPersona);
        if (persona && !originalUserProfiles.has(persona)) originalUserProfiles.set(persona, "U" + (originalUserProfiles.size + 1));
        person.originalUsers.set(value, { name: originalName || "原用户", profile: originalUserProfiles.get(persona) });
      }
      if (source && !npc) addAlias("chat:" + source.id, key);
      if (npc) addAlias("npc:" + npc.id, key);
      if (member) {
        addAlias("member:" + member.id, key);
        if (member.ephonePersonKey) addAlias(member.ephonePersonKey, key);
        if (member.isNpc || String(member.id).startsWith("npc_")) addAlias("npc:" + String(member.id).replace(/^npc_/, ""), key);
      }
      return person;
    }
    for (const id of selectedIds) {
      const npc = id.startsWith("npc_") ? npcs.find((item) => String(item.id) === id.slice(4)) : null;
      if (npc) { addPerson({ key: personKey(npc, "npc"), npc, origin: "所选NPC档案" }); continue; }
      const chat = records[id];
      if (!chat) { warnings.push("所选人物或群聊已不存在：" + id); continue; }
      selectedChats.push(chat);
      if (!isGroup(chat)) { addPerson({ key: personKey(chat), source: chat, origin: `角色档案“${chat.name}”` }); continue; }
      // The shared resolver is sufficient here; buildContext also prepares all
      // memory/history text that this module does not use or select.
      const resolved = typeof groupContext.memberProfile === "function"
        ? list(chat.members).map((member) => groupContext.memberProfile(member, records, npcs))
        : groupContext.buildContext?.({ chat, chats: records, npcs, formatTime: options.formatTime })?.profiles;
      const profiles = resolved || list(chat.members).map((member) => {
        const linked = identity.memberSource?.(member, chats, npcs), npc = linked?.type === "npc" ? linked.record : null;
        const source = npc || linked?.record || records[String(member.id)];
        const sourcePersona = text(npc?.persona) || text(source?.settings?.aiPersona);
        const override = member.ephonePersonaOverride === true || member.ephonePersonaOverride !== false &&
          member.ephoneSourcePersona == null && member.persona && member.persona !== sourcePersona;
        return { member, npc, source, sourcePersona, persona: override ? member.persona : sourcePersona || member.persona, override };
      });
      groupNotes.push(`所选${chat.isSpectatorGroup ? "观看" : "普通"}群聊“${chat.name}”（${chat.id}）\n群设定：${chat.settings?.aiPersona || chat.settings?.scenario || "（未另设）"}\n成员本名：${profiles.map((profile) => nameOf(profile.npc || profile.source || profile.member)).join("、") || "（暂无成员）"}`);
      for (const profile of profiles) addPerson({ key: memberKey(profile), source: profile.source, npc: profile.npc, member: profile.member,
        persona: profile.persona, basePersona: profile.sourcePersona, origin: `所选群聊“${chat.name}”`, group: chat, override: profile.override });
    }
    const names = (person) => [...person.aliases].filter((value) => value !== person.name).join("、");
    const cast = [...roster.values()], parts = ["# 本作品的角色档案与事实约束\n只参考本次选中的人物和群聊；群聊是场景及成员集合，不是一个独立人物。群昵称、备注和同一人物编号指向同一个人，不得混淆身份。\n人设里的第一人称‘我’只指该档案主人，{{char}}指该人物，{{user}}指档案标注的原聊天对象；不能互换为当前代演角色。\n人物关系以完整人设、已保存的双向关系、所选世界书及明确成立的前文为依据，不因同群、同分组或社交关联就认定亲属、恋人或师徒。作品明确设置的IF改写只作用于明确改写的项目，其余事实仍须保留。\n叙事者掌握档案不代表每个人物知情；私人记忆、心理、订单和后台账目不是全员公告。若早期回复写错关系，不能用错文覆盖档案；资料未确定的关系保持未知，不编造成已经发生的事实。\n"];
    if (groupNotes.length) parts.push("# 所选群聊的场景与成员\n" + groupNotes.join("\n\n"));
    for (const person of cast) {
      let section = `# 本名：${person.name}（人物编号：${person.key}）${names(person) ? "\n备注/群昵称：" + names(person) : ""}\n`;
      section += person.bases.size ? [...person.bases].map(([persona, origin], index) => `${index ? "同一人物的补充档案" : "基础人设"}（${origin}）：\n${persona}`).join("\n") : "基础人设：（未设置，不自行补成既定事实）";
      for (const override of person.overrides.values()) section += `\n“${override.groupName}”中的专用设定（仅对应场景优先）：\n${override.persona}`;
      if (person.overrides.size > 1) section += "\n多个群的专用设定不能相互套用；未明确本章对应场景时先沿用基础档案。";
      for (const value of person.originalUsers.values()) section += `\n该档案的原聊天对象（{{user}}）：${value.name}\n原聊天对象人设：${value.profile ? "引用原聊天对象档案【" + value.profile + "】的完整文本" : "（未设置；不能自动对应为本章的某位人物）"}`;
      parts.push(section);
    }
    if (originalUserProfiles.size) {
      parts.push("# 原聊天对象完整人设（相同文本只列一次；文字复用不合并人物身份）\n" + [...originalUserProfiles].map(([persona, id]) => {
        const source = cast.find((person) => person.bases.has(persona));
        return `## 原聊天对象档案【${id}】\n` + (source
          ? `完整相同文本见上方本名“${source.name}”（人物编号：${source.key}）的基础/补充档案。此处只复用人设文字，原聊天对象身份仍按每位角色自己档案的标注理解，不自动认定是同一人。`
          : persona);
      }).join("\n\n"));
    }
    if (options.player?.name && options.player.valid !== false) {
      const persona = text(options.player.persona), source = roster.get(canonical(options.player.key));
      const profile = source?.bases.has(persona) ? `见上方本名“${source.name}”（人物编号：${source.key}）的完整档案；绑定不额外创建另一个同名人物。` : persona || "（未另设）";
      parts.push(`本空间中充当用户的绑定角色：${options.player.name}（${options.player.key || "未注明编号"}）。此绑定说明谁代演用户，不会令其他档案中的{{user}}自动变成该角色，也不会改写作品中明确指定的用户身份。\n绑定角色档案：${profile}`);
    }
    const allowed = new Map(cast.map((person) => [person.key, person]));
    // The default user identity participates in the story's relationship map,
    // but binding alone does not select that person's chats or private memories.
    if (options.player?.key && options.player.name && options.player.valid !== false) {
      const key = canonical(options.player.key);
      if (!allowed.has(key)) allowed.set(key, { key, name: options.player.name });
    }
    const relations = [], seenRelations = new Set();
    for (const relation of list(options.relations)) {
      const a = allowed.get(canonical(relation.a)), b = allowed.get(canonical(relation.b));
      if (!a || !b || a.key === b.key || relation.status === "pending") continue;
      const proof = list(relation.evidence).map((e) => e?.quote ? `依据原文（${e.chatName || e.chatId || "来源"}）：${e.quote}` : "").filter(Boolean).join("\n");
      const value = `${b.name}是${a.name}的${text(relation.aToB) || "（未注明）"}；${a.name}是${b.name}的${text(relation.bToA) || "（未注明）"}。\n关系来由与边界：${text(relation.detail) || "（未补充）"}${proof ? "\n" + proof : ""}`;
      if (!seenRelations.has(value)) { seenRelations.add(value); relations.push(value); }
    }
    parts.push("# 所选人物之间已保存的双向关系\n" + (relations.join("\n\n") || "没有额外保存的关系条目，具体关系仍按上面的完整人设和明确前文；不能把缺少关系条目当成互不认识。"));
    const format = (record) => { const time = Number(record.vts ?? record.timestamp); return options.formatTime && Number.isFinite(time) ? `[${options.formatTime(time)}] ` : ""; };
    const seenMemories = new Set();
    function memoryText(owner, title, key) {
      const values = [];
      for (const row of list(owner?.longTermMemory)) {
        if (!readable(row) || !contentOf(row)) continue;
        const id = JSON.stringify([key, row]); if (seenMemories.has(id)) continue;
        seenMemories.add(id); values.push("- " + format(row) + contentOf(row));
      }
      return values.length ? `## ${title}\n${values.join("\n")}` : "";
    }
    const memories = [];
    for (const person of cast) for (const source of person.sources.values()) memories.push(memoryText(source, `${person.name}的个人总结记忆（主人：${person.name}）`, person.key));
    for (const chat of selectedChats.filter(isGroup)) memories.push(memoryText(chat, `所选群聊“${chat.name}”的总结记忆`, "group:" + chat.id));
    if (memories.some(Boolean)) parts.push("# 已保存的总结记忆（保留各自主人及时间）\n" + memories.filter(Boolean).join("\n\n"));
    const count = Number.isFinite(Number(options.historyLimit)) && options.historyLimit != null ? Math.max(0, Math.floor(Number(options.historyLimit))) : 20;
    if (count) for (const chat of selectedChats) {
      const history = list(chat.history).filter(readable).slice(-count);
      if (!history.length) continue;
      const describe = options.describeMessage || groupContext.describeMessage;
      const content = history.map((row) => describe ? describe(chat, row, options.formatTime) : `${row.senderName || (row.role === "user" ? chat.settings?.myNickname || "原聊天对象" : nameOf(chat))} ${format(row)}${contentOf(row)}`).join("\n");
      parts.push(`## 所选${isGroup(chat) ? "群聊" : "私聊"}“${chat.name}”最近${history.length}条原文\n以下是历史参考，不强制本章重演，也不自动改变当前人物关系：\n${content}`);
    }
    if (warnings.length) parts.push("# 失效的引用\n" + warnings.join("\n") + "\n缺失的档案不能凭空补写为已经读取。");
    return { text: parts.join("\n\n"), people: cast.map((person) => ({ key: person.key, name: person.name, aliases: [...person.aliases] })), warnings };
  }
  function continuity(chapters, people) {
    const written = list(chapters), seen = new Set(), mentions = [];
    for (const person of list(people)) {
      if (!person?.key || seen.has(person.key)) continue;
      seen.add(person.key);
      const names = [...new Set([person.name, ...list(person.aliases)].filter((value) => typeof value === "string" && value.trim().length >= 2))];
      const hits = [];
      written.forEach((chapter, index) => {
        const body = text(chapter?.content), summary = chapter?.summaryStale ? "" : text(chapter?.summary);
        if (names.some((name) => body.includes(name) || summary.includes(name))) hits.push(index + 1);
      });
      if (hits.length) mentions.push({ key: person.key, name: person.name, first: hits[0], last: hits.at(-1) });
    }
    const index = mentions.length ? mentions.map((person) => `- ${person.name}：首次文字线索在第${person.first}章，最近在第${person.last}章。`).join("\n") : "未检索到所选档案人物的姓名线索；这不等于人物尚未登场或彼此不认识。";
    return { mentions, text: "# 前文人物检索线索（本机根据已保留章节整理）\n" + index +
      "\n这只是姓名/别称在正文或摘要中的检索线索，不自动证明人物同场、见过面或知道某件私事；也不能把未命中姓名当作初次登场。请结合下方各章进度、上一章完整正文和已成立的关系判断。\n" +
      "# 接续与人物生活\n" +
      (written.length ? "这是已经进行中的故事。读者已经读过此前章节，直接接住上一章结尾的动作、话题、情绪余波、时间和位置；允许短暂过渡，但不要重新开场介绍。熟人再出现或暂时离场后回来，用当前行动与彼此熟悉的反应辨认，不重新列姓名、职业、外貌、性格、关系履历。只有本章真正首次出现且读者理解情境所需的信息才自然带出；叙述介绍过某人，不等于其他角色也认识此人。\n" : "这是作品开篇，但人设或参考事实中已经相识的人仍是熟人，不因为小说刚开篇就改写成初次见面。人物介绍随场景需要带出，不集中铺设档案。\n") +
      "本章必须沿着已有事实产生新的行动、选择、后果或关系变化。已完成的谈话和事件不重新演一遍；有意照应旧事时，应有新的意义、反应或后果，不能只换同义词重复同一互动。角色的情绪不会到下一章自动归零，承诺、误会、物品状态和未完成的事也不会因换章重置。未发生的安排仍是安排，未解决的问题可以继续存在，不必章章强行升华或和解。\n" +
      "# 自然写作与避免人设复读\n" +
      "所选作者的文风继续生效。人设是人物理解事情、取舍和行动的背景，不是每章必须完成的展示清单。性格、爱好、口头习惯或外貌特点只有在当前场景确实相关时才显现；上章已充分表现的点，本章没有新诱因就不再特意强调，不靠反复安排同一种动作证明人物性格。不要换个措辞继续复述同一个特征，也不要为了求新另造违背人设的癖好。\n" +
      "人物各有眼前的目标、注意力和生活事务，不总围着主角回应，也不要求所有角色每章轮流出场。熟人对话有共享语境和各自说话节奏，可以留白、含蓄、误解、转移话题或不立即回答；由具体处境决定，避免人人轮流完整解释自己的心理。不同人物依据各自已知信息行动，不能为了推进情节突然全知。\n" +
      "让可观察的细节、实际行动和对话承担表达，减少旁白紧跟着替角色解释、给关系下结论或反复总结同一个感受。详略随场景变化，日常片段也可以安静、琐碎、有未说出口的话；不把每次停顿、靠近或对视都重复写成同一种情绪高潮。以上是写作取向，不在正文输出分析、检查清单或自我评价。" };
  }
  return Object.freeze({ build, continuity });
});
