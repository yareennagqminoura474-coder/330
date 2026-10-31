const assert = require("node:assert/strict"), core = require("./novel-chapters.js");
assert.equal(core.count(" 中 文\nA🙂\t。"), 5);
const prose = '夜雨还没有停。林澈说：“等我回来，我们一起把这件事说清楚。”\n门口的人点了点头。';
assert.equal(core.chooseTitle(prose, "等我回来，我们一起把这件事说清楚。"), "等我回来，我们一起把这件事说清楚。");
assert.ok(prose.includes(core.chooseTitle(prose, "雨夜的命运交响曲")));
assert.equal(core.chooseTitle(prose, "第八章 等我回来，我们一起把这件事说清楚。"), "等我回来，我们一起把这件事说清楚。");
assert.ok(prose.includes(core.chooseTitle(prose, "等我回来，我们一起把这件事说清楚！")), "title punctuation must also come from the actual prose");
const plain = "桌上的灯亮了一夜。没有人再提昨天的事。";
assert.ok(plain.includes(core.chooseTitle(plain)));
const long = "长".repeat(10000); assert.equal(core.count(core.chooseTitle(long)), 64); assert.ok(long.includes(core.chooseTitle(long)));
const book = { id: 1, settings: { untouched: true }, chapters: [
  { title: "一", content: "第一章。", summary: "第一章摘要", timestamp: 1 },
  { title: "二", content: "第二章。", summary: "旧摘要不能再当新事实", timestamp: 2 },
  { title: "三", content: "第三章。", summary: "第三章摘要", timestamp: 3 }
], lastGeneration: { status: "saved", chapterIndex: 2, raw: "paid original" } };
const before = JSON.stringify(book), edited = core.edit(book, 1, { title: "手动标题", content: "新的正文🙂。", summary: book.chapters[1].summary }, 20);
assert.equal(edited.chapters[1].title, "手动标题"); assert.equal(edited.chapters[1].wordCount, core.count("新的正文🙂。"));
assert.equal(edited.chapters[1].summaryStale, true); assert.equal(edited.chapters[1].summary, book.chapters[1].summary);
assert.equal(edited.chapters[2].prevSummary, "", "a stale summary cannot be passed on as prior-chapter facts");
const confirmed = core.edit(edited, 1, { summary: "修订后的新摘要", summaryConfirmed: true }, 21);
assert.equal(confirmed.chapters[1].summaryStale, false); assert.equal(confirmed.chapters[2].prevSummary, "修订后的新摘要");
const firstRemoved = core.remove(book, 0, 30);
assert.deepEqual(firstRemoved.chapters.map(chapter => chapter.content), ["第二章。", "第三章。"]);
assert.equal(firstRemoved.lastGeneration.chapterIndex, 1); assert.equal(firstRemoved.chapters[1].prevSummary, "旧摘要不能再当新事实");
const lastRemoved = core.remove(book, 2, 31); assert.equal(lastRemoved.lastGeneration, null);
const lastEdited = core.edit(book, 2, { content: "改过的结尾。" }, 32);
assert.equal(lastEdited.lastGeneration.raw, "paid original"); assert.equal(lastEdited.lastGeneration.chapterEditedAt, 32);
assert.equal(core.remove({ chapters: [book.chapters[0]] }, 0).chapters.length, 0);
assert.throws(() => core.edit(book, 0, { content: " \n " }), /正文不能为空/);
assert.throws(() => core.remove(book, 9), /章节已不存在/);
assert.equal(JSON.stringify(book), before, "editing and deletion leave the source snapshot and unrelated settings untouched");
console.log("PASS: Unicode body counts, verbatim dialogue/key-line titles, immutable chapter edits/deletion, stale summary handling, recap linkage and original API diagnostics");
