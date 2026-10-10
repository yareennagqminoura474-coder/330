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
  for (const first of [openai(JSON.stringify([header])), openai(raw.slice(0, -1)), openai(raw, "length"), gemini([{ text: raw }], "MAX_TOKENS"),
    { candidates: [{ finishReason: "MAX_TOKENS" }] }, openai(null, "length"), openai(""), openai("[]")]) {
    const calls = [];
    const result = await response.complete(async (instruction) => { calls.push(instruction); return calls.length === 1 ? first : openai(raw); });
    assert.equal(calls.length, 2); assert.equal(calls[0], ""); assert.match(calls[1], /本轮当前时间不变/);
    assert.equal(result.raw, raw);
  }
  let calls = 0;
  await assert.rejects(response.complete(async () => { calls++; return openai(JSON.stringify([header])); }), /已自动重试一次/);
  assert.equal(calls, 2);
  calls = 0;
  for (const blocked of [openai(raw, "content_filter"), gemini([{ text: raw }], "SAFETY"), { promptFeedback: { blockReason: "OTHER" } }, { choices: [{ message: { refusal: "拒绝" } }] }]) {
    const before = calls;
    await assert.rejects(response.complete(async () => { calls++; return blocked; }), /拦截原因|拒绝/);
    assert.equal(calls, before + 1, "Blocked replies must never trigger recovery");
  }
  calls = 0;
  await assert.rejects(response.complete(async () => { calls++; throw new TypeError("Failed to fetch"); }), /Failed to fetch/);
  assert.equal(calls, 1, "Do not retry arbitrary network failures");
  calls = 0;
  const syntaxRecovered = await response.complete(async () => { if (++calls === 1) throw new SyntaxError("Unexpected end"); return openai(raw); });
  assert.equal(syntaxRecovered.raw, raw); assert.equal(calls, 2);
  const controller = new AbortController(); calls = 0;
  await assert.rejects(response.complete(async () => { calls++; controller.abort(); return openai(raw); }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
  const stopRetry = new AbortController(); calls = 0;
  await assert.rejects(response.complete(async () => {
    calls++; if (calls === 2) stopRetry.abort(); return calls === 1 ? openai("[]") : openai(raw);
  }, { signal: stopRetry.signal }), { name: "AbortError" });
  assert.equal(calls, 2);
  for (const count of [1, 12, 80]) {
    const many = Array.from({ length: count }, () => body); let requests = 0;
    const result = await response.complete(async () => { requests++; return openai(JSON.stringify(many)); });
    assert.equal(result.items.length, count); assert.equal(requests, 1);
  }
  console.log("PASS: multipart visible-text extraction, nested/multiple JSON batches, no silent partial success, one bounded recovery, length metadata, short/long replies, safety/refusal/network errors, cancellation");
})().catch((error) => { console.error(error); process.exitCode = 1; });
