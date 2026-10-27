const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const Dexie = require("dexie"), core = require("./character-wallet-core"), identity = require("./player-identity"), Finance = require("./finance-records-core").Service;
const at = (month, day, hour = 8) => new Date(2026, month - 1, day, hour).getTime();
const payer = "chat:payer", child = "chat:child";
const rule = (id, direction, extra = {}) => ({ id, label: direction === "expense" ? "给乙的零花钱" : "家庭每月零花钱", direction,
  counterpartyKey: direction === "expense" ? child : payer, cadence: "monthly", day: 1, hour: 9, min: 100, max: 100, category: "allowance", enabled: true, ...extra });
let serial = 0;
async function scenario(title, run) {
  const db = new Dexie("transfer-links-" + Date.now() + "-" + serial++);
  db.version(1).stores({ chats: "&id", npcs: "++id", spaceProfiles: "&id", userWallet: "&id", userTransactions: "++id,timestamp,type", characterWallets: "&key", characterTransactions: "&id,key,vts,category" });
  await db.open();
  try {
    await db.chats.bulkPut([{ id: "payer", name: "甲", history: [] }, { id: "child", name: "乙", history: [] }, { id: "third", name: "丙", history: [] }]);
    await db.userWallet.put({ id: "main", balance: 50 });
    const seed = async (key, balance, rules, cursor = at(10, 27)) => db.characterWallets.put({ key, balance, configured: true, automatic: true, rules, revision: 1, settledThrough: cursor });
    await run(new core.Service(db, identity), db, seed); console.log("PASS", title);
  } finally { await db.delete(); }
}
const scheduled = async (db) => db.characterTransactions.filter((r) => r.source === "scheduled").toArray();
(async () => {
  await scenario("legacy different hours and independently generated ranges share payer's single payment", async (s, db, seed) => {
    await seed(payer, 1000, [rule("paid", "expense", { min: 110, max: 150, hour: 10 })]);
    await seed(child, 50, [rule("received", "income", { min: 210, max: 300, hour: 9 })]);
    const before = await db.characterWallets.toArray(), preview = await s.settle(at(11, 1, 9), { preview: true });
    assert.equal(preview.entries.length, 0, "recipient's earlier hour must not advance payment");
    assert.deepEqual(await db.characterWallets.toArray(), before, "preview cannot migrate or mutate stored rules");
    await s.settle(at(11, 1, 9)); assert.equal((await scheduled(db)).length, 0);
    const a = await s.account(payer), b = await s.account(child);
    assert.equal(a.rules[0].linkedRuleId, "received"); assert.equal(b.rules[0].linkedRuleId, "paid");
    for (const field of ["hour", "min", "max", "cadence", "day"]) assert.equal(a.rules[0][field], b.rules[0][field]);
    const result = await s.settle(at(11, 1, 12));
    assert.equal(result.entries.length, 2); assert.equal(result.entries[0].amount, result.entries[1].amount);
    assert.ok(result.entries[0].amount >= 110 && result.entries[0].amount <= 150);
    assert.equal(Math.round(((await s.account(payer)).balance + (await s.account(child)).balance) * 100), 105000);
    await Promise.all([s.settle(at(11, 1, 12)), s.settle(at(11, 1, 12))]); await s.settle(at(10, 27));
    assert.equal((await scheduled(db)).length, 2);
  });
  await scenario("editing either endpoint updates its peer without moving money or repaying the cycle", async (s, db, seed) => {
    await seed(payer, 1000, [rule("paid", "expense")]); await seed(child, 50, [rule("received", "income", { hour: 10 })]);
    await s.settle(at(11, 1, 12));
    let a = await s.account(payer), b = await s.account(child);
    const balances = [a.balance, b.balance], count = await db.characterTransactions.count();
    b.rules[0] = { ...b.rules[0], min: 130, max: 180, hour: 14, day: 2 };
    await s.save(child, b, at(11, 1, 12), b.revision);
    a = await s.account(payer); b = await s.account(child);
    for (const field of ["hour", "min", "max", "day"]) assert.equal(a.rules[0][field], b.rules[0][field]);
    assert.deepEqual([a.balance, b.balance], balances);
    await s.settle(at(11, 2, 16)); assert.equal(await db.characterTransactions.count(), count, "a new day/hour within the paid month is not a new payment");
    a = await s.account(payer); a.rules[0] = { ...a.rules[0], min: 140, max: 140 };
    await s.save(payer, a, at(11, 2, 16), a.revision);
    assert.equal((await s.account(child)).rules[0].min, 140);
    await s.settle(at(12, 2, 16)); assert.equal((await s.account(payer)).balance, balances[0] - 140);
    assert.equal((await s.account(child)).balance, balances[1] + 140);
    a = await s.account(payer); b = await s.account(child); b.rules[0].enabled = false;
    await s.save(child, b, at(12, 2, 16), b.revision);
    assert.equal((await s.account(payer)).rules[0].enabled, false);
    await s.settle(at(12, 31, 16)); assert.equal((await s.account(payer)).balance, a.balance);
  });
  await scenario("explicit links can unite different categories/cycles and remain stable after editing", async (s, db, seed) => {
    await seed(payer, 1000, [rule("paid", "expense", { category: "other", label: "定期给乙" })]);
    await seed(child, 50, [rule("received", "income", { category: "salary", label: "甲的补助", cadence: "weekly", day: 2 })]);
    const b = await s.account(child); b.rules[0].linkedRuleId = "paid";
    await s.save(child, b, at(10, 27), b.revision);
    const a = await s.account(payer); assert.equal(a.rules[0].cadence, "weekly"); assert.equal(a.rules[0].day, 2);
    await s.settle(at(11, 3, 12)); assert.equal((await scheduled(db)).length, 4, "two Tuesdays each transfer once");
  });
  await scenario("distinct payments stay distinct; ambiguous incoming plans cannot double charge", async (s, db, seed) => {
    await seed(payer, 1000, [rule("paid1", "expense", { min: 100, max: 100 }), rule("paid2", "expense", { min: 200, max: 200 })]);
    await seed(child, 50, [rule("received", "income", { min: 300, max: 300 })]);
    const result = await s.settle(at(11, 1, 12));
    assert.ok(result.ambiguousPlans.length); assert.equal((await s.account(payer)).balance, 700); assert.equal((await s.account(child)).balance, 350);
    const b = await s.account(child); b.rules[0].linkedRuleId = "paid1";
    await s.save(child, b, at(11, 1, 12), b.revision);
    assert.equal((await s.account(payer)).rules[0].min, 300, "explicitly editing the recipient changes only its chosen payment");
    assert.equal((await s.account(payer)).rules[1].min, 200);
    await s.settle(at(12, 1, 12)); assert.equal((await s.account(payer)).balance, 200); assert.equal((await s.account(child)).balance, 850);
  });
  await scenario("independent option preserves separate bound transfers and removing a peer releases the link", async (s, db, seed) => {
    await seed(payer, 1000, [rule("paid", "expense")]); await seed(child, 50, [rule("received", "income", { independentTransfer: true })]);
    await db.spaceProfiles.put({ id: "player", key: child });
    await s.settle(at(11, 1, 12)); assert.equal((await s.account(payer)).balance, 800); assert.equal((await s.account(child)).balance, 250);
    let b = await s.account(child); b.rules[0] = { ...b.rules[0], independentTransfer: false, linkedRuleId: "paid" };
    await s.save(child, b, at(11, 1, 12), b.revision);
    let a = await s.account(payer); a.rules = []; await s.save(payer, a, at(11, 1, 12), a.revision);
    assert.equal((await s.account(child)).rules[0].linkedRuleId, "");
    await s.settle(at(12, 1, 12)); assert.equal((await s.account(payer)).balance, 700); assert.equal((await s.account(child)).balance, 350);
    assert.equal(await db.userTransactions.filter((r) => r.transferId).count(), 3);
  });
  for (const paidSide of [payer, child]) await scenario("late link respects an old standalone payment from " + paidSide, async (s, db, seed) => {
    const r = paidSide === payer ? rule("paid", "expense", { hour: 9 }) : rule("received", "income", { hour: 9 });
    await seed(paidSide, paidSide === payer ? 1000 : 50, [r], at(10, 27));
    if (paidSide === child) await seed(payer, 1000, [], at(10, 27));
    await s.settle(at(11, 1, 9));
    const old = (await scheduled(db)).length;
    const missing = paidSide === payer ? child : payer;
    await seed(missing, (await s.account(missing)).balance, [missing === payer ? rule("paid", "expense", { hour: 10 }) : rule("received", "income", { hour: 10 })], at(10, 27));
    const before = [(await s.account(payer)).balance, (await s.account(child)).balance];
    await s.settle(at(11, 1, 12)); assert.equal((await scheduled(db)).length, old);
    assert.deepEqual([(await s.account(payer)).balance, (await s.account(child)).balance], before);
  });
  await scenario("legacy duplicate review is read-only and one reversal restores both balances exactly once", async (s, db, seed) => {
    await seed(payer, 1000, [rule("paid", "expense", { independentTransfer: true })]);
    await seed(child, 50, [rule("received", "income", { hour: 10, min: 200, max: 200, independentTransfer: true })]);
    await db.spaceProfiles.put({ id: "player", key: child });
    await s.settle(at(11, 1, 12)); assert.equal((await s.account(payer)).balance, 700); assert.equal((await s.account(child)).balance, 350);
    // Simulate records and unlinked definitions left by the previous release.
    for (const k of [payer, child]) { const w = await db.characterWallets.get(k); w.rules[0].independentTransfer = false; await db.characterWallets.put(w); }
    const before = JSON.stringify(await db.characterTransactions.toArray()), dupes = await s.duplicateTransfers(child);
    assert.equal(dupes.length, 1); assert.equal(dupes[0].entry.amount, 200); assert.equal(dupes[0].kept.amount, 100);
    assert.equal(JSON.stringify(await db.characterTransactions.toArray()), before);
    await s.settle(at(11, 1, 12)); assert.equal((await scheduled(db)).length, 4);
    const f = new Finance(db); await f.deleteLedger(child, dupes[0].entry);
    assert.equal((await s.account(payer)).balance, 900); assert.equal((await s.account(child)).balance, 150);
    await f.deleteLedger(child, dupes[0].entry); await s.settle(at(11, 2, 12));
    assert.equal((await s.account(payer)).balance, 900); assert.equal((await s.account(child)).balance, 150);
    assert.deepEqual(await s.duplicateTransfers(child), []);
    assert.equal((await db.userTransactions.toArray()).filter((r) => r.financialReversed).length, 1);
  });
  await scenario("plan synchronization and both balance writes roll back together on failure", async (s, db, seed) => {
    await seed(payer, 1000, [rule("paid", "expense")]); await seed(child, 50, [rule("received", "income", { hour: 10 })]);
    const before = JSON.stringify(await db.characterWallets.toArray()), original = s.characterTransactions.add.bind(s.characterTransactions);
    let count = 0; s.characterTransactions.add = async (r) => { if (++count === 2) throw Error("forced failure"); return original(r); };
    await assert.rejects(s.settle(at(11, 1, 12)), /forced failure/);
    assert.equal(JSON.stringify(await db.characterWallets.toArray()), before); assert.equal(await db.characterTransactions.count(), 0);
    s.characterTransactions.add = original;
    await s.settle(at(11, 1, 12)); assert.equal((await s.account(payer)).balance, 900); assert.equal((await s.account(child)).balance, 150);
  });
  await scenario("multiple distinct linked payments are not collapsed; explicit conflicts are rejected", async (s, db, seed) => {
    await seed(payer, 1000, [rule("pocket", "expense"), rule("tuition", "expense", { min: 200, max: 200 })]);
    await seed(child, 50, [rule("pocket-in", "income"), rule("tuition-in", "income", { min: 200, max: 200 })]);
    await s.settle(at(11, 1, 12)); assert.equal((await scheduled(db)).length, 4);
    assert.equal((await s.account(payer)).balance, 700); assert.equal((await s.account(child)).balance, 350);
    const b = await s.account(child), before = await db.characterWallets.toArray(); b.rules[0].linkedRuleId = "tuition";
    await assert.rejects(s.save(child, b, at(11, 1, 12), b.revision), /关联的对方计划/);
    assert.deepEqual(await db.characterWallets.toArray(), before);
    b.rules[0].independentTransfer = true;
    await s.save(child, b, at(11, 1, 12), b.revision);
    assert.equal((await s.account(child)).rules[0].linkedRuleId, "");
    assert.equal((await s.account(payer)).rules[0].linkedRuleId, "");
  });
  await scenario("peer settings are rolled back if saving the edited account fails", async (s, db, seed) => {
    await seed(payer, 1000, [rule("paid", "expense")]); await seed(child, 50, [rule("received", "income")]);
    await s.settle(at(10, 27));
    const before = await db.characterWallets.toArray(), b = await s.account(child), put = s.characterWallets.put.bind(s.characterWallets);
    b.rules[0].min = 222; b.rules[0].max = 222;
    s.characterWallets.put = async (w) => { if (w.key === child) throw Error("save interrupted"); return put(w); };
    await assert.rejects(s.save(child, b, at(10, 27), b.revision), /save interrupted/);
    assert.deepEqual(await db.characterWallets.toArray(), before);
  });
})().catch((error) => { console.error(error); process.exitCode = 1; });
