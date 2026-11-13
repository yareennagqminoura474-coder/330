const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity"), market = require("./market-orders"), core = require("./life-market-core");

(async () => {
  const db = new Dexie("market-npc-identity-" + Date.now());
  db.version(1).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", marketState: "&id", marketOrders: "&id,timestamp,status", userWallet: "&id", userTransactions: "++id,timestamp,type" });
  await db.open();
  try {
    // NPCs can keep their original stable identity after a copy or role conversion.
    // A newly added group member may carry only its source NPC id; its archive
    // remains the authority for the stable key and subsequently edited name.
    await db.npcs.put({ id: 7, name: "新名字", ephonePersonKey: "npc:original", persona: "爱好园艺" });
    const members = [{ id: "npc_7", isNpc: true, originalName: "旧名字" }, { id: "friend", originalName: "朋友" }];
    await db.chats.bulkPut([{ id: "friend", name: "朋友", history: [] },
      { id: "normal", isGroup: true, members, history: [] },
      { id: "watch", isGroup: true, isSpectatorGroup: true, members, history: [] }]);
    await db.userWallet.put({ id: "main", balance: 100 });
    await identity.save(db, "npc:original");
    const service = new market.Service(db), store = new core.Store(db), binding = await identity.load(db);
    const target = await service.target(binding, "watch");
    assert.equal(target.chatId, "watch");
    assert.equal(target.recipientName, "新名字");
    const state = core.blank();
    state.cart = [{ item: { id: "rice", name: "蛋炒饭", kind: "food", price: 10, deliveryFee: 2 }, quantity: 1 }];
    await db.marketState.put(state);
    await store.checkout({ orderId: "npc-order", expectedCart: state.cart, owner: binding, target, vts: 1000, spaceId: "test", now: 100 });
    assert.match(await service.prompt(await db.chats.get("watch")), /npc-order/);
    const chat = await db.chats.get("normal");
    chat.history.push({ role: "user", senderName: "新名字", content: "我买了蛋炒饭。", timestamp: 200 });
    await db.chats.put(chat);
    assert.equal((await service.captureDisclosures(chat)).length, 1, "NPC archive aliases disclose the same owner's order");
    assert.equal((await db.marketOrders.get("npc-order")).knownBy.find((p) => p.key === "chat:friend").level, "summary");
    await assert.rejects(service.act({ type: "cancel_market_order", name: "朋友", order_id: "npc-order" }, { chatId: "watch", vts: 2000 }), /操作权限/);
    const cancelled = await service.act({ type: "cancel_market_order", name: "新名字", order_id: "npc-order" }, { chatId: "watch", vts: 2000 });
    assert.equal(cancelled.order.cancelledByKey, "npc:original");
    assert.equal(cancelled.balance, 100);
    const duplicate = await service.act({ type: "cancel_market_order", name: "旧名字", order_id: "npc-order" }, { chatId: "watch", vts: 2000 });
    assert.equal(duplicate.alreadyApplied, true);
    assert.equal((await db.userTransactions.where("type").equals("income").toArray()).reduce((sum, row) => sum + row.amount, 0), 12);
    console.log("PASS: NPC stable identity and archive names work consistently for shopping targets, order memory, disclosure and idempotent refunds");
  } finally { await db.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
