const assert = require('node:assert/strict');
const core = require('./novel-memory.js');
const context = require('./novel-context.js');
(async () => {
  const chapters = [
    { title: '旧事', content: '甲星期一答应乙周末归还旧书。'.repeat(2000), summary: '' },
    { title: '有效摘要', content: '原文不能重送'.repeat(100), summary: '有效的既有摘要' },
    { title: '待更新', content: '新改过的原文。'.repeat(150), summary: '过时的摘要', summaryStale: true },
    { title: '上一章', content: '上一章必须全文保留', summary: '' }
  ];
  const original = JSON.stringify(chapters), plan = await core.plan(chapters);
  assert.deepEqual(plan.jobs.map(job => job.index), [0, 2]);
  assert.equal(plan.jobs[0].pieces.join(''), chapters[0].content);
  for (const batch of plan.batches) {
    assert.ok(batch.reduce((n, part) => n + part.content.length, 0) <= core.SIZE);
    assert.doesNotMatch(core.prompt(batch), /原文不能重送|上一章必须全文保留|过时的摘要/);
  }
  let current = chapters;
  const first = plan.batches[0];
  const response = batch => JSON.stringify({ summaries: batch.map(part => ({ id: part.id, summary: '甲在星期一向乙借了旧书，承诺周末归还。乙只知道借书安排，尚未得知后续计划。' })) });
  current = core.apply(current, plan, first, core.parse(response(first), first));
  assert.equal(current[0].summary, '', 'do not replace the full chapter with a partial summary');
  core.adopt(plan, current);
  const resume = await core.plan(current);
  assert.match(core.prompt(resume.batches[0], resume), /甲在星期一向乙借了旧书/);
  assert.ok(!resume.batches.flat().some(part => part.id === first[0].id), 'completed pieces are reused on resume without another API call');
  for (const batch of resume.batches) { current = core.apply(current, resume, batch, core.parse(response(batch), batch)); core.adopt(resume, current); }
  assert.equal((await core.plan(current)).batches.length, 0);
  assert.equal(current[2].summaryStale, false);
  assert.equal(current[0].memorySummaryParts, undefined);
  assert.deepEqual(current.map(c => c.content), chapters.map(c => c.content));
  assert.match(context.recap(current), /甲在星期一向乙/);
  assert.doesNotMatch(context.recap(current), /过时的摘要|新改过的原文/);
  assert.ok(context.recap(current).length < context.recap(chapters).length / 10);
  assert.equal(JSON.stringify(chapters), original);
  for (const raw of ['', '{"summaries":[', '{"summaries":[]}', '{"summaries":[{"id":"wrong","summary":"不对应"}]}']) assert.throws(() => core.parse(raw, first));
  const changed = chapters.map((c, i) => i === 0 ? { ...c, content: '用户已改写原文' } : c);
  assert.throws(() => core.apply(changed, plan, first, core.parse(response(first), first)), /编辑或移动/);
  const stalePartial = structuredClone(current); stalePartial[0].summaryStale = true; stalePartial[0].content += '新信息';
  assert.ok((await core.plan(stalePartial)).jobs.some(job => job.index === 0));
  const huge = '甲'.repeat(core.SIZE - 1) + '😀' + '乙'.repeat(core.SIZE);
  const split = core.split(huge); assert.equal(split.join(''), huge);
  assert.ok(split.every(part => part.length <= core.SIZE && !/[\uD800-\uDBFF]$/.test(part)));
  const refs = core.references(), long = '完整设定，保留关系与伏笔。'.repeat(200);
  assert.ok(refs.add(long).includes(long)); assert.ok(!refs.add(long).includes(long));
  assert.ok(refs.add(long + '不同细节').includes(long + '不同细节'));
  assert.equal(refs.add('短句'), '短句'); assert.ok(refs.savedChars > 1000);
  console.log('PASS: bounded summary batches, checkpoint reuse, edit conflicts, full source preservation, prior-chapter exclusion and exact-only references');
})().catch(error => { console.error(error); process.exitCode = 1; });
