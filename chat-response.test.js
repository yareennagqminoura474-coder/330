const assert = require("node:assert/strict");
const response = require("./chat-response.js");
const header = { type: "narration", content: "2026年3月5日，07点20分，星期四，地点：客厅" };
const body = { type: "text", name: "林", content: '你好，括号 { } [ ] 和引号 " 都保留。' };
const raw = JSON.stringify([header, body]);
const openai = (content, reason = "stop") => ({ choices: [{ message: { content }, finish_reason: reason }] });
const gemini = (parts, reason = "STOP") => ({ candidates: [{ content: { parts }, finishReason: reason }] });

(async () => {
  assert.equal(response.extractText(gemini([{ thought: true, text: "hidden" }, { text: raw.slice(0, 30) }, { text: raw.slice(30) }])), raw);
  assert.equal(response.extractText(openai([{ type: "text", text: raw.slice(0, 15) }, { type: "reasoning", text: "hidden" }, { type: "text", text: raw.slice(15) }])), raw);
  assert.equal(response.extractText({ choices: [{ message: { content: "first" } }, { message: { content: "alternative" } }] }), "first");
  assert.equal(response.extractText(gemini([{ thought: true, text: "hidden" }])), "");
  assert.equal(response.extractText({ data: openai(raw) }), raw);
  assert.equal(response.extractText({ choices: [{ text: raw }] }), raw);
  assert.equal(response.extractText({ output: [{ type: "reasoning", content: [{ text: "hidden" }] }, { type: "message", content: [{ type: "output_text", text: raw }] }] }), raw);
  assert.equal(response.extractText({ output: { invalid: true } }), null);
  assert.equal(response.extractText(openai([header, body])), raw);
  assert.equal(response.extractText(openai({ messages: [body] })), JSON.stringify({ messages: [body] }));
  assert.deepEqual(response.inspect(raw).items, [header, body]);
  const nested = { type: "quote_reply", name: "林", reply_content: "完整", data: { target: { content: "包含 { 嵌套 }" } } };
  assert.deepEqual(response.inspect(JSON.stringify([nested])).items, [nested]);
  assert.deepEqual(response.inspect('```json\n' + JSON.stringify([header]) + '\n```\n```json\n' + JSON.stringify([body, nested]) + '\n```').items, [header, body, nested]);
  assert.deepEqual(response.inspect(JSON.stringify({ messages: [body] })).items, [body]);
  assert.equal(response.inspect("你好，[微笑]。").structured, false);
  for (const broken of [raw.slice(0, -1), raw.slice(0, -5), '[{"type":"text","content":"', "[", '[{"type":"text",}]']) {
    assert.equal(response.inspect(broken).incomplete, true, broken);
  }
  assert.equal(response.hasBody([header]), false);
  assert.equal(response.hasBody([{ ...header, content: header.content + "。" }]), false);
  assert.equal(response.hasBody([header, { type: "update_thoughts", content: "hidden" }]), false);
  assert.equal(response.hasBody([{ type: "text", content: "好。" }]), true);
  assert.equal(response.hasBody([{ type: "accept_transfer", for_timestamp: 1 }]), true);
  assert.equal(response.hasBody([body], () => false), false);
  for (const first of [openai(JSON.stringify([header])), openai(raw.slice(0, -1)), openai(raw, "length"), gemini([{ text: raw }], "MAX_TOKENS")]) {
    const calls = [];
    const result = await response.complete(async (instruction) => { calls.push(instruction); return first; });
    assert.ok(result.items.length > 0, "received text must not be rejected for length, header-only or missing closing bracket");
    assert.equal(calls.length, 1); assert.equal(calls[0], undefined, "no repair prompt or paid replacement request");
  }
  let calls = 0;
  for (const empty of [{ candidates: [{ finishReason: "MAX_TOKENS" }] }, openai(null, "length"), openai(""), openai("[]"),
    openai(JSON.stringify([{ type: "thought_chain", content: "hidden" }])),
    { choices: [{ message: { content: null, reasoning_content: "hidden thinking" } }], usage: { completion_tokens: 5000, completion_tokens_details: { reasoning_tokens: 5000 } } }]) {
    const before = calls;
    await assert.rejects(response.complete(async () => { calls++; return empty; }), /最终正文确实为空.*仅调用一次/);
    assert.equal(calls, before + 1);
  }
  await assert.rejects(response.complete(async () => ({ choices: [{ message: { content: null } }], usage: { completion_tokens: 5000, completion_tokens_details: { reasoning_tokens: 5000 } } })), /输出 5000 tokens，其中思考 5000 tokens/);
  for (const blocked of [openai("", "content_filter"), gemini([], "SAFETY"), { promptFeedback: { blockReason: "OTHER" } }]) await assert.rejects(response.complete(async () => blocked), /拦截原因/);
  for (const content of [openai(raw, "content_filter"), gemini([{ text: raw }], "SAFETY")]) assert.deepEqual((await response.complete(async () => content)).items, [header, body], "finish metadata cannot discard text actually returned by the provider");
  assert.equal((await response.complete(async () => ({ choices: [{ message: { refusal: "拒绝" } }] }))).items[0].content, "拒绝", "a visible provider refusal is a reply, not an empty result");
  const broken = JSON.stringify([header, body]).slice(0, -1) + ',{"type":"text","name":"林","content":"尾句也要保留\\n收到多少显示多少';
  const recovered = await response.complete(async () => openai(broken, "length"));
  assert.equal(recovered.raw, broken); assert.deepEqual(recovered.items, [header, body, { type: "text", name: "林", content: "尾句也要保留\n收到多少显示多少" }]);
  assert.deepEqual(response.recover('{"messages":' + broken), recovered.items, "an incomplete wrapper preserves its complete children and text tail");
  assert.deepEqual(response.recover(JSON.stringify([body]).slice(0, -1) + ',{"type":"transfer","amount":999'), [body], "unfinished operational events cannot become executable payments");
  assert.deepEqual(response.recover('[{"type":"text","content":"第一行\n第二行"},]'), [{ type: "text", content: "第一行\n第二行" }]);
  // A provider sometimes forgets to escape quotation marks inside JSON prose.
  // Recover the whole sentence, not just the prefix before its first quote.
  const quotedSentences = [
    '问的时候客气一点，不要说"我今晚带爸妈来"，说家里人想登门感谢。',
    '别说"我要去你家"。要说"家里人想登门感谢"。',
    '英文也保留："hello", 然后继续说完整。',
    '代码也保留："value": 不是新字段；"}" 和 "]" 都是原话。',
    '字符串"}"和"]"均保留。',
    '没说完的引号也照收："我今晚带爸妈来',
    '转义和引号混合："原话"，路径 C:\\temp\\note，末尾完整。',
  ];
  const malformedMessage = (content, alias = "content") => '{"type":"text","name":"林","' + alias + '":"' +
    JSON.stringify(content).slice(1, -1).replace(/\\"/g, '"') + '"}';
  for (const content of quotedSentences) {
    const expected = [{ type: "text", name: "林", content }, { type: "text", name: "林", content: "后面的消息不能消失或并入上一条。" }];
    const malformed = '[' + malformedMessage(content) + ',' + JSON.stringify(expected[1]) + ']';
    for (const input of [malformed, malformed.slice(0, -1), '{"messages":' + malformed + '}',
      '```json\n' + malformed + '\n```', malformedMessage(content) + '\n' + JSON.stringify(expected[1])]) {
      assert.deepEqual(response.recover(input), expected, input);
    }
    assert.deepEqual(response.recover(JSON.stringify(expected)), expected, "valid escaped JSON must be unchanged");
    for (const alias of ["content", "message", "c", "dialogue"]) {
      assert.equal(response.recover('[' + malformedMessage(content, alias) + ']')[0].content, content, alias);
    }
    let quoteCalls = 0;
    const result = await response.complete(async () => { quoteCalls++; return openai(malformed); }, {
      parse: (text) => response.inspect(text).items,
    });
    assert.equal(quoteCalls, 1, "local recovery must never make a paid repair call");
    assert.equal(result.raw, malformed); assert.deepEqual(result.items, expected);
  }
  assert.deepEqual(response.recover('[{"type":"text","name":"林","content":"不要说"我要去你家"，后面收到的半句'), [
    { type: "text", name: "林", content: '不要说"我要去你家"，后面收到的半句' },
  ], "an actually truncated quoted sentence preserves everything received, without inventing an ending");
  const nestedQuoted = { type: "quote_reply", name: "林", reply_content: '保留 "英文引号"。', data: { target: { content: '嵌套 { } [ ] 和 "引号"', labels: ["甲", "乙"] } } };
  assert.deepEqual(response.recover('```json\n' + JSON.stringify([nestedQuoted]) + '\n```'), [nestedQuoted], "valid nested cards remain intact");
  assert.deepEqual(response.recover('[' + malformedMessage(quotedSentences[0]) + ',{"type":"transfer","content":"说明"引号"完整","amount":999'), [
    { type: "text", name: "林", content: quotedSentences[0] },
  ], "fixing prose must not turn a malformed payment into an executable card");
  const afterContent = '{"content":"别说"现在来"，说完整。","type":"text","name":"林","extra":{"labels":["甲","乙"]}}';
  assert.deepEqual(response.recover('[' + afterContent + ']'), [{ type: "text", name: "林", content: '别说"现在来"，说完整。' }], "content before speaker/type metadata still preserves the complete sentence and speaker");
  const chineseQuotes = { type: "text", name: "林", content: '中文“引号”和「引号」也不变，英文 "引号" 也保留。' };
  assert.deepEqual(response.recover(JSON.stringify([chineseQuotes]) + '\n这是格式块之后的文字。'), [chineseQuotes, { type: "text", content: "这是格式块之后的文字。" }], "strict valid roots followed by prose are not swallowed into a value");
  const quotedBatch = Array.from({ length: 512 }, (_, i) => ({ type: "text", name: "林", content: `第${i + 1}句："原话"的后半句也必须保留。` }));
  assert.deepEqual(response.recover('[' + quotedBatch.map((item) => malformedMessage(item.content)).join(',') + ']'), quotedBatch, "large malformed batches do not merge speakers or cap the reply count");
  assert.deepEqual(response.recover('[{"t":"text","n":"林","c":"字段兼容"}]'), [{ t: "text", n: "林", c: "字段兼容", type: "text", name: "林", content: "字段兼容" }]);
  for (const count of [201, 512, 1024]) {
    const many = Array.from({ length: count }, (_, i) => ({ type: "text", name: "林", content: `完整的第${i + 1}条回复。` }));
    let countCalls = 0;
    const all = await response.complete(async () => { countCalls++; return openai(JSON.stringify(many), "length"); });
    assert.equal(countCalls, 1, "large replies must not cause another generation request");
    assert.deepEqual(all.items, many, `${count} actual returned messages survive without a 160/200 item cap, even if the provider labels finish_reason length`);
  }
  assert.equal(response.recover('[{"type":"text","name":"林","dialogue":"兼容台词字段"}]')[0].content, "兼容台词字段");
  const unnamed = await response.complete(async () => openai("林轻轻放下了手里的书。"), { isRenderable: (item) => item.type === "narration" });
  assert.equal(unnamed.items[0].type, "narration"); assert.equal(unnamed.items[0].content, "林轻轻放下了手里的书。");
  calls = 0;
  await assert.rejects(response.complete(async () => { calls++; throw new TypeError("Failed to fetch"); }), /Failed to fetch/);
  assert.equal(calls, 1, "Do not retry arbitrary network failures");
  calls = 0;
  await assert.rejects(response.complete(async () => { calls++; throw new SyntaxError("Unexpected end"); }), /接口响应数据未完整传输.*仅调用一次/);
  assert.equal(calls, 1);
  const controller = new AbortController(); calls = 0;
  await assert.rejects(response.complete(async () => { calls++; controller.abort(); return openai(raw); }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
  const stoppedBeforeSend = new AbortController(); calls = 0; stoppedBeforeSend.abort();
  await assert.rejects(response.complete(async () => { calls++; return openai(raw); }, { signal: stoppedBeforeSend.signal }), { name: "AbortError" });
  assert.equal(calls, 0);
  for (const count of [1, 12, 80]) {
    const many = Array.from({ length: count }, () => body); let requests = 0;
    const result = await response.complete(async () => { requests++; return openai(JSON.stringify(many)); });
    assert.equal(result.items.length, count); assert.equal(requests, 1);
  }
  const long = "完整长回复，不得裁剪。".repeat(12000), longResult = await response.complete(async () => openai(JSON.stringify([{ ...body, content: long }]), "length"));
  assert.equal(longResult.items[0].content, long);
  console.log("PASS: one-request replies preserve long/multipart/length-marked text, missing JSON closure and partial text tails; incomplete actions stay inert; visible refusal, true empty/reasoning, network failures and cancellation");
})().catch((error) => { console.error(error); process.exitCode = 1; });
