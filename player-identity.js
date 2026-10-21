(function (root) {
  "use strict";
  const nameOf = (item) => item?.originalName || item?.name || item?.groupNickname || "未命名角色";
  const personKey = (item, type = "chat") => item?.ephonePersonKey || type + ":" + item.id;
  const isGroup = (item) => item.isGroup || item.isSpectatorGroup;
  const isNpc = (member) => member.isNpc || String(member.id).startsWith("npc_");
  const basePersona = (member) => String(member.ephoneSourcePersona ?? (member.ephonePersonaOverride === true ? "" : member.persona) ?? "").trim();
  function memberSource(member, chats, npcs = []) {
    const npc = isNpc(member), id = npc ? String(member.id).replace(/^npc_/, "") : String(member.id);
    const records = npc ? npcs : chats.filter((c) => !isGroup(c) && !c.ephoneNpcArchive);
    const direct = records.find((r) => String(r.id) === id);
    if (direct) return { record: direct, type: npc ? "npc" : "chat" };
    if (npc) {
      const archive = chats.find((c) => c.ephoneNpcArchive && String(c.ephoneNpcId) === id);
      if (archive) return { record: archive, type: "chat" };
    }
    const stable = member.ephonePersonKey && records.filter((r) => personKey(r, npc ? "npc" : "chat") === member.ephonePersonKey);
    if (stable?.length === 1) return { record: stable[0], type: npc ? "npc" : "chat" };
    const matches = records.filter((r) => {
      if (nameOf(r) !== nameOf(member) || nameOf(member) === "未命名角色") return false;
      const origin = r.ephoneCopyOrigin;
      // Copy provenance survives persona edits. Without it, require an exact
      // base profile, not a group nickname or a name-only guess.
      if (origin?.table === (npc ? "npcs" : "chats") && String(origin.id) === id) return true;
      const persona = basePersona(member), source = String(npc ? r.persona || "" : r.settings?.aiPersona || "").trim();
      return Boolean(persona) && persona === source;
    });
    return matches.length === 1 ? { record: matches[0], type: npc ? "npc" : "chat" } : null;
  }
  function memberKey(member, chats, npcs = []) {
    const source = memberSource(member, chats, npcs);
    if (source) return personKey(source.record, source.type);
    return member.ephonePersonKey || (isNpc(member) ? "npc:" + String(member.id).replace(/^npc_/, "") : "member:" + String(member.id));
  }
  function choices(chats = [], npcs = []) {
    const result = new Map();
    for (const chat of chats) if (!chat.isGroup && !chat.isSpectatorGroup && !chat.ephoneNpcArchive) result.set(personKey(chat), { key: personKey(chat), kind: "role", sourceId: chat.id, name: nameOf(chat), label: nameOf(chat) + " · 角色", persona: chat.settings?.aiPersona || "" });
    for (const npc of npcs) result.set(personKey(npc, "npc"), { key: personKey(npc, "npc"), kind: "npc", sourceId: npc.id, name: nameOf(npc), label: nameOf(npc) + " · NPC", persona: npc.persona || "" });
    for (const chat of chats) for (const member of chat.members || []) {
      if (member.id == null) continue;
      const key = memberKey(member, chats, npcs);
      if (!result.has(key)) result.set(key, { key, kind: isNpc(member) ? "npc" : "role", sourceId: member.id, name: nameOf(member), label: nameOf(member) + (isNpc(member) ? " · NPC" : " · 角色"), persona: member.persona || "" });
    }
    return [...result.values()];
  }
  function participants(chat, chats = [], npcs = []) {
    if (!chat) return [];
    if (!chat.isGroup && !chat.isSpectatorGroup) return [{ key: personKey(chat), name: nameOf(chat), aliases: [chat.name, chat.originalName].filter(Boolean) }];
    return (chat.members || []).filter((member) => member.id != null).map((member) => ({ key: memberKey(member, chats, npcs), name: nameOf(member), aliases: [member.originalName, member.groupNickname, chats.find((item) => String(item.id) === String(member.id))?.name].filter(Boolean) }));
  }
  function resolve(people, name) {
    const found = people.filter((person) => person.name === name || person.aliases?.includes(name));
    return found.length === 1 ? found[0] : null;
  }
  async function load(db) {
    if (!db?.spaceProfiles) return null;
    const [binding, chats, npcs] = await Promise.all([db.spaceProfiles.get("player"), db.chats.toArray(), db.npcs.toArray()]);
    if (!binding?.key) return null;
    const person = choices(chats, npcs).find((item) => item.key === binding.key);
    return person ? { ...binding, ...person, valid: true } : { ...binding, valid: false };
  }
  async function save(db, key) {
    const concrete = db.spaceProfiles.db;
    const [chats, npcs] = await Promise.all([concrete.table("chats").toArray(), concrete.table("npcs").toArray()]);
    const person = key ? choices(chats, npcs).find((item) => item.key === key) : null;
    if (key && !person) throw new Error("角色已移走或被删除，请重新选择。");
    await concrete.table("spaceProfiles").put({ id: "player", key: person?.key || null, name: person?.name || null });
    return person;
  }
  async function reconcile(db) {
    if (!db?.spaceProfiles || !db?.chats || !db?.npcs) return;
    const concrete = db.spaceProfiles.db, chatsTable = concrete.table("chats"), npcsTable = concrete.table("npcs"), profiles = concrete.table("spaceProfiles");
    return concrete.transaction("rw", chatsTable, npcsTable, profiles, async () => {
      const chats = await chatsTable.toArray(), npcs = await npcsTable.toArray(), aliases = new Map();
      let didChange = false;
      for (const group of chats.filter(isGroup)) {
        let changed = false;
        for (const member of group.members || []) {
          if (member.id == null) continue;
          const source = memberSource(member, chats, npcs);
          if (!source) continue;
          const key = personKey(source.record, source.type), old = member.ephonePersonKey || (isNpc(member) ? "npc:" + String(member.id).replace(/^npc_/, "") : "member:" + member.id);
          const id = source.type === "npc" ? "npc_" + source.record.id : source.record.ephoneNpcArchive ? "npc_" + source.record.ephoneNpcId : source.record.id;
          if (old !== key) aliases.set(old, key);
          const legacy = isNpc(member) ? "npc:" + String(member.id).replace(/^npc_/, "") : "member:" + member.id;
          if (legacy !== key) aliases.set(legacy, key);
          if (String(member.id) !== String(id) || member.ephonePersonKey && member.ephonePersonKey !== key) {
            member.id = id; member.ephonePersonKey = key;
            if (source.type === "npc") member.isNpc = true;
            changed = true;
          }
        }
        if (changed) { await chatsTable.put(group); didChange = true; }
      }
      const binding = await profiles.get("player");
      if (binding?.key && aliases.has(binding.key)) {
        const key = aliases.get(binding.key), person = choices(chats, npcs).find((p) => p.key === key);
        if (person) { await profiles.put({ ...binding, key, name: person.name }); didChange = true; }
      }
      // Only references are repaired. No archive/history, wallet, transaction,
      // or private memory is deleted, combined, or duplicated.
      return didChange;
    });
  }
  const api = { choices, participants, resolve, load, save, personKey, memberKey, memberSource, reconcile };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ephonePlayerIdentity = api;
  if (!root.document) return;
  const doc = root.document;
  let token = 0, busy = false;
  api.isBusy = () => busy;
  async function render() {
    const current = ++token, select = doc.getElementById("player-identity-select"), status = doc.getElementById("player-identity-status");
    if (!select || !root.db?.spaceProfiles) return;
    try {
      const db = root.db.spaceProfiles.db;
      await reconcile(db);
      const [chats, npcs, binding] = await Promise.all([db.table("chats").toArray(), db.table("npcs").toArray(), db.table("spaceProfiles").get("player")]);
      if (current !== token) return;
      select.replaceChildren(new Option("未绑定（使用原来的用户身份）", ""));
      for (const person of choices(chats, npcs)) select.add(new Option(person.label, person.key));
      if (binding?.key && !choices(chats, npcs).some((item) => item.key === binding.key)) select.add(new Option("原绑定角色已移走或删除，请重新绑定", binding.key));
      select.value = binding?.key || "";
      status.textContent = binding?.key ? "本空间绑定：" + (choices(chats, npcs).find((item) => item.key === binding.key)?.name || "绑定已失效") : "绑定后，购物和外卖归属这个角色；其他角色不会自动获得订单记忆。";
    } catch { status.textContent = "暂时无法读取角色绑定，请重新打开“我”。"; }
  }
  doc.addEventListener("DOMContentLoaded", () => {
    doc.getElementById("player-identity-save")?.addEventListener("click", async () => {
      const status = doc.getElementById("player-identity-status"), button = doc.getElementById("player-identity-save");
      if (root.isPersonaSpaceBusy?.()) { status.textContent = "请先停止回复或完成当前操作，再切换绑定。"; return; }
      button.disabled = true; busy = true;
      try {
        const person = await save(root.db, doc.getElementById("player-identity-select").value);
        await root.EPhoneMarketAdapter?.adoptOrders?.();
        status.textContent = person ? "已保存，本空间由“" + person.name + "”充当你。" : "已解除绑定；已有订单仍保留原主人的身份和记忆。";
      } catch (error) { status.textContent = "保存失败：" + error.message; }
      finally { button.disabled = false; busy = false; }
    });
    new MutationObserver(() => { if (doc.getElementById("me-view")?.classList.contains("active")) render(); }).observe(doc.getElementById("me-view"), { attributes: true, attributeFilter: ["class"] });
  });
  api.render = render;
})(typeof window !== "undefined" ? window : globalThis);
