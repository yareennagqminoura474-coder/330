"use strict";
const assert = require("node:assert/strict"), core = require("./novel-stream.js"), chat = require("./chat-response.js");
const encode = (text) => new TextEncoder().encode(text);
const event = (data, name = "") => (name ? "event: " + name + "\n" : "") + "data: " + (typeof data === "string" ? data : JSON.stringify(data)) + "\n\n";
const done = "data: [DONE]\n\n";
function response(text, sizes = [7, 1, 13, 2, 5], type = "text/event-stream") {
  const bytes = encode(text); let at = 0, index = 0;
  return new Response(new ReadableStream({ pull(controller) { if (at >= bytes.length) { controller.close(); return; } const n = sizes[index++ % sizes.length]; controller.enqueue(bytes.slice(at, at + n)); at += n; } }), { headers: { "Content-Type": type } });
}
function controlled(type = "text/event-stream") {
  let controller;
  const value = new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { "Content-Type": type } });
  return { response: value, push: (text) => controller.enqueue(encode(text)), close: () => controller.close(), fail: (error) => controller.error(error) };
}
const delta = (text) => ({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
(async () => {
  const sample = '中文、emoji🙂和引号"，{括号}，\n正文不会在缓冲边界丢失。';
  const progress = [], stream = controlled(); let settled = false, first;
  const firstReceived = new Promise((resolve) => first = resolve);
  const reading = core.read(stream.response, { onProgress(value) { progress.push(value); if (value.raw) first(); } }).then((value) => { settled = true; return value; });
  stream.push(event(delta("第一段")));
  await firstReceived;
  assert.equal(settled, false, "visible first text must arrive before provider finishes response");
  assert.equal(progress.at(-1).raw, "第一段"); assert.equal(progress.at(-1).phase, "writing");
  stream.push(event(delta(sample)) + event({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + event({ choices: [], usage: { prompt_tokens: 23, completion_tokens: 42, completion_tokens_details: { reasoning_tokens: 6 } } }) + done);
  // A server can keep its socket open after DONE; no unnecessary EOF wait.
  const result = await reading;
  assert.equal(result.raw, "第一段" + sample); assert.equal(result.partial, false); assert.equal(result.aborted, false);
  assert.equal(result.finishReason, "stop"); assert.equal(result.usage.inputTokens, 23); assert.equal(result.usage.outputTokens, 42); assert.equal(result.usage.reasoningTokens, 6);
  assert.ok(result.stats.streamed); assert.ok(result.stats.firstTextMs !== null); assert.ok(result.stats.receiveMs >= result.stats.firstTextMs);
  assert.equal(result.stats.visibleChars, result.raw.length);
  for (const ending of [event({ choices: [{ index: 0, delta: { content: "完整正文" }, finish_reason: "stop" }], usage: { completion_tokens: 10354 } }),
    event({ candidates: [{ content: { parts: [{ text: "完整正文" }] }, finishReason: "STOP" }], usageMetadata: { candidatesTokenCount: 10354 } }),
    event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "完整正文" } }) + event({ type: "message_stop" }),
    event({ type: "response.completed", response: { output_text: "完整正文" } })]) {
    const open = controlled();
    const ready = core.read(open.response);
    open.push(ending);
    const completed = await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error("terminal provider event must not wait for socket EOF")), 1000))]);
    assert.equal(completed.raw, "完整正文"); assert.equal(completed.partial, false);
  }
  // Provider ignores stream:true and sends a whole JSON envelope, then keeps
  // HTTP open. Balanced-container detection must not wait for body EOF either.
  const jsonSocket = controlled("application/json"), jsonSocketReading = core.read(jsonSocket.response);
  jsonSocket.push('{"choices":[{"message":{"content":"正文里有 } 和 [，以及 \\"引号\\"，不能误判结束。"},"finish_reason":"stop"}]}');
  const jsonFinished = await Promise.race([jsonSocketReading, new Promise((_, reject) => setTimeout(() => reject(new Error("full JSON envelope must not wait for EOF")), 1000))]);
  assert.equal(jsonFinished.raw, '正文里有 } 和 [，以及 "引号"，不能误判结束。');
  assert.equal(jsonFinished.partial, false); assert.equal(jsonFinished.stats.streamed, false);

  const unicode = await core.read(response(event(delta(sample)) + done, [1]));
  assert.equal(unicode.raw, sample, "UTF8 multibyte characters split across individual bytes must stay intact");
  const crlf = await core.read(response(": heartbeat\r\n\r\nevent: message\r\ndata: {\r\ndata: \"choices\":[{\"index\":0,\"delta\":{\"content\":\"完整换行事件\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n", [1]));
  assert.equal(crlf.raw, "完整换行事件"); assert.equal(crlf.partial, false, "CRLF and multi-line SSE data remain valid");
  assert.equal((await core.read(response(event(delta(sample)) + done, [2], "application/json"))).raw, sample, "mislabeled SSE is recognized by actual content");

  const secret = "REASONING_MUST_NEVER_APPEAR", hiddenProgress = [];
  const thinking = await core.read(response(event({ choices: [{ index: 0, delta: { reasoning_content: secret } }] }) + event(delta("正文")) + done), { onProgress: (value) => hiddenProgress.push(value) });
  assert.equal(thinking.raw, "正文"); assert.equal(thinking.stats.reasoningSeen, true);
  assert.ok(hiddenProgress.some((value) => value.phase === "thinking")); assert.ok(!JSON.stringify(hiddenProgress).includes(secret));
  assert.equal((await core.read(response(event({ choices: [{ index: 1, delta: { content: "不得选择的候选" } }] }) + event(delta("第一候选")) + done))).raw, "第一候选");
  const snapshots = event({ choices: [{ index: 0, message: { content: "先" } }] }) + event({ choices: [{ index: 0, message: { content: "先后" } }] }) + event({ choices: [{ index: 0, message: { content: "先后" } }] }) + done;
  assert.equal((await core.read(response(snapshots))).raw, "先后", "full message snapshots must not duplicate content");

  const gemini = await core.read(response(event({ candidates: [{ index: 0, content: { parts: [{ text: secret, thought: true }] } }] }) + event({ candidates: [{ content: { parts: [{ text: "哈哈" }] } }] }) + event({ candidates: [{ content: { parts: [{ text: "哈哈" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 31, candidatesTokenCount: 10, thoughtsTokenCount: 5 } })), { onProgress(value) { assert.ok(!value.raw.includes(secret)); } });
  assert.equal(gemini.raw, "哈哈哈哈", "true Gemini deltas with repeated words cannot be mistaken for snapshots");
  assert.equal(gemini.partial, false); assert.equal(gemini.usage.inputTokens, 31); assert.equal(gemini.usage.outputTokens, 10); assert.ok(gemini.stats.reasoningSeen);
  const cumulative = await core.read(response(event({ cumulative: true, candidates: [{ content: { parts: [{ text: "甲" }] } }] }) + event({ cumulative: true, candidates: [{ content: { parts: [{ text: "甲乙" }] }, finishReason: "STOP" }] })));
  assert.equal(cumulative.raw, "甲乙");

  const anthropic = await core.read(response(event({ type: "message_start", message: { content: [], usage: { input_tokens: 16, output_tokens: 0 } } }, "message_start") +
    event({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }) +
    event({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: secret } }) +
    event({ type: "content_block_start", index: 1, content_block: { type: "text", text: "你好" } }) +
    event({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "，正文" } }) +
    event({ type: "ping" }, "ping") + event({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 27 } }) + event({ type: "message_stop" })));
  assert.equal(anthropic.raw, "你好，正文"); assert.equal(anthropic.partial, false); assert.equal(anthropic.usage.inputTokens, 16); assert.equal(anthropic.usage.outputTokens, 27); assert.ok(anthropic.stats.reasoningSeen);
  const responses = await core.read(response(event({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "片段" }) + event({ type: "response.output_text.done", output_index: 0, content_index: 0, text: "片段正文" }) + event({ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "片段正文" }] }], usage: { input_tokens: 5, output_tokens: 9 } } })));
  assert.equal(responses.raw, "片段正文"); assert.equal(responses.partial, false); assert.equal(responses.usage.outputTokens, 9);
  const metadataOnly = await core.read(response(event({ type: "response.output_text.delta", delta: sample }) + event({ type: "response.completed", response: { id: "response-test", status: "completed", usage: { output_tokens: 37 } } })));
  assert.equal(metadataOnly.raw, sample, "completion metadata must never replace the actual streamed novel"); assert.equal(metadataOnly.usage.outputTokens, 37);

  const plainApi = { choices: [{ message: { content: sample }, finish_reason: "stop" }], usage: { prompt_tokens: 17, completion_tokens: 19 } };
  for (const type of ["application/json", "text/event-stream", "text/plain"]) {
    const fallback = await core.read(response(JSON.stringify(plainApi), [3], type), { extractText: chat.extractText });
    assert.equal(fallback.raw, sample, "JSON fallback works even if endpoint mislabeled response: " + type); assert.equal(fallback.partial, false); assert.equal(fallback.stats.streamed, false); assert.equal(fallback.usage.outputTokens, 19);
  }
  const wrapped = await core.read(response(JSON.stringify({ data: plainApi }), [5], "application/json"));
  assert.equal(wrapped.raw, sample); assert.equal(wrapped.usage.outputTokens, 19);
  assert.equal((await core.read(response(sample, [3], "text/plain"))).raw, sample);
  const direct = { title: "章节", content: sample, summary: "结束。" };
  assert.deepEqual(JSON.parse((await core.read(response(JSON.stringify(direct), [11], "application/json"), { extractText: chat.extractText })).raw), direct);
  const jsonThought = await core.read(response(JSON.stringify({ content: [{ type: "thinking", thinking: secret }, { type: "text", text: sample }], type: "message", stop_reason: "end_turn", usage: { output_tokens: 8 } }), [2], "application/json"));
  assert.equal(jsonThought.raw, sample); assert.ok(!jsonThought.raw.includes(secret)); assert.ok(jsonThought.stats.reasoningSeen);
  const array = await core.read(response(JSON.stringify([{ candidates: [{ content: { parts: [{ text: "上段" }] } }] }, { candidates: [{ content: { parts: [{ text: "下段" }] }, finishReason: "STOP" }] }]), [1], "application/json"));
  assert.equal(array.raw, "上段下段"); assert.equal(array.partial, false);
  const missingDone = await core.read(response(event(delta("只收到的部分"))));
  assert.equal(missingDone.raw, "只收到的部分"); assert.equal(missingDone.partial, true);
  const capped = await core.read(response(event(delta(sample)) + event({ choices: [{ index: 0, delta: {}, finish_reason: "length" }] }) + done));
  assert.equal(capped.raw, sample); assert.equal(capped.partial, true, "provider output limits are reported, never locally applied");

  const interrupted = controlled(), received = [];
  const interruptedRead = core.read(interrupted.response, { onProgress(value) { if (value.raw && !received.length) { received.push(value.raw); interrupted.fail(new Error("provider connection lost")); } } });
  interrupted.push(event(delta("中断前已经写出的完整段落")));
  const unfinished = await interruptedRead; assert.equal(unfinished.raw, received[0]); assert.equal(unfinished.partial, true); assert.match(unfinished.error, /connection lost/);
  const controller = new AbortController(), stoppedStream = controlled();
  const stoppedRead = core.read(stoppedStream.response, { signal: controller.signal, onProgress(value) { if (value.raw) controller.abort(); } });
  stoppedStream.push(event(delta("停止前收到的小说正文")));
  const stopped = await stoppedRead; assert.equal(stopped.raw, "停止前收到的小说正文"); assert.equal(stopped.aborted, true); assert.equal(stopped.partial, true);
  const beforeStart = new AbortController(); beforeStart.abort();
  assert.equal((await core.read(controlled().response, { signal: beforeStart.signal })).aborted, true);
  await assert.rejects(() => core.read(response(event({ error: { message: "provider busy" } }, "error"))), (error) => error.partialRaw === "" && /provider busy/.test(error.message));
  const failedTail = await core.read(response(event(delta(sample)) + event({ error: { message: "provider overloaded" } }, "error")));
  assert.equal(failedTail.raw, sample); assert.equal(failedTail.partial, true); assert.match(failedTail.error, /provider overloaded/);
  await assert.rejects(() => core.read(response('{"error":{"message":"API unavailable"}}', [3], "application/json")), /API unavailable/);
  const malformedTail = await core.read(response(event(delta(sample)) + 'data: {"choices":[\n\n' + done));
  assert.equal(malformedTail.raw, sample); assert.equal(malformedTail.partial, true);
  const reasoningOnly = await core.read(response(event({ choices: [{ index: 0, delta: { reasoning_content: secret } }] }) + event({ choices: [], usage: { completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 5 } } }) + done));
  assert.equal(reasoningOnly.raw, ""); assert.ok(reasoningOnly.stats.reasoningSeen); assert.equal(reasoningOnly.stats.firstTextMs, null);
  assert.equal((await core.read(response(event(delta(sample)) + done), { onProgress() { throw new Error("UI observer failure"); } })).raw, sample, "a preview error cannot discard the paid response");
  const long = "完整正文，包含\"引号\"与{括号}。".repeat(12000);
  assert.equal((await core.read(response(event(delta(long)) + done, [1200, 3600, 7000]))).raw, long, "no local sentence, character or token cutoff");
  console.log("PASS: immediate visible streamed prose, arbitrary UTF8/CRLF/multiline SSE, OpenAI/Gemini/Anthropic/Responses deltas, snapshots, one-read JSON fallback, reasoning privacy, full-length output and partial/abort/error preservation");
})().catch((error) => { console.error(error); process.exitCode = 1; });
