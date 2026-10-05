const assert = require("node:assert/strict");
const fs = require("node:fs");
const money = require("./spectator-money.js");
const groupContext = require("./group-context.js");
const members = [
  { originalName: "杨帆", groupNickname: "师兄" },
  { originalName: "林澈", groupNickname: "师弟" },
  { originalName: "林珣", groupNickname: "师父" },
];
const profiles = members.map((member) => ({ originalName: member.originalName, nickname: member.groupNickname }));
const base = { role: "assistant", senderName: "杨帆", timestamp: 100, vts: 2026 };
function make(item) { return money.normalize(item, base, profiles, groupContext.resolveSpeaker); }
function chat(message) { return { id: "group", isGroup: true, isSpectatorGroup: true, members, history: [message], settings: {} }; }

(async () => {
  const transfer = make({ type: "transfer", receiver: "师弟", amount: "100.10", status: "accepted", acceptedBy: "林澈" });
  assert.equal(transfer.receiverName, "林澈");
  assert.equal(transfer.status, "pending");
  assert.equal(transfer.vts, 2026);
  assert.match(money.render(chat(transfer), transfer), />接收<\/button>/);
  assert.deepEqual(money.eligible(chat(transfer), transfer), ["林澈"]);
  for (const amount of [0, -1, Infinity, NaN, "abc", 0.001]) assert.equal(make({ type: "transfer", receiver: "林澈", amount }), null);
  assert.equal(make({ type: "transfer", receiver: "杨帆", amount: 1 }), null);
  assert.equal(make({ type: "transfer", receiver: "陌生人", amount: 1 }), null);
  assert.equal(make({ type: "transfer", amount: 1 }), null);

  const group = chat(transfer);
  let saved;
  const options = { now: 123, vts: 3000, save: async (candidate) => { saved = JSON.parse(JSON.stringify(candidate)); } };
  await assert.rejects(money.receive(group, 100, "林珣", options));
  await assert.rejects(money.receive(group, 100, "林澈", { ...options, save: async () => { throw new Error("quota"); } }), /quota/);
  assert.equal(group.history.length, 1);
  assert.equal(group.history[0].status, "pending");
  const receipt = await money.receive(group, 100, "林澈", options);
  assert.match(receipt.content, /林澈 已接收 杨帆 的转账 ¥100.10/);
  assert.equal(receipt.vts, 3000);
  assert.equal(saved.history[0].status, "accepted");
  assert.equal(saved.history[0].acceptedBy, "林澈");
  assert.equal(saved.history.length, 2);
  assert.match(groupContext.describeMessage(group, group.history[0]), /已接收（收款人：林澈）/);
  assert.match(groupContext.describeMessage(group, receipt), /林澈 已接收/);
  await assert.rejects(money.receive(group, 100, "林澈", options));
  assert.doesNotMatch(money.render(group, group.history[0]), /<button/);
  // The authoritative state remains in the prompt even outside recent history.
  group.history.push(...Array.from({ length: 100 }, (_, i) => ({ role: "assistant", content: "聊天", timestamp: 1000 + i })));
  assert.equal(groupContext.recentHistory(group, 1).length, 1);
  assert.match(money.ledger(group), /已接收（收款人：林澈）/);

  const legacy = chat({ ...base, type: "transfer", amount: 8, receiverName: "我" });
  assert.deepEqual(money.eligible(legacy, legacy.history[0]), ["林澈", "林珣"]);
  await money.receive(legacy, 100, "林珣", options);
  assert.equal(legacy.history[0].receiverName, "林珣");

  const direct = make({ type: "red_packet", packetType: "direct", receiver: "师弟", amount: 8.88, count: 99, claimedBy: { 林澈: 8.88 } });
  assert.equal(direct.count, 1);
  assert.deepEqual(direct.claimedBy, {});
  const directGroup = chat(direct);
  assert.deepEqual(money.eligible(directGroup, direct), ["林澈"]);
  assert.match(money.render(directGroup, direct), />领取<\/button>/);
  const opened = await money.receive(directGroup, 100, "林澈", options);
  assert.equal(opened.amount, 8.88);
  assert.equal(directGroup.history[0].isFullyClaimed, true);
  assert.equal(directGroup.history[0].claimedBy["林澈"], 8.88);
  assert.deepEqual(money.eligible(JSON.parse(JSON.stringify(directGroup)), directGroup.history[0]), []);

  for (const count of [0, 1.5, Infinity, 4]) assert.equal(make({ type: "red_packet", packetType: "lucky", amount: 1, count }), null);
  assert.equal(make({ type: "red_packet", packetType: "lucky", amount: 0.01, count: 2 }), null);
  for (const random of [() => 0, () => 0.99]) {
    const lucky = make({ type: "red_packet", packetType: "lucky", amount: 10.01, count: 3 });
    const luckyGroup = chat(lucky);
    for (const name of ["林澈", "林珣", "杨帆"]) {
      await money.receive(luckyGroup, 100, name, { ...options, random });
      await assert.rejects(money.receive(luckyGroup, 100, name, options));
    }
    const card = luckyGroup.history[0];
    assert.equal(Object.values(card.claimedBy).reduce((sum, amount) => sum + Math.round(amount * 100), 0), 1001);
    assert.equal(card.isFullyClaimed, true);
    assert.equal(luckyGroup.history.length, 4);
    assert.match(money.ledger(luckyGroup), /林澈 ¥[\d.]+、林珣 ¥[\d.]+、杨帆 ¥[\d.]+；已领完/);
  }
  // Preserve legacy preallocated packets; the final claim consumes the exact rest.
  const allocated = chat({ ...base, type: "red_packet", packetType: "lucky", totalAmount: 1, count: 2, claimedBy: {}, unclaimedAmounts: [0.6, 0.4] });
  assert.equal((await money.receive(allocated, 100, "林澈", options)).amount, 0.4);
  assert.equal((await money.receive(allocated, 100, "林珣", options)).amount, 0.6);
  assert.match(money.render(chat({ ...transfer, note: '<img src=x onerror="alert(1)">' }), { ...transfer, note: '<img src=x onerror="alert(1)">' }), /&lt;img/);

  const html = fs.readFileSync("index.html", "utf8");
  const asset = html.match(/src="(spectator-money.js\?v=[^"]+)"/)[1];
  assert.ok(html.indexOf(asset) < html.indexOf('src="script.js?'));
  assert.ok(fs.readFileSync("sw.js", "utf8").includes(asset));
  console.log("Spectator transfer/red packet state, persistence, legacy and amount tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
