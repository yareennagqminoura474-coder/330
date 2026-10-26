const assert = require("node:assert/strict"), core = require("./chat-rounds.js");
const text = (timestamp, extra = {}) => ({ role: "assistant", type: "text", senderName: "林", timestamp, vts: 1772676000000, content: "原文（动作）和数字180不变。", ...extra });
const header = (timestamp, extra = {}) => text(timestamp, { type: "narration", senderName: "旁白", isReplyHeader: true, content: "2026年3月5日，10点00分，星期四，地点：书房", ...extra });
const chat = { id: "group", isGroup: true, members: [{ originalName: "林" }, { originalName: "杨" }, { originalName: "林" }], history: [
  header(1), text(2), text(3, { isHidden: true }), header(4), text(999), text(5),
  text(6, { role: "system", walletEntry: true }), text(7, { sentAsCharacter: true }),
  header(8), ...Array.from({ length: 240 }, (_, i) => text(10 + i)),
] };
assert.deepEqual(core.rounds(chat).map(r => r.messages[0].timestamp), [1, 4, 8]);
assert.equal(core.target(chat).timestamp, 8);
assert.equal(core.target(chat, true).timestamp, 4);
assert.equal(core.target({ history: [] }), null);
assert.equal(core.target({ history: [text(1)] }, true), null);
assert.deepEqual(core.speakers(chat), ["林", "杨"]);
assert.deepEqual(core.speakers({ originalName: "本名", name: "备注" }), ["本名"]);
const old = { history: [text(1), text(2), text(3), text(4)], ephoneLastReplyBatch: { timestamps: [3, 4] } };
assert.deepEqual(core.rounds(old).map(r => r.index), [0, 2], "old latest-batch metadata separates consecutive unlabelled replies");
const id = "reply:8";
for (const message of chat.history.filter(m => m.timestamp === 8 || m.timestamp >= 10 && m.timestamp <= 249)) message.ephoneReplyRoundId = id;
assert.equal(chat.history.find(m => m.timestamp === 8).ephoneReplyRoundId, id);
chat.history = chat.history.filter(m => m.timestamp !== 8);
assert.equal(core.target(chat).timestamp, 10, "deleting a round's opening falls back to its first surviving message");
const unchanged = structuredClone(chat);
core.rounds(chat);
assert.deepEqual(chat, unchanged, "navigation never rewrites message data, even for old cards without round tags");
const original = text(11, { ephoneReplyRoundId: id, ephoneSummaryMessageId: "summary-id" });
const narration = core.convert(original, "narration", null, chat);
assert.equal(narration.type, "narration"); assert.equal(narration.senderName, "旁白");
const speech = core.convert(narration, "text", "杨", chat);
for (const field of ["timestamp", "vts", "content", "ephoneSummaryMessageId", "ephoneReplyRoundId"]) assert.equal(speech[field], original[field]);
assert.equal(speech.role, "assistant"); assert.equal(speech.senderName, "杨"); assert.equal(speech.ephoneMessageKindOverride, "text");
assert.equal(original.senderName, "林", "conversion is pure and leaves source untouched before commit");
const manual = core.convert(text(4, { role: "user", type: "narration" }), "text", "林", chat);
assert.equal(manual.sentAsCharacter, true);
assert.equal(core.rounds({ history: [manual] }).length, 0, "manual narration cannot become a generated round or unlock reroll");
for (const message of [header(1), text(1, { type: "time_marker" }), text(1, { type: "transfer", amount: 20 }),
  text(1, { walletEntry: true }), text(1, { marketOrder: {} }), text(1, { type: "ai_image" }), text(1, { quote: {} }), text(1, { isHidden: true })]) {
  assert.equal(core.canConvert(message), false);
  assert.throws(() => core.convert(message, "narration", null, chat));
}
assert.throws(() => core.convert(text(2), "text", "外人", chat));
assert.deepEqual(core.rounds({ history: [header(1), text(2, { type: "narration", isReplyHeader: false, isSceneTimeHeader: true }), text(3)] }).map(r => r.index), [0], "scene-time headers inside a round are not new rounds");
assert.deepEqual(core.rounds({ history: [header(1, { role: "system" }), text(2), header(3, { role: "system" }), text(4)] }).map(r => r.index), [0, 2]);
assert.deepEqual(core.rounds({ history: [header(1, { role: "system" }), text(2)], ephoneLastReplyBatch: { timestamps: [2] } }).map(r => r.index), [0], "a legacy system opening omitted from saved assistant IDs still belongs to this round");
console.log("PASS: long reply navigation, old/new round boundaries, stable IDs, deleted openings, exact conversion, manual/generated origin and financial/header protections");
