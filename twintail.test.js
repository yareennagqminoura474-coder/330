const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.EPhoneNovelStream = require("./novel-stream.js");
globalThis.ephoneChatResponse = require("./chat-response.js");
require("./twintail.js");
const plugin = globalThis.EPhoneTwinTail;
const packet = text => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
const encoder = new TextEncoder();

test("emits array elements before EOF and survives a broken tail", async () => {
  let controller, first;
  const firstReceived = new Promise(resolve => { first = resolve; });
  const response = new Response(new ReadableStream({ start(c) { controller = c; } }));
  const run = plugin.read(response, { waitForEOF: true, onProgress: update => {
    if (update.raw) first(update.raw);
  } }, "绿江小说");
  const text = '这句里有括号 ] 和引号 "。';
  for (const byte of encoder.encode("[" + packet(text))) controller.enqueue(Uint8Array.of(byte));
  assert.equal(await firstReceived, text);
  controller.enqueue(encoder.encode("," + packet("后半句。")));
  controller.close();
  const result = await run;
  assert.equal(result.raw, text + "后半句。");
  assert.equal(result.partial, true);
});

test("reads QQ stream once and preserves late prose, actual usage and stop reason", async () => {
  const sse = obj => "data: " + JSON.stringify(obj) + "\n\n";
  const response = new Response(sse({ choices: [{ delta: { content: "上半句", reasoning_content: "思考" } }] }) +
    "data: [DONE]\n\n" + sse({ choices: [{ delta: { content: "下半句" }, finish_reason: "stop" }], usage: { completion_tokens: 12 } }),
    { headers: { "Content-Type": "text/event-stream" } });
  const result = await plugin.chat(response, new AbortController().signal, "QQ 回复", false);
  assert.equal(result.choices[0].message.content, "上半句下半句");
  assert.equal(result.usage.completion_tokens, 12);
  assert.equal(result.choices[0].finish_reason, "stop");
  assert.equal(response.bodyUsed, true);
  assert.equal(plugin.nativeUrl("https://example.org/models/m:generateContent?key=fake", true), "https://example.org/models/m:streamGenerateContent?key=fake&alt=sse");
});

test("preserves ordinary arrays and reports explicit provider failures", async () => {
  const raw = JSON.stringify([{ type: "text", content: "一段正文" }]);
  const original = await globalThis.EPhoneNovelStream.read(new Response(raw), { waitForEOF: true });
  assert.equal((await plugin.read(new Response(raw), { waitForEOF: true }, "测试")).raw, original.raw);
  await assert.rejects(plugin.read(new Response('[{"error":{"message":"测试错误"}}]'), {}, "测试"), /测试错误/);
});
