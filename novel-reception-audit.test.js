const assert = require('node:assert/strict');
const stream = require('./novel-stream.js');
const enc = new TextEncoder();
const packet = value => 'data: ' + JSON.stringify(value) + '\n\n';
const delta = content => ({ choices: [{ index: 0, delta: { content } }] });
const done = 'data: [DONE]\n\n';
const tests = [];
function test(name, run) { tests.push({ name, run }); }
function response(wire) { return new Response(wire, { headers: { 'content-type': 'text/event-stream' } }); }
test('a shorter, differing final message cannot erase already received prose', async () => {
  const prose = '<novel_content>完整开头。' + '已收到的后续正文。'.repeat(80) + '</novel_content>';
  const result = await stream.read(response(packet(delta(prose)) + packet({ choices: [{ index: 0, message: { content: '<novel_content>完整开头，' }, finish_reason: 'stop' }] }) + done), { waitForEOF: true });
  assert.equal(result.raw, prose);
});
test('an empty delta must not hide a final message with content', async () => {
  const prose = '<novel_content>开头以及结尾。</novel_content>';
  const result = await stream.read(response(packet(delta('<novel_content>开头')) + packet({ choices: [{ index: 0, delta: {}, message: { content: prose }, finish_reason: 'stop' }] }) + done), { waitForEOF: true });
  assert.equal(result.raw, prose);
});
test('legacy text alias alongside a delta is not appended twice', async () => {
  const result = await stream.read(response(packet({ choices: [{ index: 0, delta: { content: '正文' }, text: '正文' }] }) + done), { waitForEOF: true });
  assert.equal(result.raw, '正文');
});
test('retain received text from an unfinished last JSON packet on clean HTTP EOF', async () => {
  const result = await stream.read(response(packet(delta('开头。')) + 'data: {"choices":[{"index":0,"delta":{"content":"后半段已经传来但包装未闭合'), { waitForEOF: true });
  assert.equal(result.raw, '开头。后半段已经传来但包装未闭合');
  assert.equal(result.partial, true);
});
test('JSON event lines without blank separators show progress before EOF', async () => {
  let controller, visible = '';
  const body = new ReadableStream({ start(c) { controller = c; } });
  const task = stream.read(new Response(body), { waitForEOF: true, onProgress: update => visible = update.raw });
  controller.enqueue(enc.encode('data: ' + JSON.stringify(delta('现在就该显示')) + '\n'));
  await new Promise(resolve => setTimeout(resolve, 20));
  const beforeEOF = visible;
  controller.enqueue(enc.encode('data: ' + JSON.stringify(delta('后续')) + '\ndata: [DONE]\n'));
  controller.close();
  const result = await task;
  assert.equal(beforeEOF, '现在就该显示');
  assert.equal(result.raw, '现在就该显示后续');
});
test('keep the pre-parser response tail, bounded independently of prose', async () => {
  const prose = '收到的完整正文🙂'.repeat(12000);
  const wire = packet(delta(prose)) + done;
  const result = await stream.read(response(wire), { waitForEOF: true });
  assert.equal(result.raw, prose);
  assert.equal(result.wireEvidence.tail, wire.slice(-65536));
  assert.equal(result.wireEvidence.totalChars, wire.length);
  assert.equal(result.wireEvidence.truncated, true);
  const shortWire = packet(delta('只有这几个字')) + done;
  const short = await stream.read(response(shortWire), { waitForEOF: true });
  assert.deepEqual(short.wireEvidence, { tail: shortWire, totalChars: shortWire.length, truncated: false });
});
test('a truncated nonstream JSON response retains its received content too', async () => {
  const result = await stream.read(response('{"choices":[{"message":{"content":"已传来的正文\\n最后的半句'), { waitForEOF: true });
  assert.equal(result.raw, '已传来的正文\n最后的半句');
  assert.equal(result.partial, true);
});
test('multiline JSON, heartbeat and UTF8 boundaries remain exact across repeated reads', async () => {
  const prose = '<novel_content>引号"、\\、换行\n🙂' + '上一段已保留。'.repeat(500) + '</novel_content>';
  const wire = ':heartbeat\r\n\r\nevent: message\r\ndata: {"choices":\r\ndata: [{"index":0,"delta":{"content":' + JSON.stringify(prose) + '}}]}\r\n\r\n' + done;
  for (let run = 0; run < 12; run++) {
    const bytes = enc.encode(wire); let at = 0;
    const source = new ReadableStream({ pull(c) {
      if (at >= bytes.length) return c.close();
      const size = [1, 17, 2000, 301][at % 4]; c.enqueue(bytes.slice(at, at + size)); at += size;
    } });
    const result = await stream.read(new Response(source), { waitForEOF: true });
    assert.equal(result.raw, prose); assert.equal(result.partial, false);
    assert.equal(result.stats.readerCancelled, false);
    assert.equal(result.wireEvidence.tail, wire);
  }
});
(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS:', name); }
    catch (error) { failed++; console.error('FAIL:', name, '\n', error.message.slice(0, 350)); }
  }
  stream.releaseCompleted();
  if (failed) process.exitCode = 1;
})();
