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
  // Novel mode: early terminators are advisory. Even a long delivery pause and
  // cleanup of an unrelated completed request cannot abort this paid response.
  for (const marker of [done, event({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }), event({ type: "message_stop" }), event({ type: "response.completed" })]) {
    const active = controlled(); let stopped = false;
    const task = core.read(active.response, { waitForEOF: true }).then(value => { stopped = true; return value; });
    active.push(event(delta("开始")) + marker);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(stopped, false); core.releaseCompleted();
    active.push(event(delta("后续仍然属于同一次付费请求")) + event({ choices: [], usage: { completion_tokens: 17736 } }) + done);
    active.close();
    const result = await task;
    assert.equal(result.raw, "开始后续仍然属于同一次付费请求");
    assert.equal(result.usage.outputTokens, 17736); assert.equal(result.stats.httpEOF, true); assert.equal(result.stats.readerCancelled, false);
  }
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
  stream.close();
  assert.equal(result.raw, "第一段" + sample); assert.equal(result.partial, false); assert.equal(result.aborted, false);
  assert.equal(result.finishReason, "stop"); assert.equal(result.usage.inputTokens, 23); assert.equal(result.usage.outputTokens, 42); assert.equal(result.usage.reasoningTokens, 6);
  assert.ok(result.stats.streamed); assert.ok(result.stats.firstTextMs !== null); assert.ok(result.stats.receiveMs >= result.stats.firstTextMs);
  assert.equal(result.stats.visibleChars, result.raw.length);
  for (const ending of [event({ choices: [{ index: 0, delta: { content: "完整正文" }, finish_reason: "stop" }], usage: { completion_tokens: 10354 } }) + done,
    event({ candidates: [{ content: { parts: [{ text: "完整正文" }] }, finishReason: "STOP" }], usageMetadata: { candidatesTokenCount: 10354 } }),
    event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "完整正文" } }) + event({ type: "message_stop" }),
    event({ type: "response.completed", response: { output_text: "完整正文" } })]) {
    const open = controlled();
    const ready = core.read(open.response);
    open.push(ending);
    const completed = await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error("terminal provider event must not wait for socket EOF")), 1000))]);
    assert.equal(completed.raw, "完整正文"); assert.equal(completed.partial, false);
    open.close();
  }
  // Finish metadata may precede separately delivered tail/usage packets. Do not
  // cancel the paid response on that metadata, even across a long pause.
  let cancelCount = 0, lateController;
  const late = new Response(new ReadableStream({ start(c) { lateController = c; }, cancel() { cancelCount++; } }));
  let metadataSeen, lateSettled = false;
  const seenMetadata = new Promise(resolve => metadataSeen = resolve);
  const lateReading = core.read(late, { onProgress(value) { if (value.raw) metadataSeen(); } }).then(result => { lateSettled = true; return result; });
  lateController.enqueue(encode(event(delta("开头")) + event({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })));
  await seenMetadata; await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(lateSettled, false); assert.equal(cancelCount, 0);
  core.releaseCompleted();
  assert.equal(cancelCount, 0, "cleanup cannot cancel a generation that has not received its protocol terminator");
  lateController.enqueue(encode(event(delta("之后仍需完整接收的正文"))));
  lateController.enqueue(encode(event({ choices: [], usage: { completion_tokens: 17000 } }) + done));
  const lateResult = await lateReading;
  assert.equal(lateResult.raw, "开头之后仍需完整接收的正文"); assert.equal(lateResult.usage.outputTokens, 17000);
  assert.equal(lateResult.stats.completionSignal, "done_marker"); assert.equal(lateResult.stats.readerCancelled, false);
  assert.equal(cancelCount, 0, "normal completion must drain, not cancel the transport");
  lateController.close();
  // Simulate a two-minute delivery gap without making the suite sleep. It is
  // measured for diagnosis, never used to stop or retry the connection.
  const realNow = Date.now, activityStream = controlled(), activities = [];
  let clock = realNow(), activityReading;
  try {
    Date.now = () => clock;
    activityReading = core.read(activityStream.response, { onActivity(value) { activities.push(value); } });
    activityStream.push(event(delta("暂停之前"))); await new Promise(resolve => setTimeout(resolve, 0));
    clock += 120000;
    activityStream.push(": heartbeat\n\n"); await new Promise(resolve => setTimeout(resolve, 0));
    clock += 3000;
    activityStream.push(event(delta("暂停之后仍然完整")) + done);
    const activityResult = await activityReading;
    assert.equal(activityResult.raw, "暂停之前暂停之后仍然完整");
    assert.equal(activityResult.stats.maxByteGapMs, 120000);
    assert.ok(activities.length >= 3); assert.equal(activityResult.stats.abortSignalReceived, false);
    activityStream.close();
  } finally { Date.now = realNow; }
  const noDone = await core.read(response(event(delta("兼容没有DONE但自然结束")) + event({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })));
  assert.equal(noDone.raw, "兼容没有DONE但自然结束"); assert.equal(noDone.partial, false); assert.equal(noDone.stats.completionSignal, "eof_after_finish");
  // Provider ignores stream:true and sends a whole JSON envelope, then keeps
  // HTTP open. Balanced-container detection must not wait for body EOF either.
  const jsonSocket = controlled("application/json"), jsonSocketReading = core.read(jsonSocket.response);
  jsonSocket.push('{"choices":[{"message":{"content":"正文里有 } 和 [，以及 \\"引号\\"，不能误判结束。"},"finish_reason":"stop"}]}');
  const jsonFinished = await Promise.race([jsonSocketReading, new Promise((_, reject) => setTimeout(() => reject(new Error("full JSON envelope must not wait for EOF")), 1000))]);
  assert.equal(jsonFinished.raw, '正文里有 } 和 [，以及 "引号"，不能误判结束。');
  assert.equal(jsonFinished.partial, false); assert.equal(jsonFinished.stats.streamed, false);
  jsonSocket.close();

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
  const upstream = { error: { message: "An internal error has occurred. Please retry or report in https://developers.generativeai.google/guide/troubleshooting", type: "upstream_error", param: "", code: 500 } };
  const upstreamWire = 'data: ' + JSON.stringify(upstream) + 'data: [DONE]';
  for (const ending of [event(upstream) + done, upstreamWire, upstreamWire.slice(0, -2), 'data: ' + JSON.stringify(upstream) + '\ndata: [DONE]\n']) {
    const failed = await core.read(response(event(delta(sample)) + ending, [1, 3, 17]));
    assert.equal(failed.raw, sample, "an upstream error must not enter the novel body");
    assert.equal(failed.partial, true, "DONE cannot turn an upstream failure into success");
    assert.deepEqual(failed.providerError, { message: upstream.error.message, type: "upstream_error", code: 500 });
    assert.equal(failed.stats.completionSignal, "provider_error"); assert.equal(failed.stats.malformedEvents, 0);
    assert.equal(failed.stats.readerCancelled, false, "an explicit provider failure is allowed to finish its transport gracefully");
    assert.deepEqual(failed.unparsedEvents, []); assert.match(failed.error, /上游服务.*500/);
  }
  await assert.rejects(() => core.read(response(upstreamWire)), error => error.providerError?.code === 500 && error.stats.completionSignal === "provider_error");
  const joined = 'data: ' + JSON.stringify(delta('字面量 data: [DONE] 和 {括号} 保留')) + 'data: ' + JSON.stringify(delta('后续正文')) + 'data: [DONE]';
  assert.equal((await core.read(response(joined, [1]))).raw, '字面量 data: [DONE] 和 {括号} 保留后续正文');
  await assert.rejects(() => core.read(response('{"error":{"message":"API unavailable"}}', [3], "application/json")), /API unavailable/);
  const malformedTail = await core.read(response(event(delta(sample)) + 'data: {"choices":[\n\n' + done));
  assert.equal(malformedTail.raw, sample); assert.equal(malformedTail.partial, true);
  assert.equal(malformedTail.stats.malformedEvents, 1); assert.deepEqual(malformedTail.unparsedEvents, ['{"choices":[']);
  const midPacket = controlled(), midReading = core.read(midPacket.response);
  midPacket.push(event(delta(sample))); await new Promise((resolve) => setTimeout(resolve, 0));
  midPacket.push('data: {"choices":[{"delta":{"content":"后续实际收到的半包'); await new Promise((resolve) => setTimeout(resolve, 0));
  midPacket.fail(new Error("network error")); const midResult = await midReading;
  assert.equal(midResult.raw, sample + "后续实际收到的半包"); assert.equal(midResult.partial, true); assert.match(midResult.unparsedEvents.join(""), /后续实际收到的半包/);
  assert.equal(midResult.stats.recoveredChars, "后续实际收到的半包".length);
  async function cutPacket(wire) {
    const source = controlled(), pending = core.read(source.response);
    source.push(wire); await new Promise(resolve => setTimeout(resolve, 0)); source.fail(new Error("network error"));
    return pending;
  }
  const wholePacket = await cutPacket(event(delta("开头")) + 'data: ' + JSON.stringify(delta("完整收到但缺少空行的尾段")));
  assert.equal(wholePacket.raw, "开头完整收到但缺少空行的尾段"); assert.equal(wholePacket.partial, true);
  const erroredPending = await cutPacket(event(delta(sample)) + upstreamWire);
  assert.equal(erroredPending.providerError.code, 500); assert.equal(erroredPending.stats.completionSignal, "provider_error");
  assert.equal(erroredPending.stats.transportErrorAlongsideProviderError, "network error"); assert.equal(erroredPending.stats.malformedEvents, 0);
  const partialJson = await cutPacket('{"choices":[{"index":0,"message":{"content":"实际收到\\n中文\\u4e2d\\uD83D\\uDE42\\u12');
  assert.equal(partialJson.raw, "实际收到\n中文中🙂"); assert.equal(partialJson.partial, true); assert.equal(partialJson.stats.recoveredEvents, 1);
  await assert.rejects(() => cutPacket('data: {"choices":[{"index":0,"delta":{"reasoning_content":"PRIVATE_REASONING'), error => error.partialRaw === "");
  await assert.rejects(() => cutPacket('data: {"candidates":[{"content":{"parts":[{"text":"MAY_BE_THOUGHT","thought":true'), error => error.partialRaw === "");
  const reasoningOnly = await core.read(response(event({ choices: [{ index: 0, delta: { reasoning_content: secret } }] }) + event({ choices: [], usage: { completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 5 } } }) + done));
  assert.equal(reasoningOnly.raw, ""); assert.ok(reasoningOnly.stats.reasoningSeen); assert.equal(reasoningOnly.stats.firstTextMs, null);
  assert.equal((await core.read(response(event(delta(sample)) + done), { onProgress() { throw new Error("UI observer failure"); } })).raw, sample, "a preview error cannot discard the paid response");
  const long = "完整正文，包含\"引号\"与{括号}。".repeat(12000);
  assert.equal((await core.read(response(event(delta(long)) + done, [1200, 3600, 7000]))).raw, long, "no local sentence, character or token cutoff");
  // Reproduce the repeated-use leak: each completed server response keeps HTTP
  // open. Only one short-lived completed reader may remain, rather than eight.
  let heldOpen = 0, heldCancelled = 0;
  for (let i = 0; i < 8; i++) {
    const held = new Response(new ReadableStream({
      start(controller) { heldOpen++; controller.enqueue(encode(event(delta("完整正文" + i)) + done)); },
      cancel() { heldOpen--; heldCancelled++; }
    }));
    const completed = await core.read(held);
    assert.equal(completed.raw, "完整正文" + i); assert.equal(completed.partial, false);
    assert.equal(heldOpen, 1, "prior completed connections must not accumulate between generations");
  }
  assert.equal(heldCancelled, 7);
  core.releaseCompleted(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(heldOpen, 0);
  // Even when the user does not generate again, a completed, non-closing
  // transport is eventually released. This never sets an active output limit.
  let graceCancelled = false;
  const grace = new Response(new ReadableStream({
    start(controller) { controller.enqueue(encode(event(delta("完成后才清理")) + done)); },
    cancel() { graceCancelled = true; }
  }));
  assert.equal((await core.read(grace)).raw, "完成后才清理");
  await new Promise(resolve => setTimeout(resolve, 5200));
  assert.equal(graceCancelled, true); assert.equal(core.releaseCompleted(), 0);
  console.log("PASS: immediate visible streamed prose, arbitrary UTF8/CRLF/multiline SSE, OpenAI/Gemini/Anthropic/Responses deltas, snapshots, one-read JSON fallback, reasoning privacy, full-length output and partial/abort/error preservation");
})().catch((error) => { console.error(error); process.exitCode = 1; });
