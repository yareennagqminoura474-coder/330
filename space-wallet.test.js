// Requires dexie and fake-indexeddb (test-only; not shipped to the browser).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
require("fake-indexeddb/auto");
const Dexie = require("dexie");
const wallets = require("./space-wallet.js");
const money = require("./spectator-money.js");

(async () => {
  const name = `ephone-wallet-test-${Date.now()}`;
  const shared = new Dexie(name);
  shared.version(49).stores({ chats: "&id", npcs: "++id", memories: "++id", callRecords: "++id",
    qzonePosts: "++id", npcGroups: "++id", userWallet: "&id", userTransactions: "++id, timestamp, type",
    globalSettings: "&id", apiConfig: "&id" });
  await shared.open();
  await shared.userWallet.put({ id: "main", balance: 150, kinshipCards: [{ chatId: "old", limit: 100 }], fundHoldings: [{ fundId: "one", units: 20 }] });
  await shared.userTransactions.add({ type: "income", amount: 150, timestamp: 1, description: "旧账单" });
  await shared.globalSettings.put({ id: "main", theme: "old-theme" });
  const storage = new Map([['ephone-persona-spaces-v1', JSON.stringify([
    { id: "default", name: "默认空间" }, { id: "a", name: "现代" }, { id: "b", name: "古代" },
  ])]]);
  let db, refreshes = [];
  const window = { Dexie, EPHONE_DB_BASE_NAME: name,
    refreshPersonaSpaceData: async () => { refreshes.push({ space: window.EPHONE_SPACE_ID, balance: (await db.userWallet.get("main"))?.balance ?? 0 }); } };
  const sandbox = { window, document: { addEventListener() {} }, console, structuredClone,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
  vm.runInNewContext(fs.readFileSync("persona-spaces.js", "utf8"), sandbox);
  db = window.EPhoneSpaces.bindDatabases(shared, shared, "default");
  assert.equal((await db.userWallet.get("main")).balance, 150);
  await window.EPhoneSpaces.switchSpace("a");
  assert.equal(await db.userWallet.count(), 0);
  assert.equal(await db.userTransactions.count(), 0);
  assert.equal(db.userWallet.db, db.chats.db);
  assert.equal(db.userTransactions.db, db.chats.db);
  assert.equal(db.globalSettings.db, shared);
  assert.equal((await db.globalSettings.get("main")).theme, "old-theme");
  await wallets.book(db, 10, "income", "A充值");
  assert.equal((await db.userWallet.get("main")).balance, 10);
  assert.equal((await shared.userWallet.get("main")).balance, 150);
  assert.equal(await shared.userTransactions.count(), 1);
  await window.EPhoneSpaces.switchSpace("b");
  assert.equal(await db.userTransactions.count(), 0);
  await wallets.book(db, 20, "income", "B充值");
  const result = await wallets.book(db, 30, "expense", "余额不足");
  assert.equal(result.ok, false);
  assert.equal((await db.userWallet.get("main")).balance, 20);
  assert.equal(await db.userTransactions.count(), 1);

  const chat = { id: "watch", isSpectatorGroup: true, isGroup: true, members: [
    { originalName: "付款角色" }, { originalName: "代聊角色" },
  ], history: [{ type: "transfer", senderName: "付款角色", receiverName: "代聊角色", amount: 12.34, timestamp: 100 }] };
  await db.chats.put(chat);
  const options = { now: 200, vts: 2026,
    save: (candidate, receipt) => wallets.creditReceipt(db, candidate, receipt, "b") };
  const receipt = await money.receive(chat, 100, "代聊角色", options);
  assert.equal((await db.userWallet.get("main")).balance, 32.34);
  assert.equal(await db.userTransactions.count(), 2);
  assert.equal(receipt.walletCredited, true);
  assert.equal(receipt.walletSpaceId, "b");
  const bill = (await db.userTransactions.toArray()).at(-1);
  assert.equal(bill.vts, 2026);
  assert.equal(bill.recipientName, "代聊角色");
  assert.match(bill.description, /以代聊角色身份领取/);
  const reloaded = await db.chats.get(chat.id);
  assert.equal(reloaded.history[0].status, "accepted");
  await assert.rejects(money.receive(reloaded, 100, "代聊角色", options));
  assert.equal((await db.userWallet.get("main")).balance, 32.34);

  // A different tab's stale copy cannot credit the same transfer twice.
  const stale = { ...chat, history: [{ ...chat.history[0], status: "pending" }] };
  await assert.rejects(money.receive(stale, 100, "代聊角色", options), /已经领取/);
  assert.equal(await db.userTransactions.count(), 2);
  const packetChat = { ...chat, id: "packet", history: [{ type: "red_packet", senderName: "付款角色", receiverName: "代聊角色",
    packetType: "direct", count: 1, totalAmount: 5.66, claimedBy: {}, timestamp: 101 }] };
  await db.chats.put(packetChat);
  await money.receive(packetChat, 101, "代聊角色", options);
  assert.equal((await db.userWallet.get("main")).balance, 38);
  assert.equal((await db.chats.get("packet")).history[0].claimedBy["代聊角色"], 5.66);

  // Abort after the wallet write: IndexedDB rolls back money, bills and receipt.
  const failure = { ...chat, id: "failure", history: [{ ...chat.history[0], status: "pending", timestamp: 102 }] };
  await db.chats.put(failure);
  const hook = db.chats.hook("updating", () => { throw new Error("模拟聊天写入失败"); });
  await assert.rejects(money.receive(failure, 102, "代聊角色", options), /模拟聊天写入失败/);
  db.chats.hook("updating").unsubscribe(hook);
  assert.equal((await db.userWallet.get("main")).balance, 38);
  assert.equal(await db.userTransactions.count(), 3);
  assert.equal((await db.chats.get("failure")).history[0].status, "pending");
  assert.equal(failure.history.length, 1);

  const oldTransactionHook = db.userTransactions.hook("creating", () => { throw new Error("模拟账单失败"); });
  await assert.rejects(wallets.book(db, 10, "income", "失败入账"), /模拟账单失败/);
  db.userTransactions.hook("creating").unsubscribe(oldTransactionHook);
  assert.equal((await db.userWallet.get("main")).balance, 38);
  assert.equal(await db.userTransactions.count(), 3);
  assert.throws(() => db.transaction("rw", db.userWallet, db.globalSettings, async () => {}), /混合/);
  window.isPersonaSpaceBusy = () => true;
  await assert.rejects(window.EPhoneSpaces.switchSpace("a"), /正在回复或处理收付款/);
  assert.equal(window.EPHONE_SPACE_ID, "b");
  window.isPersonaSpaceBusy = () => false;

  await window.EPhoneSpaces.switchSpace("a");
  assert.equal((await db.userWallet.get("main")).balance, 10);
  assert.equal(await db.userTransactions.count(), 1);
  await window.EPhoneSpaces.switchSpace("default");
  const legacy = await db.userWallet.get("main");
  assert.equal(legacy.balance, 150);
  assert.equal(legacy.kinshipCards[0].limit, 100);
  assert.equal(legacy.fundHoldings[0].units, 20);
  assert.equal(await db.userTransactions.count(), 1);
  assert.deepEqual(refreshes.map((item) => item.space), ["a", "b", "a", "default"]);
  db.close();
  // Only these newly-created test databases are removed, never application data.
  for (const testName of [name, `${name}__space_a`, `${name}__space_b`]) await Dexie.delete(testName);
  console.log("Real Dexie/IndexedDB wallet isolation, legacy preservation and atomic receipt tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
