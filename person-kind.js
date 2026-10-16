(function (root) {
  "use strict";
  class Service {
    constructor(db, identity = root.ephonePlayerIdentity) { this.db = db.chats.db; this.identity = identity; }
    async convert(key, target) {
      if (!["role", "npc"].includes(target)) throw new Error("请选择转换成角色或NPC。");
      const chats = this.db.table("chats"), npcs = this.db.table("npcs"), identity = this.identity;
      return this.db.transaction("rw", chats, npcs, async () => {
        const all = await chats.toArray(), people = await npcs.toArray(), person = identity.choices(all, people).find((p) => p.key === key);
        if (!person) throw new Error("人物已移走或删除。");
        if (person.kind === target) return person;
        let chat, npc, oldId, newId;
        if (target === "role") {
          npc = people.find((p) => identity.personKey(p, "npc") === key);
          if (!npc) throw new Error("找不到NPC档案，请先保存人物资料。");
          const archived = npc.ephoneArchivedChatId == null ? null : await chats.get(npc.ephoneArchivedChatId);
          if (archived && (!archived.ephoneNpcArchive || identity.personKey(archived) !== key)) throw new Error("原角色记录发生冲突，未覆盖已有聊天。");
          const id = archived?.id || root.crypto.randomUUID();
          chat = { ...(archived || {}), id, name: archived?.name || npc.name, originalName: npc.name, avatar: npc.avatar || archived?.avatar || "", isGroup: false,
            ephonePersonKey: key, ephoneNpcOrigin: { ...npc },
            settings: { maxMemory: 20, ...archived?.settings, aiPersona: npc.persona || "", aiAvatar: npc.avatar || archived?.avatar || "" },
            history: Array.isArray(archived?.history) ? archived.history : Array.isArray(npc.history) ? npc.history : [],
            longTermMemory: Array.isArray(archived?.longTermMemory) ? archived.longTermMemory : Array.isArray(npc.longTermMemory) ? npc.longTermMemory : [] };
          delete chat.ephoneNpcArchive;
          delete chat.ephoneNpcId;
          await chats.put(chat); await npcs.delete(npc.id);
          oldId = "npc_" + npc.id; newId = id;
        } else {
          chat = all.find((p) => !p.ephoneNpcArchive && !p.isGroup && !p.isSpectatorGroup && identity.personKey(p) === key);
          if (!chat) {
            const member = all.flatMap((c) => c.members || []).find((m) => identity.memberKey(m, all) === key);
            if (!member) throw new Error("找不到人物的完整档案。");
            chat = { id: root.crypto.randomUUID(), ephonePersonKey: key, name: person.name, originalName: person.name, avatar: member.avatar || "", settings: { aiPersona: person.persona }, history: [], longTermMemory: [] };
          }
          npc = { ...chat.ephoneNpcOrigin, name: chat.originalName || chat.name, persona: chat.settings?.aiPersona || "", avatar: chat.avatar || "",
            longTermMemory: chat.longTermMemory || [],
            associatedWith: chat.ephoneNpcOrigin?.associatedWith || [], enableBackgroundActivity: false, actionCooldownMinutes: chat.ephoneNpcOrigin?.actionCooldownMinutes || 30,
            ephonePersonKey: key, ephoneArchivedChatId: chat.id };
          // Reuse the original NPC ID only when free; never overwrite another NPC.
          if (npc.id != null && await npcs.get(npc.id)) delete npc.id;
          npc.id = await npcs.add(npc);
          await chats.put({ ...chat, ephonePersonKey: key, ephoneNpcArchive: true, ephoneNpcId: npc.id });
          oldId = chat.id; newId = "npc_" + npc.id;
        }
        for (const group of all.filter((c) => c.isGroup || c.isSpectatorGroup)) {
          let changed = false;
          group.members = (group.members || []).map((member) => {
            if (identity.memberKey(member, all) !== key && String(member.id) !== String(oldId)) return member;
            changed = true; return { ...member, id: newId, isNpc: target === "npc", ephonePersonKey: key };
          });
          if (changed) await chats.put(group);
        }
        // Stable person keys leave wallets, binding, relations, life records,
        // order ownership and historical evidence untouched. Private chats are
        // archived (not deleted), and restored on the next promotion.
        return { ...person, kind: target, sourceId: target === "role" ? chat.id : npc.id, hiddenChatId: target === "npc" ? chat.id : null };
      });
    }
  }
  const api = { Service }; root.ephonePersonKind = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
