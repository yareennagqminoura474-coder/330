const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), identity = require("./player-identity"), core = require("./character-wallet-core");
const at = (month, day, hour = 8) => new Date(2026, month - 1, day, hour).getTime();
const plan = (id, direction, value, extra = {}) => ({ id, direction, min: value, max: value, label: id, cadence: "daily", day: 1, hour: 9, ...extra });
const profile = (balance, rules = [], extra = {}) => ({ balance, otherAssets: 1234, rules, automatic: true, ...extra });
let serial = 0;
async function scenario(run) {
  const db = new Dexie("scheduled-pairs-" + Date.now() + "-" + serial++);
  db.version(1).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", userWallet: "&id", userTransactions: "++id,timestamp,type", characterWallets: "&key", characterTransactions: "&id,key,vts,category" });
  await db.open();
  try {
    // Recipient inserted first: settlement order must follow timestamps, not table order.
    await db.chats.bulkAdd([{ id: "child", name: "乙", originalName: "乙", history: [] }, { id: "payer", name: "甲", originalName: "甲", history: [] }, { id: "third", name: "丙", originalName: "丙", history: [] }]);
    await db.npcs.add({ id: 1, name: "邻居", persona: "成年人" });
    await db.userWallet.put({ id: "main", balance: 80, fundHoldings: ["preserved"] });
    await run(new core.Service(db, identity), db);
  } finally { await db.delete(); }
}
const key = "chat:payer", child = "chat:child";
(async () => {
  const people = [{ key, name: "林" }, { key: child, name: "林澈" }];
  assert.equal(core.counterparty(plan("给林澈零花钱", "expense", 1), key, people)?.key, child);
  assert.equal(core.counterparty(plan("来自林的生活费", "income", 1), child, people)?.key, key);
  assert.equal(core.counterparty(plan("给我生活费", "expense", 1), key, people, { key: child })?.key, child);
  assert.equal(core.counterparty(plan("林的生活费", "expense", 1), key, people), null, "one's own living expenses aren't a transfer to oneself");
  const normalized = core.normalize(profile(10, [plan("paid", "expense", 1, { recipientKey: child })]));
  assert.equal(normalized.rules[0].counterpartyKey, child);
  assert.match(core.profilePrompt([{ key, name: "甲", persona: "普通家庭" }], [{ key: child, name: "乙", persona: "PRIVATE-OTHER-PERSONA" }]), /counterpartyKey/);
  assert.doesNotMatch(core.profilePrompt([{ key, name: "甲", persona: "普通家庭" }], [{ key: child, name: "乙", persona: "PRIVATE-OTHER-PERSONA" }]), /PRIVATE-OTHER-PERSONA/);
  await scenario(async (s, db) => {
    await s.save(child, profile(0, [plan("早餐", "expense", 50, { hour: 10 })]), at(1, 1), 0);
    await s.save(key, profile(100, [plan("工资", "income", 500, { hour: 8, counterpartyKey: "__external__" }), plan("给乙零花钱", "expense", 200)]), at(1, 1, 7), 0);
    const before = await db.characterWallets.toArray(), preview = await s.settle(at(1, 1, 12), { preview: true });
    assert.deepEqual(await db.characterWallets.toArray(), before); assert.equal(await db.characterTransactions.filter((r) => r.source === "scheduled").count(), 0);
    assert.equal(preview.projected[key], 400); assert.equal(preview.projected[child], 150);
    const settled = await s.settle(at(1, 1, 12)); assert.deepEqual(settled.projected, preview.projected);
    assert.equal((await s.account(key)).balance, 400); assert.equal((await s.account(child)).balance, 150);
    const transfer = settled.entries.filter((r) => r.transferId);
    assert.equal(transfer.length, 2); assert.equal(transfer[0].transferId, transfer[1].transferId);
    assert.equal(transfer[0].amount, transfer[1].amount); assert.equal(transfer[0].counterpartEntryId, transfer[1].id);
    assert.match(transfer.find((r) => r.key === child).description, /收到甲/);
    assert.equal((await s.account(child)).otherAssets, 1234);
    const rows = await db.characterTransactions.count(); await Promise.all([s.settle(at(1, 1, 12)), s.settle(at(1, 1, 12))]); await s.settle(at(1, 1));
    assert.equal(await db.characterTransactions.count(), rows);
  });
  await scenario(async (s, db) => {
    await s.save(key, profile(500, [plan("每周给乙生活费", "expense", 100, { cadence: "weekly", day: 1 })]), at(1, 4), 0);
    await s.settle(at(1, 12, 10));
    assert.equal((await s.account(key)).balance, 300); assert.equal((await s.account(child)).balance, 200);
    assert.equal((await s.account(child)).configured, false, "receipt doesn't invent a recipient profile or opening balance");
    assert.equal((await s.ledger(child)).filter((r) => r.source === "scheduled").length, 2);
    assert.equal(await db.userTransactions.count(), 0);
  });
  for (const bound of [key, child]) await scenario(async (s, db) => {
    await s.save(key, profile(500, [plan("给乙生活费", "expense", 12.34, { counterpartyKey: child })]), at(1, 1), 0);
    await s.save(child, profile(30), at(1, 1), 0); await db.spaceProfiles.put({ id: "player", key: bound });
    const stored = (await db.characterWallets.get(bound)).balance, count = await db.userTransactions.count();
    const preview = await s.settle(at(1, 2, 10), { preview: true });
    await s.settle(at(1, 2, 10));
    const expected = bound === key ? 55.32 : 104.68;
    assert.equal((await db.userWallet.get("main")).balance, expected); assert.equal(preview.balance, expected);
    assert.equal((await db.characterWallets.get(bound)).balance, stored, "never clone or replace the bound role's stashed independent funds");
    assert.deepEqual((await db.userWallet.get("main")).fundHoldings, ["preserved"]);
    assert.equal(await db.userTransactions.count(), count + 2);
    assert.equal((await s.ledger(bound, Infinity)).filter((r) => r.transferId).length, 2, "space and character bills aren't double displayed");
  });
  await scenario(async (s, db) => {
    const pair = { cadence: "monthly", day: 31, min: 20, max: 80, category: "allowance" };
    await s.save(key, profile(1000, [plan("给乙生活费", "expense", 30, { ...pair, counterpartyKey: child })]), at(1, 30), 0);
    await s.save(child, profile(0, [plan("来自甲的生活费", "income", 30, { ...pair, counterpartyKey: key })]), at(1, 30), 0);
    const result = await s.settle(at(2, 28, 10));
    assert.equal(result.entries.length, 4, "two months = two paired payments, not four transfers");
    for (const id of new Set(result.entries.map((r) => r.transferId))) {
      const rows = result.entries.filter((r) => r.transferId === id);
      assert.equal(rows.length, 2); assert.equal(rows[0].amount, rows[1].amount); assert.ok(rows[0].amount >= 20 && rows[0].amount <= 80);
    }
    assert.equal(Math.round(((await s.account(key)).balance + (await s.account(child)).balance) * 100), 100000);
    assert.ok(result.entries.some((r) => core.dayKey(r.vts) === "2026-02-28"));
    const count = await db.characterTransactions.count(); await s.settle(at(2, 28, 10)); assert.equal(await db.characterTransactions.count(), count);
  });
  await scenario(async (s, db) => {
    await s.save(key, profile(100, [], { automatic: false }), at(1, 1), 0);
    await s.save(child, profile(0, [plan("来自甲生活费", "income", 10, { counterpartyKey: key })]), at(1, 1), 0);
    await s.settle(at(1, 1, 10));
    assert.equal((await s.account(key)).balance, 90); assert.equal((await s.account(child)).balance, 10, "an income-side internal plan also debits its real payer");
    assert.equal((await s.ledger(key)).filter((r) => r.transferId).length, 1);
  });
  await scenario(async (s, db) => {
    await s.save(key, profile(10, [plan("给乙生活费", "expense", 50), plan("给邻居补贴", "expense", 2, { counterpartyKey: "npc:1" })]), at(1, 1), 0);
    await s.settle(at(1, 1, 10));
    assert.equal((await s.account(key)).balance, 8); assert.equal((await s.account(child)).balance, 0); assert.equal((await s.account("npc:1")).balance, 2);
    assert.equal((await s.ledger(key)).filter((r) => r.status === "insufficient").length, 1);
    await assert.rejects(s.save(key, profile(8, [plan("自己", "expense", 1, { counterpartyKey: key })]), at(1, 1, 10)), /自己/);
    await assert.rejects(s.save(key, profile(8, [plan("删除人物", "expense", 1, { counterpartyKey: "chat:missing" })]), at(1, 1, 10)), /移走或删除/);
  });
  await scenario(async (s, db) => {
    await s.save(key, profile(100, [plan("给乙生活费", "expense", 5), plan("付乙饭钱", "expense", 3, { counterpartyKey: "__external__" }), plan("删除后的对象", "expense", 7, { counterpartyKey: "chat:third" })]), at(1, 1), 0);
    await db.chats.put({ id: "duplicate-child", name: "乙", history: [] }); await db.chats.delete("third");
    const result = await s.settle(at(1, 1, 10));
    assert.equal((await s.account(key)).balance, 97); assert.equal((await s.account(child)).balance, 0);
    assert.ok(result.entries.some((r) => r.status === "ambiguous_counterparty")); assert.ok(result.entries.some((r) => r.status === "missing_counterparty"));
  });
  await scenario(async (s, db) => {
    await s.save(key, profile(500, [plan("给乙生活费", "expense", 10, { counterpartyKey: child })]), at(1, 1), 0);
    await db.spaceProfiles.put({ id: "player", key: child });
    const original = s.characterTransactions.add.bind(s.characterTransactions), snapshot = { wallets: await db.characterWallets.toArray(), main: await db.userWallet.toArray(), bills: await db.userTransactions.toArray(), entries: await db.characterTransactions.toArray() };
    let calls = 0; s.characterTransactions.add = async (row) => { if (++calls === 2) throw Error("paired insert failed"); return original(row); };
    await assert.rejects(s.settle(at(1, 1, 10)), /paired insert/); s.characterTransactions.add = original;
    assert.deepEqual({ wallets: await db.characterWallets.toArray(), main: await db.userWallet.toArray(), bills: await db.userTransactions.toArray(), entries: await db.characterTransactions.toArray() }, snapshot, "both funds, both bills and settlement cursors roll back atomically");
    const results = await Promise.all([s.settle(at(1, 1, 10)), s.settle(at(1, 1, 10))]);
    assert.equal(results.flatMap((r) => r.entries).length, 2); assert.equal((await s.account(key)).balance, 490); assert.equal((await s.account(child)).balance, 90);
  });
  await scenario(async (s) => {
    await s.save(key, profile(1000, [plan("甲给乙", "expense", 10, { counterpartyKey: child })]), at(1, 1), 0);
    let batches = 0;
    while ((await s.settle(at(1, 8, 12), { maxDays: 2, maxEntries: 1 })).pending) { if (++batches > 20) throw Error("batch did not finish"); }
    assert.equal((await s.account(key)).balance, 920); assert.equal((await s.account(child)).balance, 80);
    assert.equal((await s.ledger(child, Infinity)).filter((r) => r.source === "scheduled").length, 8);
  });
  console.log("PASS: scheduled two-sided transfers, legacy names/explicit targets/NPCs, chronological receipts and spending, unconfigured and bound recipients/payers, variable mirrored plans once, month ends, preview, shortage/missing/ambiguous safety, atomic rollback, concurrent/reload/backward dedupe and bounded batches");
})().catch((error) => { console.error(error); process.exitCode = 1; });
