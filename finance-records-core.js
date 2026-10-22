(function (root) {
  "use strict";
  const market = () => root.ephoneLifeMarketCore || (typeof require === "function" ? require("./life-market-core.js") : null);
  const text = (value, max = 600) => typeof value === "string" ? value.trim().slice(0, max) : "";
  function cents(value) {
    const n = Number(value), result = Math.round(n * 100);
    if (!Number.isFinite(n) || !Number.isSafeInteger(result) || result < 0) throw new Error("金额无效，不能为负数或超出保存范围。");
    return result;
  }
  const active = (row) => !row.financialReversed && (row.status || "posted") === "posted";
  const direction = (row) => row.direction || row.type;
  const impact = (row) => active(row) && ["income", "expense"].includes(direction(row)) ? cents(row.amount) * (direction(row) === "income" ? 1 : -1) : 0;
  const lineId = (row) => row.orderLineId || row.refundOfLineId || "__legacy";
  const revision = (row) => Number(row.financeRevision || 0);
  const bump = (row) => ({ ...row, financeRevision: revision(row) + 1 });
  const stable = (value) => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
  function orderPaymentSummary(order, rows) {
    const related = rows.filter((row) => row.orderId === order.id && !row.characterEntryId && row.status !== "superseded");
    const paid = related.length ? -related.reduce((sum, row) => sum + impact(row), 0) : cents(order.paidAmount ?? (order.status === "cancelled" ? 0 : order.total));
    if (!Number.isSafeInteger(paid) || paid < 0) throw new Error("订单原始收付款不平衡，未修改金额。");
    return { paidAmount: paid === 0 ? 0 : paid / 100, paymentAdjusted: paid !== cents(order.status === "cancelled" ? 0 : order.total),
      financialReversed: related.length > 0 && related.every((row) => row.financialReversed || (row.status || "posted") !== "posted") };
  }
  class Service {
    constructor(db) {
      // Pin the concrete database: the public facade changes on a space switch.
      this.db = db.userWallet?.db || db.characterWallets?.db || db;
      for (const name of ["characterWallets", "characterTransactions", "userWallet", "userTransactions", "spaceProfiles", "marketOrders", "chats"])
        if (this.db.tables.some((table) => table.name === name)) this[name] = this.db.table(name);
    }
    tables() { return [this.characterWallets, this.characterTransactions, this.userWallet, this.userTransactions, this.spaceProfiles, this.marketOrders, this.chats].filter(Boolean); }
    transact(fn) { return this.db.transaction("rw", ...this.tables(), fn); }
    async rows() {
      return [...(this.characterTransactions ? (await this.characterTransactions.toArray()).map((row) => ({ kind: "character", row })) : []),
        ...(this.userTransactions ? (await this.userTransactions.toArray()).map((row) => ({ kind: "user", row })) : [])];
    }
    async canonical(key) {
      const aliases = (await this.spaceProfiles?.get("person-identity-aliases"))?.aliases || {}, seen = new Set();
      while (typeof aliases[key] === "string" && !seen.has(key)) { seen.add(key); key = aliases[key]; }
      return key;
    }
    async balance(key) {
      const binding = await this.spaceProfiles?.get("player");
      return binding && await this.canonical(binding.key) === await this.canonical(key)
        ? Number((await this.userWallet.get("main"))?.balance || 0)
        : Number((await this.characterWallets?.get(key))?.balance || 0);
    }
    async balances(key) {
      return { balance: Number((await this.userWallet.get("main"))?.balance || 0), characterBalance: await this.balance(key) };
    }
    async materializeOrder(orderId) {
      const order = await this.marketOrders?.get(orderId); if (!order || !this.userTransactions) return;
      const rows = (await this.userTransactions.toArray()).filter((row) => row.orderId === orderId && !row.orderLineId && !row.financeExpanded);
      for (const row of rows) {
        if (!["income", "expense"].includes(row.type) || cents(row.amount) !== cents(order.total)) continue;
        const expanded = market().orderBills(order, row.type, row);
        if (!expanded.length || !expanded.every((entry) => entry.orderLineId)) continue;
        // Converting a legacy aggregate to item rows is bookkeeping only. Keep
        // its original id as a tombstone and never move any money here.
        await this.userTransactions.put({ ...row, status: "superseded", ledgerHidden: true, financeExpanded: true, orderLineId: "__legacy_parent__" });
        for (const entry of expanded) {
          const copy = { ...entry, legacyParentId: row.id }; delete copy.id;
          await this.userTransactions.add(copy);
        }
      }
    }
    checkSnapshot(current, expected, { deleting = false } = {}) {
      if (!expected || expected.id == null) throw new Error("缺少原账单快照，请重新打开账单。");
      const revoked = deleting && current.financialReversed;
      const compare = ["amount", "description", "category", "vts", "timestamp"];
      if (!revoked) compare.push("financeRevision", "status");
      for (const key of compare) {
        if (!(key in expected)) continue;
        const old = key === "financeRevision" ? revision(expected) : key === "status" ? expected.status || "posted" : expected[key];
        const now = key === "financeRevision" ? revision(current) : key === "status" ? current.status || "posted" : key === "vts" ? current.vts ?? current.timestamp : current[key];
        if (stable(old) !== stable(now)) throw new Error("账单已经变化，请重新打开后再修改。");
      }
      if ((expected.direction || expected.type) && direction(current) !== direction(expected)) throw new Error("账单已经变化，请重新打开后再修改。");
    }
    async selected(key, snapshot, deleting = false) {
      if (!snapshot || snapshot.id == null) throw new Error("找不到账单。");
      let selected;
      if (String(snapshot.id).startsWith("user:")) {
        const binding = await this.spaceProfiles?.get("player");
        if (!binding || await this.canonical(binding.key) !== await this.canonical(key)) throw new Error("此账单不属于当前角色，未修改。");
        if (snapshot.legacyParentId != null && snapshot.orderId) {
          await this.materializeOrder(snapshot.orderId);
          const row = (await this.userTransactions.toArray()).find((entry) => entry.legacyParentId === snapshot.legacyParentId && lineId(entry) === lineId(snapshot) && entry.type === direction(snapshot));
          if (row) selected = { kind: "user", row };
        } else {
          const value = String(snapshot.id).slice(5), id = /^\d+$/.test(value) ? Number(value) : value;
          const row = await this.userTransactions?.get(id); if (row && !row.characterEntryId) selected = { kind: "user", row };
        }
      } else {
        const row = await this.characterTransactions?.get(snapshot.id);
        if (row && await this.canonical(row.key) === await this.canonical(key)) selected = { kind: "character", row };
      }
      if (!selected) throw new Error("账单已移走、删除，或不属于当前空间。");
      if (!(deleting && selected.row.ledgerHidden)) this.checkSnapshot(selected.row, snapshot, { deleting });
      return selected;
    }
    async group(selected) {
      const all = await this.rows(), row = selected.row;
      let primary;
      if (row.orderId) {
        await this.materializeOrder(row.orderId);
        return (await this.rows()).filter((item) => item.row.orderId === row.orderId && lineId(item.row) === lineId(row) && item.row.status !== "superseded");
      }
      if (row.transferId || row.counterpartEntryId) {
        primary = all.filter((item) => item.kind === "character" && (row.transferId ? item.row.transferId === row.transferId : item.row.id === row.id || item.row.id === row.counterpartEntryId));
        if (primary.length < 2) throw new Error("这笔转账缺少另一方原始账单，不能单边修改或撤销。");
      }
      else if (row.source === "card" || row.moneyReceipt) {
        const source = row.sourceTimestamp ?? row.forTimestamp;
        primary = all.filter((item) => item.row.chatId === row.chatId &&
          (item.row.source === "card" && item.row.sourceTimestamp === source || item.row.moneyReceipt && item.row.forTimestamp === source));
      } else primary = [selected];
      const ids = new Set(primary.filter((item) => item.kind === "character").map((item) => item.row.id));
      return [...primary, ...all.filter((item) => item.kind === "user" && ids.has(item.row.characterEntryId))]
        .filter((item, index, list) => list.findIndex((other) => other.kind === item.kind && other.row.id === item.row.id) === index);
    }
    async destination(item, group) {
      if (item.kind === "user") return item.row.characterEntryId ? null : "space";
      const space = item.row.walletDestination === "space" || !item.row.walletDestination && group.some((other) => other.kind === "user" && other.row.characterEntryId === item.row.id);
      return space ? "space" : "character:" + item.row.key;
    }
    async applyChanges(changes, group) {
      const deltas = new Map(), touchedKeys = new Set();
      for (const { item, next } of changes) {
        const target = await this.destination(item, group); if (!target) continue;
        const delta = impact(next) - impact(item.row);
        deltas.set(target, (deltas.get(target) || 0) + delta);
        if (item.kind === "character") touchedKeys.add(item.row.key);
      }
      const wallets = [];
      for (const [target, delta] of deltas) {
        if (!delta) continue;
        const table = target === "space" ? this.userWallet : this.characterWallets, id = target === "space" ? "main" : target.slice(10);
        const wallet = await table?.get(id);
        if (!wallet) throw new Error("找不到这笔款项原来的账户，未修改。");
        const balance = cents(wallet.balance) + delta;
        if (balance < 0 || !Number.isSafeInteger(balance)) throw new Error("撤销或修改后余额不足，所有账户和记录均未改变。");
        wallets.push({ table, wallet: { ...wallet, balance: balance / 100, ...(target !== "space" ? { revision: Number(wallet.revision || 0) + 1 } : {}) }, key: target === "space" ? null : id });
      }
      // Validate all sides before writing either side of an internal transfer.
      for (const record of wallets) { await record.table.put(record.wallet); if (record.key) touchedKeys.delete(record.key); }
      for (const key of touchedKeys) {
        const wallet = await this.characterWallets?.get(key);
        if (wallet) await this.characterWallets.put({ ...wallet, revision: Number(wallet.revision || 0) + 1 });
      }
      for (const { item, next } of changes) await (item.kind === "character" ? this.characterTransactions : this.userTransactions).put(next);
    }
    async refreshOrder(orderId, patch = {}) {
      const order = await this.marketOrders?.get(orderId); if (!order) return null;
      const rows = (await this.userTransactions.toArray()).filter((row) => row.orderId === orderId);
      const summary = orderPaymentSummary(order, rows);
      const next = { ...order, ...patch, ...summary, financeRevision: revision(order) + 1 };
      await this.marketOrders.put(next); return next;
    }
    async refreshChats(changedRows = [], order = null) {
      if (!this.chats) return [];
      const ids = new Map(changedRows.filter((item) => item.kind === "character").map((item) => [item.row.id, item.row]));
      const cards = changedRows.filter((item) => item.row.financialReversed && (item.row.source === "card" || item.row.moneyReceipt));
      const updated = [];
      for (const chat of await this.chats.toArray()) {
        let changed = false;
        const history = (chat.history || []).map((message) => {
          if (order && message.marketOrder && message.orderId === order.id) {
            const messages = root.ephoneMarketOrders || (typeof require === "function" ? require("./market-orders.js") : null);
            if (messages) { changed = true; return messages.makeMessage(order, message.orderEvent || "placed", message); }
          }
          const entry = ids.get(message.walletEntryId);
          if (entry) {
            changed = true;
            const state = entry.financialReversed ? "款项已撤销" : (entry.status || "posted") !== "posted" ? "未入账" : entry.direction === "income" ? "收入" : "支出";
            return { ...message, walletFinancialReversed: !!entry.financialReversed,
              content: `【${message.senderName || "角色"}的钱包】${state} ¥${Number(entry.amount || 0).toFixed(2)} · ${entry.description || "用途未记录"}` };
          }
          if (cards.some((item) => item.row.chatId === chat.id && (item.row.sourceTimestamp ?? item.row.forTimestamp) === (message.forTimestamp ?? message.timestamp)) &&
              (["transfer", "red_packet", "transfer_receipt", "red_packet_receipt"].includes(message.type) || message.moneyReceipt)) {
            changed = true;
            return { ...message, financialReversed: true, walletVoided: true, walletCredited: false, status: "declined", isRefund: true, isFullyClaimed: message.type === "red_packet" ? true : message.isFullyClaimed,
              ...((message.forTimestamp != null) ? { content: "【款项已撤销】原领取记录保留，不再计入余额。" } : {}) };
          }
          return message;
        });
        if (changed) { const next = { ...chat, history }; await this.chats.put(next); updated.push(next); }
      }
      return updated;
    }
    visibleEntry(item, key) {
      return item.kind === "character" ? item.row : { ...item.row, id: "user:" + item.row.id, key, direction: item.row.type,
        status: item.row.status || "posted", vts: item.row.vts ?? item.row.timestamp, source: item.row.source || "space_wallet" };
    }
    async editLedger(key, snapshot, patch) {
      return this.transact(async () => {
        const selected = await this.selected(key, snapshot), old = selected.row;
        if (old.ledgerHidden) throw new Error("这条账单已删除，未修改。");
        const group = await this.group(selected), nextDirection = patch.direction ?? direction(old), nextAmount = patch.amount == null ? cents(old.amount || 0) : cents(patch.amount);
        if (!["income", "expense"].includes(nextDirection)) throw new Error("收支方向无效。");
        const monetary = nextAmount !== cents(old.amount || 0) || nextDirection !== direction(old);
        const linked = old.orderId || old.transferId || old.counterpartEntryId || old.source === "card" || old.moneyReceipt;
        if (linked && nextDirection !== direction(old)) throw new Error("关联订单或转账的收支方向不能修改。");
        if (monetary && (old.source === "card" || old.moneyReceipt)) throw new Error("转账和红包金额关联领取状态，只能编辑说明、分类和时间。");
        if (monetary && !active(old)) throw new Error("这笔款项未入账或已撤销，只能编辑说明、分类和时间，不会重新扣款。");
        if (monetary && linked && group.some((item) => !item.row.characterEntryId && active(item.row) && cents(item.row.amount) !== cents(old.amount)))
          throw new Error("这笔关联款项包含部分退款或不同金额，不能直接改成相同金额；可编辑订单或账单说明。");
        const metadata = {};
        if ("description" in patch) metadata.description = text(patch.description);
        if ("category" in patch) metadata.category = text(patch.category, 40);
        if ("vts" in patch) { if (!Number.isFinite(patch.vts)) throw new Error("账单日期无效。"); metadata.vts = patch.vts; }
        const primaryId = old.id;
        const changes = group.map((item) => {
          const own = item.kind === selected.kind && item.row.id === primaryId;
          const mirror = item.kind === "user" && item.row.characterEntryId === primaryId;
          const next = { ...item.row };
          if (own || mirror) Object.assign(next, metadata);
          if (monetary && active(item.row)) {
            // A line's purchase and refund are one event; internal transfers
            // update both sides, while mirrors never apply a second balance delta.
            next.amount = nextAmount / 100;
            if (!linked) next[item.kind === "character" ? "direction" : "type"] = nextDirection;
            if (next.estimated) next.estimateCorrected = true;
          }
          return { item, next: bump(next) };
        });
        await this.applyChanges(changes, group);
        const updatedRows = changes.map(({ item, next }) => ({ ...item, row: next }));
        const order = old.orderId ? await this.refreshOrder(old.orderId) : null;
        const chats = await this.refreshChats(updatedRows, order), entry = updatedRows.find((item) => item.kind === selected.kind && item.row.id === primaryId);
        return { entry: this.visibleEntry(entry, key), ...(order ? { order } : {}), chats, ...await this.balances(key) };
      });
    }
    async deleteLedger(key, snapshot) {
      return this.transact(async () => {
        const selected = await this.selected(key, snapshot, true), old = selected.row;
        if (old.ledgerHidden) return { entry: this.visibleEntry(selected, key), chats: [], ...await this.balances(key) };
        const group = await this.group(selected);
        const changes = group.map((item) => ({ item, next: bump({ ...item.row, status: "voided", financialReversed: true,
          ...(item.kind === selected.kind && item.row.id === old.id ? { ledgerHidden: true } : {}) }) }));
        await this.applyChanges(changes, group);
        const updated = changes.map(({ item, next }) => ({ ...item, row: next })), order = old.orderId ? await this.refreshOrder(old.orderId) : null;
        return { entry: this.visibleEntry(updated.find((item) => item.kind === selected.kind && item.row.id === old.id), key), ...(order ? { order } : {}),
          chats: await this.refreshChats(updated, order), ...await this.balances(key) };
      });
    }
    checkOrder(order, expected) {
      if (!expected || expected.id !== order.id || stable(expected) !== stable(order)) throw new Error("订单已经变化，请重新打开后再修改。");
    }
    async editOrder(orderId, draft, { expected } = {}) {
      return this.transact(async () => {
        const order = await this.marketOrders?.get(orderId); if (!order || order.marketHidden) throw new Error("订单已删除或不属于当前空间。");
        this.checkOrder(order, expected);
        if (!Array.isArray(draft.items) || draft.items.length !== order.items.length) throw new Error("请保留原有商品；可修改商品、数量和价格。");
        const items = order.items.map((line, index) => {
          const update = draft.items[index];
          return { ...line, quantity: Number(update.quantity), item: { ...line.item,
            name: text(update.item?.name, 180), merchant: text(update.item?.merchant, 120),
            price: cents(update.item?.price) / 100, deliveryFee: cents(update.item?.deliveryFee ?? line.item.deliveryFee ?? 0) / 100 } };
        });
        if (items.some((line) => !line.item.name || line.item.price <= 0)) throw new Error("商品名称和单价无效。");
        const next = { ...order, items, recipientName: text(draft.recipientName, 100), address: text(draft.address, 500), note: text(draft.note, 1000) };
        const details = market().orderBreakdown(next), previous = market().orderBreakdown(order);
        if (!details) throw new Error("商品数量、价格或配送费无效。");
        Object.assign(next, { subtotal: details.subtotal, delivery: details.delivery, total: details.total });
        await this.materializeOrder(orderId);
        let rows = (await this.userTransactions.toArray()).filter((row) => row.orderId === orderId && row.status !== "superseded");
        if (!rows.length && cents(order.total) !== cents(next.total)) throw new Error("缺少原始收付款账单，不能安全修改金额。");
        // orderBreakdown numbers fees by their current array position. That is
        // a display id, not a financial identity: removing merchant A must not
        // let merchant B inherit A's already-reversed charge at index zero.
        const feeGroups = new Map(), usedFeeIds = new Set(rows.map(lineId));
        for (const row of rows.filter((entry) => entry.entryKind === "delivery")) {
          if (!feeGroups.has(row.merchant || "外卖商家")) feeGroups.set(row.merchant || "外卖商家", lineId(row));
        }
        const oldFees = (previous?.deliveryFees || []).map((line) => ({ ...line, orderLineId: feeGroups.get(line.merchant) || line.orderLineId }));
        const newMerchants = new Set(details.deliveryFees.map((line) => line.merchant)), assigned = new Set(), feeOrigins = new Map();
        let fresh = 0;
        const newFees = details.deliveryFees.map((line) => {
          let id = feeGroups.get(line.merchant);
          const indices = details.lines.map((item, index) => item.itemKind === "food" && (item.merchant || "外卖商家") === line.merchant ? index : -1).filter((index) => index >= 0);
          const origins = [...new Set(indices.map((index) => order.items[index].item.merchant || "外卖商家").map((merchant) => feeGroups.get(merchant)).filter(Boolean))];
          // A single shop renamed in the form is still its original fee group.
          // Merges prefer the already-existing destination merchant's group.
          if (!id) {
            const candidates = origins.filter((candidate) => !assigned.has(candidate) && ![...feeGroups].some(([merchant, key]) => key === candidate && newMerchants.has(merchant)));
            if (candidates.length === 1) id = candidates[0];
          }
          if (!id || assigned.has(id)) {
            do { id = `${orderId}:delivery:finance:${fresh++}`; } while (usedFeeIds.has(id));
          }
          assigned.add(id); usedFeeIds.add(id); feeOrigins.set(id, { origins, itemIds: indices.map((index) => details.lines[index].orderLineId) });
          return { ...line, orderLineId: id };
        });
        const oldLines = new Map([...(previous?.lines || []), ...oldFees].map((line) => [line.orderLineId, line]));
        const newLines = new Map([...details.lines, ...newFees].map((line) => [line.orderLineId, line]));
        const changes = [];
        for (const row of rows) {
          const id = lineId(row), line = newLines.get(id), oldLine = oldLines.get(id);
          const nextRow = { ...row };
          if (active(row)) {
            const delta = id === "__legacy" ? cents(next.total) - cents(order.total) : cents(line?.amount || 0) - cents(oldLine?.amount || 0);
            const value = cents(row.amount) + delta;
            if (value < 0 || !Number.isSafeInteger(value)) throw new Error("订单金额与手工校正账单冲突，请先核对该分项账单。");
            nextRow.amount = value / 100;
          }
          if (line) {
            const amount = nextRow.amount;
            Object.assign(nextRow, line, { amount });
            nextRow.description = line.entryKind === "delivery" ? `逛逛${row.type === "income" ? "退款" : "配送费"}：${line.merchant}` :
              `逛逛${row.type === "income" ? "退款" : "消费"}：${line.name} · 单价¥${line.unitPrice.toFixed(2)} × ${line.quantity} · 小计¥${line.amount.toFixed(2)}`;
          }
          changes.push({ item: { kind: "user", row }, next: bump(nextRow) });
        }
        // A new delivery-fee group is charged only on a still-funded order.
        // Editing goods after revoking a purchase must never recreate its debit.
        const whollyReversed = rows.length && rows.every((row) => row.financialReversed);
        for (const [id, line] of newLines) if (!rows.some((row) => lineId(row) === id) && !rows.some((row) => lineId(row) === "__legacy")) {
          const origin = feeOrigins.get(id), reversedGroup = (groupId) => {
            const group = rows.filter((row) => lineId(row) === groupId);
            return group.length > 0 && group.every((row) => row.financialReversed);
          };
          const reversed = whollyReversed || origin && (origin.origins.length > 0 && origin.origins.every(reversedGroup) || origin.itemIds.length > 0 && origin.itemIds.every(reversedGroup));
          const base = { ...line, type: "expense", orderId, walletSpaceId: order.walletSpaceId, source: "market", timestamp: order.timestamp, vts: order.vts,
            description: `逛逛配送费：${line.merchant}`, ...(reversed ? { status: "voided", financialReversed: true } : {}) };
          const idValue = await this.userTransactions.add({ ...base, amount: 0, status: "unposted" });
          const row = { ...base, id: idValue, amount: 0, status: "unposted" };
          changes.push({ item: { kind: "user", row }, next: bump({ ...base, id: idValue, status: reversed ? "voided" : "posted" }) });
          if (order.status === "cancelled" && !reversed) {
            const refund = { ...base, type: "income", refundOfLineId: id, amount: 0, status: "unposted" };
            refund.id = await this.userTransactions.add(refund);
            changes.push({ item: { kind: "user", row: refund }, next: bump({ ...refund, amount: line.amount, status: "posted" }) });
          }
        }
        await this.applyChanges(changes, changes.map((change) => change.item));
        rows = (await this.userTransactions.toArray()).filter((row) => row.orderId === orderId);
        Object.assign(next, orderPaymentSummary(next, rows), { financeRevision: revision(order) + 1 });
        await this.marketOrders.put(next);
        return { order: next, chats: await this.refreshChats([], next), balance: Number((await this.userWallet.get("main"))?.balance || 0) };
      });
    }
    async deleteOrder(orderId, { expected } = {}) {
      return this.transact(async () => {
        const order = await this.marketOrders?.get(orderId); if (!order) throw new Error("订单不存在或不属于当前空间。");
        if (order.marketHidden) return { order, chats: [], balance: Number((await this.userWallet.get("main"))?.balance || 0) };
        this.checkOrder(order, expected);
        await this.materializeOrder(orderId);
        const group = (await this.rows()).filter((item) => item.row.orderId === orderId && item.row.status !== "superseded");
        if (!group.length && order.status !== "cancelled" && !order.financialReversed) throw new Error("缺少原始收付款账单，不能安全撤销款项。");
        const changes = group.map((item) => ({ item, next: bump({ ...item.row, status: "voided", financialReversed: true }) }));
        await this.applyChanges(changes, group);
        const next = await this.refreshOrder(orderId, { marketHidden: true });
        return { order: next, chats: await this.refreshChats(changes.map(({ item, next }) => ({ ...item, row: next })), next), balance: Number((await this.userWallet.get("main"))?.balance || 0) };
      });
    }
  }
  const api = { Service, orderPaymentSummary, active, lineId };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ephoneFinanceRecordsCore = api;
})(typeof window !== "undefined" ? window : globalThis);
