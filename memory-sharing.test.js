const assert = require("node:assert/strict"), group = require("./group-context.js"), life = require("./life-simulation-core.js");
const memory = { content: "完整记忆，不能压缩", timestamp: 10, vts: 100, rangeStart: 1, rangeEnd: 20 };
const memories = [memory, structuredClone(memory), { ...memory, vts: 200 }, { ...memory, rangeEnd: 30 }, { ...memory, sourceChatId: "other" }];
const before = JSON.stringify(memories), unique = group.uniqueMemories(memories); assert.equal(unique.length, 4); assert.equal(JSON.stringify(memories), before);
const message = { id: "m1", participants: ["A", "B"], from: "A", to: "B", content: "只对A、B知情的完整长消息。".repeat(100), vts: 100 };
const event = { id: "e1", participants: ["A", "B"], content: "双方已知事件", vts: 100 };
const records = [{ key: "A", knowledge: [memory], privateMessages: [message], privateEvents: [event] }, { key: "B", privateMessages: [message], privateEvents: [event] }, { key: "C", privateMessages: [], privateEvents: [] }];
const original = JSON.stringify(records), packed = life.packPrivate(records);
assert.equal(packed.privateMessages.length, 1); assert.equal(packed.privateEvents.length, 1);
for (let i = 0; i < records.length; i++) {
  assert.deepEqual(packed.people[i].privateMessageRefs.map((ref) => packed.privateMessages.find((r) => r.ref === ref).record), records[i].privateMessages);
  assert.deepEqual(packed.people[i].privateEventRefs.map((ref) => packed.privateEvents.find((r) => r.ref === ref).record), records[i].privateEvents);
}
assert.deepEqual(packed.people[2].privateMessageRefs, []); assert.deepEqual(packed.people[0].knowledge, [memory]);
assert.ok(JSON.stringify(packed).length < original.length); assert.equal(JSON.stringify(records), original);
console.log("PASS: lossless exact-copy memory dedupe, date/source/range preservation, once-only shared private content with exact per-person refs, no store mutation or history reduction");
