(function (root) {
  "use strict";
  const text = (value, max = 300) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const money = (value) => Number(value || 0).toFixed(2);
  const itemsText = (order) => (order.items || []).map((line) => `${line.item.name}×${line.quantity}`).join("、");
  const pricedItemsText = (order) => {
    const details = root.ephoneLifeMarketCore?.orderBreakdown(order);
    return details ? details.lines.map((line) => `${line.name}×${line.quantity}（单价¥${money(line.unitPrice)}，小计¥${money(line.amount)}）`).join("、") : itemsText(order);
  };
  const statusText = (order) => order.status === "cancelled" ? "已取消·已退款" : order.status === "delivered" ? "已到货" : "已支付·待到货";
  function makeMessage(order, event, base = {}) {
    const details = root.ephoneLifeMarketCore?.orderBreakdown(order);
    const actor = text(base.actorName || order.ownerName || "用户", 80);
    const audience = (order.knownBy || []).map((person) => person.name).join("、") || "原订单通知聊天中的角色";
    const note = event === "cancelled" ? `${actor}取消订单，¥${money(order.total)}已原路退回本空间钱包。` :
      event === "inspected" ? `${actor}实际查看了${order.ownerName}的手机订单页，获知订单详情。` :
      event === "shared" ? `${actor}告知了订单，听到的人只知道被告知的内容。` :
      event === "delivered" ? `${actor}确认到货；只有列入知情名单的在场角色看到商品。` :
      event === "forwarded" ? `订单卡片已放入本群，当前状态：${statusText(order)}。本次没有再次下单或扣款；卡片不是全群公告。` :
      `已为${order.recipientName}下单，已从本空间钱包支付，尚未到货。`;
    return { ...base, role: "system", type: "market_order", marketOrder: true, orderId: order.id, orderEvent: event,
      privateOrder: Boolean(order.ownerKey), ownerKey: order.ownerKey, actorName: actor,
      orderSnapshot: { id: order.id, status: order.status, recipientName: order.recipientName, ownerName: order.ownerName,
        ownerKey: order.ownerKey, items: itemsText(order), total: order.total, cancelledBy: order.cancelledBy,
        knownBy: order.knownBy || [], reason: order.cancelReason || "",
        lineItems: details?.lines || [], deliveryFees: details?.deliveryFees || [], delivery: order.delivery },
      content: `【逛逛订单 ${order.id}；${statusText(order)}；${order.ownerKey ? "私有记忆，不是全群公告" : "订单通知"}】${note} 商品：${itemsText(order)}。金额¥${money(order.total)}。知情范围：${audience}。未列入的角色不知道；听说或到货看到不等于知道订单金额及手机内详情。` };
  }

  class Service {
    constructor(db, identity = root.ephonePlayerIdentity) {
      this.db = db.marketOrders.db; this.identity = identity;
      this.orders = this.db.table("marketOrders"); this.chats = this.db.table("chats");
      this.wallet = this.db.table("userWallet"); this.bills = this.db.table("userTransactions");
    }
    async target(binding, activeChatId) {
      const chats = await this.chats.toArray();
      if (binding && !binding.valid) throw new Error("本空间绑定角色已移走或删除，请到“我”重新绑定。");
      if (!binding?.key) return null;
      const eligible = chats.filter((chat) => this.identity.participants(chat, chats).some((person) => person.key === binding.key));
      const chat = eligible.find((item) => item.id === activeChatId) || eligible.find((item) => item.isSpectatorGroup) || eligible[0];
      if (!chat) throw new Error("请先把绑定角色加入一个聊天，再购物或点外卖。");
      return { chatId: chat.id, recipientName: binding.name, forSelf: true };
    }
    async postCard(orderId, chatId, { vts, now = Date.now() } = {}) {
      if (!Number.isFinite(vts)) throw new Error("订单发送时间无效。");
      return this.db.transaction("rw", this.orders, this.chats, async () => {
        const order = await this.orders.get(orderId), chat = await this.chats.get(chatId);
        if (!order) throw new Error("订单不存在或不属于当前空间。");
        if (!chat || !(chat.isGroup || chat.isSpectatorGroup)) throw new Error("请选择本空间仍然存在的群聊。");
        if ((chat.history || []).some((message) => message.marketOrder && message.orderId === order.id)) return { order, chats: [], alreadyPosted: true };
        const message = makeMessage(order, "forwarded", { timestamp: Math.max(now, Number(chat.history?.at(-1)?.timestamp || 0) + 1), vts });
        chat.history ||= []; chat.history.push(message);
        order.cardChatIds = [...new Set([order.chatId, ...(order.cardChatIds || []), chat.id].filter((id) => id != null))];
        await this.orders.put(order); await this.chats.put(chat);
        return { order, chats: [chat], alreadyPosted: false };
      });
    }
    async adopt(binding) {
      if (!binding?.valid) return { chats: [] };
      return this.db.transaction("rw", this.orders, this.chats, async () => {
        const orders = await this.orders.toArray(), chats = await this.chats.toArray(), updated = [];
        for (const order of orders) {
          if (order.ownerKey) continue; // Rebinding never transfers previous owners' memories.
          Object.assign(order, { ownerKey: binding.key, ownerName: binding.name, privateOrder: true,
            knownBy: [{ key: binding.key, name: binding.name, level: "details", source: "owner" }], phoneAccess: [binding.key] });
          await this.orders.put(order);
          for (const chat of chats) {
            let changed = false;
            chat.history = (chat.history || []).map((message) => {
              if (!message.marketOrder || message.orderId !== order.id) return message;
              changed = true; return makeMessage(order, message.orderEvent || "placed", message);
            });
            if (changed) { await this.chats.put(chat); if (!updated.some((item) => item.id === chat.id)) updated.push(chat); }
          }
        }
        return { chats: updated };
      });
    }
    async prompt(chat) {
      const chats = await this.chats.toArray(), people = this.identity.participants(chat, chats);
      const keys = new Set(people.map((person) => person.key));
      const current = (await this.orders.orderBy("timestamp").reverse().toArray()).filter((order) =>
        order.ownerKey ? keys.has(order.ownerKey) || (order.knownBy || []).some((person) => keys.has(person.key)) : order.chatId === chat.id || (order.cardChatIds || []).includes(chat.id)).slice(0, 40);
      const binding = await this.identity.load(this.db);
      // No current order means no order actions can be executed. Keep identity
      // and privacy boundaries without sending a whole unused action manual.
      if (!current.length) return "\n# 本空间角色身份与订单记忆边界（高优先级）\n" +
        (binding?.key ? `本空间绑定角色是 ${binding.name}，身份标识 ${binding.key}，购物/外卖属于此角色。\n` : "本空间尚未绑定代替用户的角色。\n") +
        "当前没有本聊天人物相关的订单。不要编造已下单、到货、取消、退款或订单ID；其他人物的私人订单不是本聊天的共同记忆。\n";
      return "\n# 本空间角色身份与订单记忆边界（高优先级）\n" +
        (binding?.key ? `本空间绑定角色是 ${binding.name}，身份标识 ${binding.key}，其购物/外卖属于此角色，不属于额外的用户。\n` : "本空间尚未绑定代替用户的角色。\n") +
        "以下是作者用于维持剧情一致性的后台数据，不是全群公告，也不是每个角色都能看到的手机屏幕。只有owner及knownBy中的角色拥有相应知识；owner/details可知订单金额和完整详情，summary只知道disclosedText中的内容或到货看到的商品；主人明确说出的价格可以知道，未被明确告知的价格和手机内信息不可知道。知道下单不等于知道后来的取消或到货，除非实际获知。没有被列入的角色不得在台词、心理或行动中引用该订单，不得因看见历史订单卡片、总结、共享记忆就变成知情。历史或总结推测与此账本冲突时，以账本为准。未被告知的角色不能凭空吃醋、责备、阻止或取消订单。\n" +
        "角色实际告知/查看手机/目睹到货/取消订单时，除自然台词动作外，必须输出对应JSON指令以同步商城，不能只在文字里声称完成。用户以主人身份输入的实际告知台词也需要补发告知指令，再让真正听到者作出反应。观看群的成员不一定都在同一场景：只列真正听到/看到的人，不能把全体成员自动加入知情名单。仅有意愿、假设、否定、未成功的抢手机不能发成功指令。一次回复有多个事件时按发生顺序输出。\n" +
        '告知：{"type":"market_order_share","name":"订单主人本名","order_id":"准确订单ID","audience":["实际听到的角色本名"],"content":"主人实际说出的订单信息"}；仅主人可以主动披露，不自动全群通知。\n' +
        '查看手机：{"type":"market_phone_check","name":"实际查看者本名","order_id":"准确订单ID","content":"已实际拿到并打开该角色手机订单页的动作"}；需要符合人物、同场景和实际拿到手机的前提，不能因为想查或听说就自动查看成功。此事件会生成可见卡片并授予查看者订单详情与操作权限。\n' +
        '到货：{"type":"market_order_arrived","name":"确认到货的在场角色本名","order_id":"准确订单ID","audience":["确实看到到货的角色本名"],"content":"到货和看到商品的实际情景"}；没有实际到货不要使用，不因为现实时间过去就自动把所有人设为知情。\n' +
        '取消：{"type":"cancel_market_order","name":"操作角色本名","order_id":"准确订单ID","reason":"取消原因"}；只有订单主人或实际查看并拿到手机的角色可以操作。抢手机取消时必须先输出market_phone_check，再取消；已到货或已取消不能再取消退款，退款以系统结果为准，不能编造其他金额。\n' +
        "本聊天角色身份：" + JSON.stringify(people) + "\n实际订单账本（私有与已公开部分严格分开；仅列出最近40笔相关订单，未列出不等于不存在，缺失信息不得编造）：" + JSON.stringify(current.map((order) => ({
          id: order.id, ownerKey: order.ownerKey || null, ownerName: order.ownerName || "原用户", recipient: order.recipientName,
          status: order.status, orderedAt: order.vts, knownBy: order.knownBy || [], phoneAccess: order.phoneAccess || [],
          ownerOnlyDetails: { items: pricedItemsText(order),
            deliveryFees: (root.ephoneLifeMarketCore?.orderBreakdown(order)?.deliveryFees || []).map(({ merchant, amount }) => ({ merchant, amount })),
            amount: order.total, cancelledBy: order.cancelledBy || null, cancelReason: order.cancelReason || null },
        }))) + "\n";
    }
    async captureDisclosures(chat) {
      const chats = await this.chats.toArray(), people = this.identity.participants(chat, chats);
      const orders = await this.orders.toArray(), results = [];
      for (const message of (chat.history || []).slice(-20)) {
        if (message.isHidden || message.marketOrder || message.role === "system" || ["narration", "thought_chain"].includes(message.type)) continue;
        const speaker = this.identity.resolve(people, message.senderName || (message.role === "assistant" && !chat.isGroup ? chat.originalName || chat.name : ""));
        const content = text(message.content, 2000);
        if (!speaker || !/(?:我(?:刚刚|刚|已经)?(?:买了|点了|订了|下单了)|我(?:的)?(?:订单|外卖|快递)|已经下单|刚下单)/.test(content) ||
          /(?:没(?:有)?(?:买|点|订|下单)|不告诉|没告诉|如果|假如|准备(?:买|点|订)|打算(?:买|点|订))/.test(content)) continue;
        for (const order of orders) {
          if (order.ownerKey !== speaker.key || Number(message.timestamp) < Number(order.timestamp)) continue;
          if (!content.includes(order.id) && !(order.items || []).some((line) => content.includes(line.item.name))) continue;
          // Public ordinary-chat text is heard by its recipients. In watch
          // mode membership alone does not prove physical presence/hearing;
          // require the story's explicit audience event instead of guessing.
          if (chat.isSpectatorGroup) continue;
          const audience = people.filter((person) => person.key !== speaker.key);
          if (!audience.length) continue;
          const disclosureId = `${chat.id}:${message.timestamp}:${speaker.key}`;
          if ((order.disclosures || []).includes(disclosureId)) continue;
          results.push(await this.act({ type: "market_order_share", name: speaker.name, order_id: order.id, audience: audience.map((person) => person.name), content, disclosureId },
            { chatId: chat.id, vts: message.vts || order.vts }));
        }
      }
      return results;
    }
    async act(action, { chatId, vts, timestamp = Date.now() }) {
      const types = ["market_order_share", "market_phone_check", "market_order_arrived", "cancel_market_order"];
      if (!types.includes(action.type)) return null;
      return this.db.transaction("rw", this.orders, this.chats, this.wallet, this.bills, async () => {
        const chats = await this.chats.toArray(), chat = chats.find((item) => item.id === chatId);
        if (!chat) throw new Error("订单操作聊天已不存在。");
        const people = this.identity.participants(chat, chats), actor = this.identity.resolve(people, action.name);
        if (!actor) throw new Error("订单操作角色不在当前聊天，或身份不明确。");
        const order = await this.orders.get(String(action.order_id || ""));
        if (!order) throw new Error("订单不存在或不属于当前空间。");
        const ownerPresent = people.some((person) => person.key === order.ownerKey);
        if (!ownerPresent && !(order.knownBy || []).some((person) => person.key === actor.key)) throw new Error("当前角色尚不知情，且订单主人不在此聊天，不能访问其手机订单。");
        const owner = actor.key === order.ownerKey;
        const before = JSON.stringify(order);
        let event;
        const audience = (Array.isArray(action.audience) ? action.audience : []).map((name) => this.identity.resolve(people, name));
        if (audience.some((person) => !person)) throw new Error("订单知情名单包含非当前聊天角色或不明确的身份。");
        function know(person, level, source, disclosedText) {
          order.knownBy ||= [];
          const entry = order.knownBy.find((item) => item.key === person.key);
          if (entry?.level === "details") return;
          if (entry?.disclosedText && disclosedText && !entry.disclosedText.includes(disclosedText)) disclosedText = text(entry.disclosedText + "；" + disclosedText, 2000);
          const next = { key: person.key, name: person.name, level, source, disclosedText };
          if (entry) Object.assign(entry, next); else order.knownBy.push(next);
        }
        if (action.type === "market_order_share") {
          if (!owner) throw new Error("只有订单主人可以主动披露自己的私有订单。");
          if (!text(action.content) || !audience.length) throw new Error("告知订单需要实际说出的内容和明确听到者。");
          if (action.disclosureId && (order.disclosures || []).includes(action.disclosureId)) return { order, chats: [], alreadyApplied: true };
          audience.forEach((person) => know(person, "summary", "owner_told", text(action.content)));
          if (action.disclosureId) order.disclosures = [...(order.disclosures || []), action.disclosureId];
          event = "shared";
        } else if (action.type === "market_phone_check") {
          if (!ownerPresent) throw new Error("订单主人不在当前聊天，不能凭空查看手机。");
          if (!text(action.content)) throw new Error("查看手机需要实际成功查看订单页的动作。");
          know(actor, "details", "phone_checked", text(action.content));
          order.phoneAccess = [...new Set([...(order.phoneAccess || []), actor.key])]; event = "inspected";
        } else if (action.type === "market_order_arrived") {
          if (!text(action.content)) throw new Error("需要实际到货情景，不能凭时间自动通知所有角色。");
          if (order.status === "cancelled") throw new Error("已取消订单不能再到货。");
          know(actor, "summary", "saw_delivery", "看到到货商品：" + itemsText(order));
          audience.forEach((person) => know(person, "summary", "saw_delivery", "看到到货商品：" + itemsText(order)));
          order.status = "delivered"; order.deliveredVts = vts; event = "delivered";
        } else {
          if (!owner && !(order.phoneAccess || []).includes(actor.key)) throw new Error("当前角色未实际查看并取得手机操作权限，不能取消订单。");
          if (order.status === "cancelled") return { order, chats: [], alreadyApplied: true, balance: (await this.wallet.get("main"))?.balance || 0 };
          if (order.status !== "paid") throw new Error("这笔订单已经到货或不支持取消，未退款。");
          const wallet = await this.wallet.get("main") || { id: "main", balance: 0 };
          const balance = Math.round(Number(wallet.balance || 0) * 100), refund = Math.round(Number(order.total) * 100);
          if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(refund) || refund <= 0 || !Number.isSafeInteger(balance + refund)) throw new Error("订单退款金额无效。");
          await this.wallet.put({ ...wallet, balance: (balance + refund) / 100 });
          for (const bill of root.ephoneLifeMarketCore.orderBills(order, "income", { timestamp, vts, refundedBy: actor.name })) await this.bills.add(bill);
          Object.assign(order, { status: "cancelled", cancelledBy: actor.name, cancelledByKey: actor.key, cancelReason: text(action.reason), cancelledVts: vts, refundedAmount: refund / 100 });
          event = "cancelled";
        }
        if (before === JSON.stringify(order)) return { order, chats: [], alreadyApplied: true };
        await this.orders.put(order);
        const updated = [], notifications = [];
        for (const candidate of chats) {
          let changed = false;
          candidate.history = (candidate.history || []).map((message) => {
            if (!message.marketOrder || message.orderId !== order.id) return message;
            changed = true; return makeMessage(order, message.orderEvent || "placed", message);
          });
          if (candidate.id === chatId || (event === "cancelled" && candidate.id === order.chatId)) {
            const message = makeMessage(order, event, { timestamp: Math.max(timestamp, Number(candidate.history.at(-1)?.timestamp || 0) + 1), vts, actorName: actor.name });
            candidate.history.push(message); notifications.push({ chatId: candidate.id, message }); changed = true;
          }
          if (changed) { await this.chats.put(candidate); updated.push(candidate); }
        }
        return { order, chats: updated, notifications, balance: (await this.wallet.get("main"))?.balance || 0 };
      });
    }
  }
  const api = { Service, makeMessage, statusText, itemsText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ephoneMarketOrders = api;
})(typeof window !== "undefined" ? window : globalThis);
