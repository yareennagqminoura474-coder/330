(function (root) {
  "use strict";
  const list = (v) => Array.isArray(v) ? v : [], same = (a, b) => String(a) === String(b);
  const cents = (v) => { const n = Math.round(Number(v) * 100); if (!Number.isSafeInteger(n) || n < 0) throw new Error("原钱包金额异常，未删除聊天。"); return n; };
  class Service {
    constructor(db) {
      this.db = db.chats.db;
      this.tables = ["chats", "characterWallets", "characterTransactions", "userWallet", "userTransactions", "spaceClock"].filter((name) => this.db.tables.some((t) => t.name === name)).map((name) => this.db.table(name));
      for (const table of this.tables) this[table.name] = table;
    }
    async remove(chatId, timestamps, options = {}) {
      return this.db.transaction("rw", ...this.tables, async () => {
        const before = await this.chats.get(chatId); if (!before) throw new Error("聊天已不存在。");
        const selected = new Set(list(timestamps).map(String));
        const after = { ...before, history: list(before.history).filter((m) => !selected.has(String(m.timestamp))) };
        return this.apply(before, after, options);
      });
    }
    async apply(before, draft, { otherChats = [], notification, resolveTime = (m) => m.vts ?? m.timestamp, now = Date.now() } = {}) {
      return this.db.transaction("rw", ...this.tables, async () => {
        const current = await this.chats.get(before.id);
        if (!current || JSON.stringify(current.history) !== JSON.stringify(before.history)) throw new Error("聊天刚被另一处更新，请重新选择后删除；余额和时间未更改。");
        const remaining = new Set(list(draft.history).map((m) => String(m.timestamp)));
        const roots = new Set(list(before.history).filter((m) => !remaining.has(String(m.timestamp))).map((m) => String(m.timestamp)));
        if (!roots.size) { await this.chats.bulkPut([...otherChats, draft]); return { chat: draft, deleted: 0, removedEntries: 0, clock: null }; }
        const removed = new Set(roots), history = list(before.history), byTime = new Map(history.map((m) => [String(m.timestamp), m]));
        const indexByTime = new Map(history.map((m, index) => [String(m.timestamp), index]));
        const selectedNoticeIds = new Set(history.filter((m) => roots.has(String(m.timestamp)) && m.walletEntryId).map((m) => m.walletEntryId));
        const legacyIds = new Set([...roots].flatMap((stamp) => [`card:${before.id}:${stamp}`, `story:${before.id}:${stamp}`]));
        const rows = this.characterTransactions ? await this.characterTransactions.toArray() : [];
        const bills = this.userTransactions ? await this.userTransactions.toArray() : [];
        // Deleting a funding card also removes its receipts. Deleting just a
        // receipt reverses that credit and re-opens the retained original card.
        for (const m of history) if (m.moneyReceipt && roots.has(String(m.forTimestamp))) removed.add(String(m.timestamp));
        const selectedReceipts = history.filter((m) => m.moneyReceipt && removed.has(String(m.timestamp)));
        const belongs = (r) => {
          if (r.orderId || ["scheduled", "setup", "manual"].includes(r.source)) return false;
          if (same(r.evidence?.chatId, before.id) && roots.has(String(r.evidence.timestamp))) return true;
          if (same(r.chatId, before.id) && [r.sourceTimestamp, r.noticeTimestamp].some((v) => v != null && removed.has(String(v)))) return true;
          if (selectedNoticeIds.has(r.id) || legacyIds.has(r.id)) return true;
          const receiptPrefix = `receipt:${before.id}:`;
          if (String(r.id).startsWith(receiptPrefix) && roots.has(String(r.id).slice(receiptPrefix.length).split(":")[0])) return true;
          return selectedReceipts.some((m) => String(r.id) === `receipt:${before.id}:${m.forTimestamp}:${r.key}` &&
            (m.walletDestination === r.key || list(before.members).some((p) => [p.originalName, p.groupNickname, p.name].includes(m.recipientName) &&
              [p.ephonePersonKey, "chat:" + p.id, "member:" + p.id, "npc:" + String(p.id).replace(/^npc_/, "")].includes(r.key))));
        };
        const selectedRows = rows.filter(belongs), rowIds = new Set(selectedRows.map((r) => r.id));
        for (const m of history) if (m.walletEntry && (rowIds.has(m.walletEntryId) || roots.has(String(m.walletSourceTimestamp)) || selectedRows.some((r) => r.noticeTimestamp != null && same(m.timestamp, r.noticeTimestamp)))) removed.add(String(m.timestamp));
        // Legacy auto-expense notices had no ID: use their immediately preceding
        // proven source, never a loose amount/date match across different chats.
        for (const r of selectedRows) if (same(r.evidence?.chatId, before.id)) {
          const index = indexByTime.get(String(r.evidence.timestamp));
          for (let i = index + 1; index != null && i < history.length && history[i].walletEntry; i++) if (history[i].content?.includes(r.evidence.quote)) removed.add(String(history[i].timestamp));
        }
        const selectedBills = bills.filter((b) => !b.orderId && (rowIds.has(b.characterEntryId) || same(b.chatId, before.id) &&
          ([b.sourceTimestamp, b.noticeTimestamp].some((v) => v != null && removed.has(String(v))) ||
            b.moneyReceipt && (roots.has(String(b.forTimestamp)) || selectedReceipts.some((m) => same(m.timestamp, b.timestamp))))));
        const adjustments = new Map();
        const add = (key, direction, value) => adjustments.set(key, (adjustments.get(key) || 0) + (direction === "expense" ? cents(value) : -cents(value)));
        for (const r of selectedRows) if (r.status === "posted" && r.amount) {
          const destination = r.walletDestination || (bills.some((b) => b.characterEntryId === r.id) ? "space" : "character");
          add(destination === "space" ? "space" : r.key, r.direction, r.amount);
        }
        for (const b of selectedBills) if (!rowIds.has(b.characterEntryId)) add("space", b.type, b.amount);
        for (const [key, delta] of adjustments) {
          const table = key === "space" ? this.userWallet : this.characterWallets, id = key === "space" ? "main" : key;
          const wallet = await table?.get(id); if (!wallet) throw new Error("找不到原收付款账户，未删除聊天。");
          const balance = cents(wallet.balance) + delta;
          if (!Number.isSafeInteger(balance) || balance < 0) throw new Error("这笔收款已被后续消费使用，撤销后余额会不足。请同时删除关联的后续支出，或先调整余额；本次聊天、账单和时间均未更改。");
          await table.put({ ...wallet, balance: balance / 100, ...(key === "space" ? {} : { revision: (wallet.revision || 0) + 1 }) });
        }
        for (const key of new Set(selectedRows.filter((r) => r.status === "posted" && !adjustments.has(r.key)).map((r) => r.key))) {
          const wallet = await this.characterWallets?.get(key);
          if (wallet) await this.characterWallets.update(key, { revision: (wallet.revision || 0) + 1 });
        }
        if (selectedRows.length) await this.characterTransactions.bulkDelete(selectedRows.map((r) => r.id));
        if (selectedBills.length) await this.userTransactions.bulkDelete(selectedBills.map((b) => b.id));
        const resetCards = new Map();
        for (const receipt of selectedReceipts) {
          if (removed.has(String(receipt.forTimestamp))) continue;
          const original = resetCards.get(String(receipt.forTimestamp)) || byTime.get(String(receipt.forTimestamp)); if (!original) continue;
          const card = structuredClone(original);
          if (card.type === "transfer") { card.status = "pending"; delete card.acceptedBy; card.isReceived = false; delete card.receivedAt; delete card.acceptedAt; delete card.acceptedVts; }
          if (card.type === "red_packet") { delete card.claimedBy?.[receipt.recipientName]; delete card.claimedVts?.[receipt.recipientName]; card.isFullyClaimed = false; if (Array.isArray(card.unclaimedAmounts)) card.unclaimedAmounts.push(receipt.amount); }
          resetCards.set(String(card.timestamp), card);
        }
        const chat = { ...draft, history: list(draft.history).filter((m) => !removed.has(String(m.timestamp))).map((m) => resetCards.get(String(m.timestamp)) || m) };
        delete chat.ephoneLastReplyBatch;
        chat.lastMemorySummaryIndex = Math.min(Number(chat.lastMemorySummaryIndex) || 0, chat.history.length);
        const others = otherChats.filter((c) => !same(c.id, chat.id)).map((c) => structuredClone(c));
        chat.longTermMemory = list(chat.longTermMemory).map((m) => ({ ...m }));
        const positions = new Map(chat.history.map((m, index) => m.ephoneSummaryMessageId ? [String(m.ephoneSummaryMessageId), index + 1] : null).filter(Boolean));
        let summaryCursor = 0, hasTrackedSummary = false;
        for (const owner of [chat, ...others]) for (const memory of list(owner.longTermMemory)) {
          if (!same(memory.ephoneSourceChatId, chat.id) || !list(memory.ephoneSummaryMessageIds).length) continue;
          const kept = memory.ephoneSummaryMessageIds.map((id) => positions.get(String(id))).filter(Number.isFinite);
          memory.ephoneSummaryStartIndex = kept.length ? Math.min(...kept) : 0; memory.ephoneSummaryEndIndex = kept.length ? Math.max(...kept) : 0;
          summaryCursor = Math.max(summaryCursor, memory.ephoneSummaryEndIndex); hasTrackedSummary = true;
        }
        if (hasTrackedSummary) chat.lastMemorySummaryIndex = summaryCursor;
        if (chat.lastMemorySummaryIndex) chat.lastMemorySummaryTimestamp = chat.history[chat.lastMemorySummaryIndex - 1]?.timestamp || 0;
        else delete chat.lastMemorySummaryTimestamp;
        const valid = (m) => !m.isHidden && !m.isTemporary && Number.isFinite(Number(resolveTime(m)));
        const last = [...chat.history].reverse().find(valid), first = history.find(valid), target = last || first;
        let clock = null;
        if (this.spaceClock && target) {
          const old = await this.spaceClock.get("main") || {};
          clock = { ...old, id: "main", mode: "custom", flow: old.mode === "custom" && old.flow === "flow" ? "flow" : "frozen", anchorRealMs: now,
            anchorVirtualMs: Number(resolveTime(target)), frozen: {}, holdNextReply: true, revision: (old.revision || 0) + 1 };
          await this.spaceClock.put(clock);
          chat.settings = { ...chat.settings, timeMode: clock.mode, customTimeFlow: clock.flow, customAnchorRealMs: now, customAnchorVirtualMs: clock.anchorVirtualMs, virtualTimeFrozenMap: {}, timeHoldNextReply: true };
        }
        if (notification) chat.history.push({ role: "system", isHidden: true, content: notification, timestamp: now, vts: clock?.anchorVirtualMs ?? Number(resolveTime(last || first || {})) });
        await this.chats.bulkPut([...others, chat]);
        return { chat, deleted: removed.size, removedEntries: selectedRows.length + selectedBills.filter((b) => !rowIds.has(b.characterEntryId)).length, clock,
          balance: Number((await this.userWallet?.get("main"))?.balance || 0), emptyHistory: !last, otherChats: others };
      });
    }
  }
  const api = { Service }; root.ephoneChatFinanceRollback = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
