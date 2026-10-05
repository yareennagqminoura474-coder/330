(function (root) {
  "use strict";
  function tablesFor(db, withChats = false) {
    // Capture concrete tables before awaiting: a space switch changes the facade.
    const wallet = db.userWallet, transactions = db.userTransactions;
    const chats = withChats ? db.chats : null;
    const database = wallet.db;
    if (!database || database !== transactions.db || (chats && chats.db !== database))
      throw new Error("钱包和聊天不属于同一个空间，未进行入账。");
    return { wallet, transactions, chats, database };
  }
  function moneyCents(value) {
    const number = Number(value), amount = Math.round(number * 100);
    if (!Number.isFinite(number) || !Number.isSafeInteger(amount) || amount <= 0)
      throw new Error("金额无效。");
    return amount;
  }
  async function addEntry(tables, amount, type, description, extra = {}) {
    const change = moneyCents(amount);
    if (!["income", "expense"].includes(type)) throw new Error("账单类型无效。");
    const current = await tables.wallet.get("main") || { id: "main", balance: 0, kinshipCards: [], fundHoldings: [] };
    const balance = Math.round(Number(current.balance ?? 0) * 100);
    if (!Number.isSafeInteger(balance) || balance < 0) throw new Error("钱包余额异常，未进行记账。");
    if (type === "expense" && balance < change) return { ok: false, balance: balance / 100 };
    const next = balance + (type === "income" ? change : -change);
    if (!Number.isSafeInteger(next)) throw new Error("金额超出可保存范围。");
    await tables.wallet.put({ ...current, balance: next / 100 });
    await tables.transactions.add({ timestamp: Date.now(), ...extra, type, amount: change / 100, description });
    return { ok: true, balance: next / 100 };
  }
  async function book(db, amount, type, description, extra = {}) {
    const tables = tablesFor(db);
    return tables.database.transaction("rw", tables.wallet, tables.transactions,
      () => addEntry(tables, amount, type, description || "未知交易", extra));
  }
  async function creditReceipt(db, candidate, receipt, spaceId) {
    const tables = tablesFor(db, true);
    return tables.database.transaction("rw", tables.chats, tables.wallet, tables.transactions, async () => {
      const latest = await tables.chats.get(candidate.id);
      if (!latest) throw new Error("找不到原聊天，未进行入账。");
      const original = latest.history.find((message) => message.timestamp === receipt.forTimestamp);
      const updated = candidate.history.find((message) => message.timestamp === receipt.forTimestamp);
      if (!original || !updated || !["transfer", "red_packet"].includes(original.type))
        throw new Error("原转账或红包已删除，未进行入账。");
      if (original.type === "transfer" ?
          original.isReceived || original.isRefund || ["accepted", "declined"].includes(original.status) :
          Object.prototype.hasOwnProperty.call(original.claimedBy || {}, receipt.recipientName) || original.isFullyClaimed)
        throw new Error("已经领取过了，未重复入账。");
      if (!root.ephoneSpectatorMoney.eligible(latest, original).includes(receipt.recipientName))
        throw new Error("收款身份或卡片状态已改变，请重新领取。");
      const previousClaims = Object.fromEntries(Object.entries(updated.claimedBy || {}).filter(([name]) => name !== receipt.recipientName));
      if (original.type === "red_packet" &&
          JSON.stringify(original.claimedBy || {}) !== JSON.stringify(previousClaims))
        throw new Error("红包状态已更新，请重新领取。");
      if (original.type === "transfer" ? moneyCents(original.amount) !== moneyCents(updated.amount) :
          moneyCents(original.totalAmount ?? original.amount) !== moneyCents(updated.totalAmount) ||
          Number(original.count || 1) !== Number(updated.count))
        throw new Error("卡片金额或个数已修改，请重新领取。");
      const actualAmount = original.type === "transfer" ? updated.amount : updated.claimedBy?.[receipt.recipientName];
      if (moneyCents(actualAmount) !== moneyCents(receipt.amount)) throw new Error("领取金额不一致，未进行入账。");
      const result = await addEntry(tables, receipt.amount, "income",
        `${original.type === "transfer" ? "转账" : "红包"}-${original.senderName || "角色"}（以${receipt.recipientName}身份领取）`,
        { timestamp: receipt.timestamp, vts: receipt.vts, chatId: candidate.id, forTimestamp: receipt.forTimestamp,
          recipientName: receipt.recipientName, walletSpaceId: spaceId, moneyReceipt: true });
      Object.assign(receipt, { walletCredited: true, walletSpaceId: spaceId });
      const history = latest.history.map((message) => message.timestamp === receipt.forTimestamp ? updated : message);
      history.push(receipt);
      await tables.chats.put({ ...latest, history });
      candidate.history = history;
      return result;
    });
  }
  const api = { book, creditReceipt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ephoneSpaceWallet = api;
})(typeof window !== "undefined" ? window : globalThis);
