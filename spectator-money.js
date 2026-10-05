(function (root) {
  "use strict";
  // Fictional chat cards. The player clicks as their stand-in character and the
  // save callback credits the player's current space wallet atomically.
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const cents = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && Number.isSafeInteger(Math.round(number * 100))
      ? Math.round(number * 100) : 0;
  };
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  function resolve(chat, name) {
    const members = (chat.members || []).filter((member) =>
      [member.originalName, member.groupNickname, member.name].filter(Boolean).includes(name));
    return members.length === 1 ? members[0].originalName || members[0].name : null;
  }
  function normalize(item, base, profiles, resolveSpeaker) {
    if (!["transfer", "red_packet"].includes(item.type)) return null;
    const receiver = item.receiverName || item.receiver;
    const receiverName = receiver ? resolveSpeaker(profiles, receiver) : null;
    const amount = cents(item.amount ?? item.totalAmount);
    if (!amount) return null;
    if (item.type === "transfer") {
      if (!receiverName || receiverName === base.senderName) return null;
      return { ...base, type: "transfer", amount: amount / 100,
        receiverName, note: String(item.note || ""), status: "pending" };
    }
    const packetType = item.packetType || (receiver ? "direct" : "lucky");
    if (!["direct", "lucky"].includes(packetType) ||
        (packetType === "direct" && (!receiverName || receiverName === base.senderName))) return null;
    const count = packetType === "direct" ? 1 : Number(item.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > amount || count > profiles.length) return null;
    return { ...base, type: "red_packet", totalAmount: amount / 100, count,
      packetType, ...(receiverName ? { receiverName } : {}),
      greeting: String(item.greeting || "恭喜发财，大吉大利！"), claimedBy: {}, isFullyClaimed: false };
  }
  function eligible(chat, message) {
    if (message.type === "transfer" &&
        (message.isReceived || message.isRefund || ["accepted", "declined"].includes(message.status))) return [];
    if (message.type === "red_packet" && (message.isFullyClaimed ||
        Object.keys(message.claimedBy || {}).length >= Number(message.count || 1))) return [];
    if (!cents(message.type === "transfer" ? message.amount : message.totalAmount ?? message.amount)) return [];
    const fixed = message.type === "transfer" || message.packetType === "direct";
    const target = resolve(chat, message.receiverName || message.receiver);
    // Old edited cards often defaulted to "我" without a role. Ask explicitly,
    // rather than silently crediting a different person or the observer's wallet.
    if (fixed && !target && ![undefined, "", "我", "{{user}}"].includes(message.receiverName || message.receiver)) return [];
    return [...new Set((chat.members || []).map((member) => member.originalName || member.name).filter(Boolean))]
      .filter((name) => (!fixed || !target || target === name) &&
        (message.type !== "transfer" && message.packetType !== "direct" || name !== resolve(chat, message.senderName)) &&
        !owns(message.claimedBy, name));
  }
  function describe(message) {
    if (message.type === "transfer") {
      const state = message.isRefund || message.status === "declined" ? "已拒收" :
        message.isReceived || message.status === "accepted" ? `已接收（收款人：${message.acceptedBy || message.receiverName || "未记录"}）` : "未接收，等待手动接收";
      return `[转账：${message.senderName || "角色"} → ${message.receiverName || "待选择收款角色"}，¥${Number(message.amount).toFixed(2)}；${state}；备注：${message.note || "无"}]`;
    }
    if (message.type === "red_packet") {
      const claims = Object.entries(message.claimedBy || {}).map(([name, amount]) => `${name} ¥${Number(amount).toFixed(2)}`).join("、") || "无人领取";
      const count = Number(message.count || 1);
      const remaining = Math.max(0, count - Object.keys(message.claimedBy || {}).length);
      return `[${message.packetType === "direct" ? `专属红包给${message.receiverName || "待选择角色"}` : "拼手气红包"}：${message.senderName || "角色"}发出，¥${Number(message.totalAmount ?? message.amount).toFixed(2)}，${count}个；已领取：${claims}；${message.isFullyClaimed || !remaining ? "已领完" : `剩余${remaining}个，等待手动领取`}；祝福：${message.greeting || "无"}]`;
    }
    return "";
  }
  function ledger(chat) {
    const cards = (chat.history || []).filter((message) => !message.isHidden &&
      ["transfer", "red_packet"].includes(message.type) && !message.isReceived && !message.isRefund);
    const pending = (message) => message.type === "transfer" ? !["accepted", "declined"].includes(message.status) :
      !message.isFullyClaimed && Object.keys(message.claimedBy || {}).length < Number(message.count || 1);
    const settled = cards.filter((message) => !pending(message)).slice(-30);
    const shown = cards.filter((message) => pending(message) || settled.includes(message));
    return shown.length ? "\n# 转账和红包的实际状态（以系统卡片为准，不以台词猜测）\n" +
      shown.map((message) => `(Timestamp: ${message.timestamp}) ${describe(message)}`).join("\n") + "\n" : "";
  }
  const prompt = "\n# 观看模式转账与红包\n" +
    "角色真正转账必须输出卡片指令，不要仅用 text/narration 说‘已转账’。金额必须为正数，name和receiver必须用群成员本名。\n" +
    '转账：{"type":"transfer","name":"付款角色本名","receiver":"收款角色本名","amount":100,"note":"备注"}\n' +
    '专属红包：{"type":"red_packet","name":"发送角色本名","receiver":"领取角色本名","packetType":"direct","amount":20,"count":1,"greeting":"祝福"}\n' +
    '拼手气红包：{"type":"red_packet","name":"发送角色本名","packetType":"lucky","amount":20,"count":2,"greeting":"祝福"}\n' +
    "红包个数不得超过群成员人数，每份至少0.01。观看者会手动替收款角色点击接收/领取；你不可自行输出accept_transfer/open_red_packet指令或擅自宣称已收款。只有系统状态为已接收/claimedBy中存在该角色，才能写其已收款；未领取时可以提醒领取，不要重复转账代替领取。\n";

  function render(chat, message) {
    const terminal = message.isReceived || message.isRefund ||
      (message.type === "transfer" ? ["accepted", "declined"].includes(message.status) :
        message.isFullyClaimed || Object.keys(message.claimedBy || {}).length >= Number(message.count || 1));
    const action = message.type === "transfer" ? "接收" : "领取";
    return `<div class="ephone-spectator-money-card"><div>${escape(message.type === "transfer" ? "转账" : "红包")}</div>` +
      `<div class="transfer-amount">¥ ${escape(Number(message.amount ?? message.totalAmount).toFixed(2))}</div>` +
      `<div class="ephone-money-description">${escape(describe(message))}</div>` +
      (!terminal && eligible(chat, message).length ? `<button type="button" class="ephone-money-receive">${action}</button><div class="ephone-money-wallet-note">手动领取后存入本空间的钱包</div>` : "") + "</div>";
  }
  // Save a candidate before committing to in-memory state, so a failed write
  // never produces a phantom receipt. The caller serializes clicks/generation.
  async function receive(chat, timestamp, recipient, { save, now = Date.now(), vts = now, random = Math.random } = {}) {
    const index = (chat.history || []).findIndex((message) => message.timestamp === timestamp);
    const original = chat.history[index];
    if (!original || !eligible(chat, original).includes(recipient)) throw new Error("该角色无法领取，或已经领取过了。");
    const message = JSON.parse(JSON.stringify(original));
    let amount;
    if (message.type === "transfer") {
      amount = cents(message.amount) / 100;
      Object.assign(message, { status: "accepted", receiverName: recipient, acceptedBy: recipient, acceptedAt: now, acceptedVts: vts });
    } else {
      const total = cents(message.totalAmount ?? message.amount);
      const claims = { ...(message.claimedBy || {}) };
      const left = Number(message.count || 1) - Object.keys(claims).length;
      const remaining = total - Object.values(claims).reduce((sum, value) => sum + cents(value), 0);
      if (!Number.isSafeInteger(left) || left < 1 || remaining < left) throw new Error("红包金额或剩余个数异常，无法领取。");
      const allocations = message.unclaimedAmounts;
      let share = left === 1 ? remaining : Math.max(1, Math.floor(random() * Math.min(remaining - left + 1, 2 * remaining / left)));
      if (Array.isArray(allocations) && allocations.length === left) {
        const allocated = cents(allocations.at(-1));
        if (allocated >= 1 && allocated <= remaining - left + 1 && (left !== 1 || allocated === remaining)) share = allocated;
        message.unclaimedAmounts = allocations.slice(0, -1);
      }
      amount = share / 100;
      Object.defineProperty(claims, recipient, { value: amount, enumerable: true, configurable: true, writable: true });
      Object.assign(message, { claimedBy: claims, isFullyClaimed: left === 1, totalAmount: total / 100,
        count: Number(message.count || 1), claimedVts: { ...(message.claimedVts || {}), [recipient]: vts } });
      if (message.packetType === "direct") message.receiverName = recipient;
    }
    const receipt = { role: "system", type: "pat_message", moneyReceipt: true, forTimestamp: timestamp,
      recipientName: recipient, amount, timestamp: Math.max(now, ...chat.history.slice(-10).map((item) => Number(item.timestamp) + 1 || 0)), vts,
      content: `${recipient} 已${message.type === "transfer" ? "接收" : "领取"} ${message.senderName || "角色"} 的${message.type === "transfer" ? "转账" : "红包"} ¥${amount.toFixed(2)}${message.isFullyClaimed ? "（红包已领完）" : ""}` };
    const history = chat.history.slice();
    history[index] = message;
    history.push(receipt);
    const candidate = { ...chat, history };
    await save(candidate, receipt);
    chat.history = candidate.history;
    return receipt;
  }
  const api = { normalize, eligible, describe, ledger, prompt, render, receive, escape };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ephoneSpectatorMoney = api;
})(typeof window !== "undefined" ? window : globalThis);
