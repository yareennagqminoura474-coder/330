const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity"), core = require("./character-wallet-core");
global.ephoneLifeMarketCore = require("./life-market-core");
const at = (day, hour = 9) => new Date(2026, 2, day, hour).getTime();
(async () => {
  const db = new Dexie("wallet-daily-bills-" + Date.now());
  db.version(1).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", userWallet: "&id", userTransactions: "++id,timestamp,type", characterWallets: "&key", characterTransactions: "&id,key,vts,category", marketOrders: "&id" });
  try {
    await db.open();
    const role = { id: "a", name: "甲", history: [] }, other = { id: "b", name: "乙", history: [] };
    await db.chats.bulkPut([role, other]);
    const service = new core.Service(db, identity), key = "chat:a", group = { isGroup: true, isSpectatorGroup: true, members: [{ id: "a", originalName: "甲" }] };
    await db.characterWallets.put({ key, balance: 300000, configured: true, automatic: false, rules: [] });
    const rows = Array.from({ length: 26 }, (_, i) => ({ id: "daily:" + i, key, direction: i % 2 ? "expense" : "income", amount: i + 0.1,
      vts: at(i + 1), timestamp: i, status: "posted", category: i % 2 ? "food" : "salary", description: i % 2 ? "第" + (i + 1) + "天早餐" : "第" + (i + 1) + "天兼职收入" }));
    await db.characterTransactions.bulkPut(rows);
    await db.characterTransactions.bulkPut([
      { id: "food", key, direction: "expense", amount: 10.2, vts: at(1, 12), status: "posted", category: "food", description: "午餐炒饭", estimated: true, estimate: { reason: "按餐厅菜单估价" } },
      { id: "allowance", key, direction: "income", amount: 100, vts: at(1, 13), status: "posted", category: "allowance", description: "收到乙的生活费", counterpartyKey: "chat:b" },
      { id: "setup", key, direction: "income", amount: 300000, vts: at(1, 7), status: "posted", category: "adjustment", description: "设定初始资产", adjustment: true },
      { id: "failed", key, direction: "expense", amount: 0, plannedAmount: 999999, vts: at(1, 14), status: "insufficient", category: "shopping", description: "余额不足未买成的车" },
      { id: "future", key, direction: "income", amount: 9999, vts: at(30), status: "posted", description: "未来到账不得提前知道" },
      { id: "private-other", key: "chat:b", direction: "expense", amount: 888, vts: at(1), status: "posted", description: "乙的私有秘密账单" }
    ]);
    const before = await db.characterTransactions.toArray();
    for (const chat of [role, { ...group, isSpectatorGroup: false }, group]) {
      const context = await service.replyContext(chat, at(27));
      const bills = context.records[0].dailyBills;
      assert.equal(bills.length, 26, "all historical days, not just the last 12 transactions");
      const first = bills[0]; assert.equal(first.date, "2026-03-01");
      assert.equal(first.income, 100.1); assert.equal(first.expense, 10.2); assert.equal(first.net, 89.9); assert.equal(first.adjustment, 300000);
      assert.equal(first.entries.length, 5, "same-day details are not summarized away");
      assert.equal(first.entries.find((e) => e.description === "收到乙的生活费").counterparty, "乙");
      assert.equal(first.entries.find((e) => e.description === "午餐炒饭").estimateReason, "按餐厅菜单估价");
      assert.equal(first.entries.find((e) => e.status === "insufficient").plannedAmount, 999999);
      assert.equal(bills.at(-1).date, "2026-03-26");
      assert.match(context.reminder, /2026-03-01/); assert.match(context.reminder, /每天的账单/);
      assert.match(context.prompt, /第1天兼职收入/); assert.match(context.prompt, /第26天早餐/);
      assert.doesNotMatch(context.prompt, /未来到账不得提前知道|乙的私有秘密账单/);
      assert.equal((context.prompt.match(/午餐炒饭/g) || []).length, 1, "bill description is included once, with no duplicate recent list");
    }
    assert.deepEqual(await db.characterTransactions.toArray(), before, "reading daily bills must not post them again");
    await db.characterTransactions.update("food", { amount: 20.2, description: "已改为聚餐费用", estimateCorrected: true });
    let days = (await service.replyContext(role, at(27))).records[0].dailyBills;
    assert.equal(days[0].expense, 20.2); assert.equal(days[0].entries.find((e) => e.description === "已改为聚餐费用").estimateCorrected, true);
    await db.characterTransactions.delete("allowance");
    days = (await service.replyContext(role, at(27))).records[0].dailyBills;
    assert.equal(days[0].income, 0.1); assert.ok(!days[0].entries.some((e) => e.description === "收到乙的生活费"));
    // Bound-player bills include per-item shopping/refunds, without counting
    // the mirror userTransaction of a role ledger entry a second time.
    await db.spaceProfiles.put({ id: "player", key }); await db.userWallet.put({ id: "main", balance: 400000 });
    await db.userTransactions.bulkAdd([
      { type: "expense", amount: 20.2, vts: at(1, 12), characterEntryId: "food", description: "镜像账单不可重复" },
      { type: "expense", amount: 9.9, vts: at(2, 12), orderLineId: "item-one", name: "牛奶", quantity: 1, unitPrice: 9.9, merchant: "便利店", description: "购买牛奶", category: "food", source: "market" },
      { type: "income", amount: 9.9, vts: at(2, 13), description: "牛奶退货退款", category: "refund" },
      { type: "income", amount: 5, timestamp: at(2, 14), description: "旧格式红包收入" }
    ]);
    days = (await service.replyContext(role, at(27))).records[0].dailyBills;
    assert.doesNotMatch(JSON.stringify(days), /镜像账单不可重复/);
    assert.equal(days[1].expense, 11); assert.equal(days[1].income, 14.9);
    assert.deepEqual(days[1].entries.find((e) => e.description === "购买牛奶"), { time: "12:00", direction: "expense", amount: 9.9, category: "food", description: "购买牛奶", status: "posted", source: "market", item: "牛奶", quantity: 1, unitPrice: 9.9, merchant: "便利店" });
    await db.marketOrders.put({ id: "legacy-order", total: 10, items: [{ item: { id: "p1", name: "铅笔", price: 4, kind: "goods" }, quantity: 1 }, { item: { id: "p2", name: "书包", price: 6, kind: "goods" }, quantity: 1 }] });
    await db.userTransactions.bulkAdd([{ type: "expense", amount: 10, vts: at(3), orderId: "legacy-order" }, { type: "income", amount: 10, vts: at(4), orderId: "legacy-order" }]);
    days = (await service.replyContext(role, at(27))).records[0].dailyBills;
    assert.equal(days[2].expense, 10); assert.equal(days[3].income, 10);
    assert.deepEqual(days[2].entries.filter((e) => e.item).map((e) => e.item), ["铅笔", "书包"], "expanded order item rows sharing a legacy bill id must all survive");
    assert.deepEqual(days[3].entries.filter((e) => e.item).map((e) => e.item), ["铅笔", "书包"]);
    await db.characterWallets.update(key, { automatic: true, settledThrough: at(26, 8), rules: [{ id: "bonus", enabled: true, direction: "income", cadence: "daily", hour: 9, min: 10, max: 10, category: "bonus", label: "每日兼职报酬" }] });
    const count = await db.characterTransactions.count(), planned = await service.replyContext(role, at(27));
    assert.equal(planned.records[0].balance, 400020);
    assert.equal(planned.records[0].dailyBills.find((d) => d.date === "2026-03-27").income, 10);
    assert.equal(await db.characterTransactions.count(), count, "scheduled preview bills must not commit before the reply succeeds");
    await service.settle(at(27));
    const after = await service.replyContext(role, at(27));
    assert.equal(after.records[0].dailyBills.find((d) => d.date === "2026-03-27").entries.filter((e) => e.description === "每日兼职报酬").length, 1, "committed previews and their mirror receipts must not be duplicated");
    const unknown = core.dailyBills([{ direction: "income", amount: "3.20", description: "未注明日期" }], at(27));
    assert.equal(unknown[0].date, "日期未记录"); assert.equal(unknown[0].income, 3.2);
    assert.equal((await db.characterWallets.get(key)).balance, 300000);
    console.log("PASS: complete daily income/expense/purpose/category/peer/time, older than 12/18 entries, exact cents/totals, adjustment/failed/estimated separation, current-time privacy, bound per-item/refund/legacy bills and mirror dedupe, fresh edits/deletes, scheduled previews and no payment replay");
  } finally { await db.delete(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
