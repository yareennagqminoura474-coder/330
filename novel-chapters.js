(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EPhoneNovelChapters = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  const text = value => typeof value === "string" ? value : "";
  function count(value) { let n = 0; for (const char of text(value)) if (!/\s/u.test(char)) n++; return n; }
  function chooseTitle(content, proposed = "") {
    const body = text(content), candidates = [];
    const clean = value => text(value).trim().replace(/^[“「『"']|[”」』"']$/g, "").trim();
    const key = value => clean(value).replace(/[。！？!?…]+$/u, "");
    function add(value, dialogue, at) {
      value = clean(value);
      const size = count(value);
      if (size < 2 || size > 64 || /[<>]|\\(?:text|frac|begin)\b/u.test(value) || !/\p{L}/u.test(value)) return;
      if (!body.includes(value)) return;
      candidates.push({ value, dialogue, score: 24 - Math.abs(size - 16) + at / Math.max(body.length, 1) });
    }
    const sentences = value => value.match(/[^。！？!?\n]+[。！？!?]+|[^。！？!?\n]+$/gu) || [];
    for (const match of body.matchAll(/[“「『"]([^”」』"\n]+)[”」』"]/gu)) {
      if (/<[^>]*$/.test(body.slice(Math.max(0, match.index - 100), match.index))) continue;
      if (!/[。！？!?….]/u.test(match[1]) && !/[：:]\s*$/u.test(body.slice(Math.max(0, match.index - 24), match.index))) continue;
      for (const line of sentences(match[1])) add(line, true, match.index);
    }
    for (const line of sentences(body)) add(line, false, body.indexOf(line));
    const suggested = clean(text(proposed).replace(/^第[一二三四五六七八九十百千零〇\d]+章\s*[：:、.\-]?\s*/u, ""));
    const exact = candidates.find(item => key(item.value) === key(suggested));
    if (exact) return body.includes(suggested) ? suggested : exact.value;
    candidates.sort((a, b) => Number(b.dialogue) - Number(a.dialogue) || b.score - a.score);
    if (candidates.length) return candidates[0].value;
    // A long unpunctuated paragraph can still offer a whole short clause.
    for (const clause of body.split(/[，,；;\n]/u)) { add(clause, false, body.indexOf(clause)); if (candidates.length) return candidates[0].value; }
    return [...body.trim()].slice(0, 64).join("") || "未命名章节";
  }
  function relink(chapters) {
    return chapters.map((chapter, index) => ({ ...chapter, wordCount: count(chapter.content),
      prevSummary: index ? (chapters[index - 1].summaryStale ? "" : text(chapters[index - 1].summary)) : "这是故事的开始。" }));
  }
  function target(story, index) {
    if (!Number.isInteger(index) || index < 0 || !story?.chapters?.[index]) throw new Error("章节已不存在，请重新打开目录。");
    return story.chapters[index];
  }
  function linkedIndex(story) {
    const last = story.lastGeneration;
    return Number.isInteger(last?.chapterIndex) ? last.chapterIndex : last?.status === "saved" ? story.chapters.length - 1 : -1;
  }
  function edit(story, index, changes, now = Date.now()) {
    const old = target(story, index), content = changes.content === undefined ? text(old.content) : text(changes.content);
    if (!content.trim()) throw new Error("正文不能为空；要移除整章，请使用删除章节。");
    const summary = changes.summary === undefined ? text(old.summary) : text(changes.summary);
    const changedBody = content !== text(old.content), changedSummary = summary !== text(old.summary);
    const chapter = { ...old, title: changes.title === undefined ? old.title : text(changes.title).trim() || chooseTitle(content), content, summary,
      summaryStale: Boolean(summary) && !(changedSummary || changes.summaryConfirmed) && (changedBody || Boolean(old.summaryStale)), editedAt: now };
    const chapters = story.chapters.map((item, at) => at === index ? chapter : item);
    return { ...story, chapters: relink(chapters), lastUpdated: now,
      lastGeneration: linkedIndex(story) === index && story.lastGeneration?.status === "saved" ? { ...story.lastGeneration, chapterIndex: index, chapterEditedAt: now } : story.lastGeneration };
  }
  function remove(story, index, now = Date.now()) {
    target(story, index);
    const linked = linkedIndex(story), chapters = story.chapters.filter((_, at) => at !== index);
    let lastGeneration = story.lastGeneration;
    if (linked === index && lastGeneration?.status === "saved") lastGeneration = null;
    else if (linked > index) lastGeneration = { ...lastGeneration, chapterIndex: linked - 1 };
    return { ...story, chapters: relink(chapters), lastGeneration, lastUpdated: now };
  }
  return Object.freeze({ count, chooseTitle, edit, remove });
});
