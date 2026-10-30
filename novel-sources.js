(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EPhoneNovelSources = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const list = (value) => Array.isArray(value) ? value : [];
  const group = (record) => Boolean(record?.isGroup || record?.isSpectatorGroup);
  const asset = (key) => /avatar|wallpaper|background|coverImage|bannerImage|photoAlbum|gallery/i.test(key);
  // Keep the complete identity and persona fields used by memberSource and
  // orphanKey. Only selected records need their potentially large chat data.
  function metadata(record) {
    const copy = (value) => {
      const out = {};
      for (const [key, item] of Object.entries(value || {})) {
        if (key === "history" || key === "longTermMemory" || asset(key)) continue;
        out[key] = item;
      }
      return out;
    };
    const out = copy(record);
    if (record.settings) out.settings = copy(record.settings);
    if (Array.isArray(record.members)) out.members = record.members.map((member) => {
      const value = copy(member);
      if (member.settings) value.settings = copy(member.settings);
      return value;
    });
    return out;
  }
  function alternate(id) {
    if (typeof id === "number") return Number.isFinite(id) ? String(id) : null;
    if (typeof id !== "string" || !id.trim()) return null;
    const value = Number(id);
    return Number.isFinite(value) && String(value) === id ? value : null;
  }
  async function loadChats(table, cachedChats, selectedIds, npcs = [], options = {}) {
    const cacheAvailable = Array.isArray(cachedChats) || cachedChats !== null && typeof cachedChats === "object";
    if (!cacheAvailable) return table.toArray();
    const cached = (Array.isArray(cachedChats) ? cachedChats : Object.values(cachedChats)).filter((record) => record && record.id != null);
    const records = new Map(cached.map((record) => [String(record.id), metadata(record)])), fetched = new Set();
    const selected = [...new Set(list(selectedIds).filter((id) => id != null).map(String))].filter((id) =>
      !id.startsWith("npc_") || !list(npcs).some((npc) => String(npc.id) === id.slice(4)));
    async function refresh(ids) {
      const requested = [...new Set(ids.map(String))].filter((id) => !fetched.has(id));
      if (!requested.length) return false;
      const keys = [], slots = new Map();
      for (const id of requested) {
        fetched.add(id);
        const actual = records.get(id)?.id ?? id, other = alternate(actual), indexes = [keys.length];
        keys.push(actual);
        if (other !== null && other !== actual) { indexes.push(keys.length); keys.push(other); }
        slots.set(id, indexes);
      }
      const values = typeof table.bulkGet === "function" ? await table.bulkGet(keys) : await Promise.all(keys.map((key) => table.get(key)));
      for (const [id, indexes] of slots) {
        const found = indexes.map((index) => values[index]).find((record) => record && String(record.id) === id);
        // A missing selected archive must not survive as a stale cached profile.
        if (found) records.set(id, found); else records.delete(id);
      }
      return true;
    }
    await refresh(selected);
    while (true) {
      const chats = [...records.values()], byId = Object.fromEntries(records), needed = [];
      for (const id of selected) {
        const chat = records.get(id); if (!group(chat)) continue;
        for (const member of list(chat.members)) {
          let source, npc;
          if (options.groupContext?.memberProfile) {
            const profile = options.groupContext.memberProfile(member, byId, npcs);
            source = profile?.source; npc = profile?.npc;
          } else {
            const linked = options.identity?.memberSource?.(member, chats, npcs);
            npc = linked?.type === "npc" ? linked.record : null;
            source = linked?.record || (!group(byId[String(member.id)]) ? byId[String(member.id)] : null);
          }
          if (source?.id != null && !npc && !group(source) && !fetched.has(String(source.id))) needed.push(source.id);
          else if (!source && !member.isNpc && !String(member.id).startsWith("npc_") && member.id != null && !fetched.has(String(member.id))) {
            // A newly created group's direct source may not yet be in the
            // application cache. Probe that exact ID, never scan unrelated chats.
            needed.push(member.id);
          }
        }
      }
      if (!needed.length) break;
      await refresh(needed);
    }
    return [...records.values()];
  }
  return Object.freeze({ loadChats });
});
