(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EPhoneNovelStream = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  // One already-open response is consumed once. This module never fetches,
  // retries, changes models, evaluates output, or imposes a prose length limit.
  const text = (value) => typeof value === "string" ? value : "";
  const hidden = (part) => part?.thought === true || /^(thinking|reasoning|thought_chain|analysis|reasoning_text|reasoning_summary_text)$/.test(part?.type || "");
  const partsText = (parts) => typeof parts === "string" ? parts : Array.isArray(parts)
    ? parts.filter((part) => !hidden(part) && (!part?.type || ["text", "output_text", "text_delta"].includes(part.type))).map((part) => text(part.text ?? part.content)).join("") : "";
  const reasoning = (value) => Boolean(value?.reasoning_content || value?.reasoning || value?.thinking ||
    Array.isArray(value?.content) && value.content.some(hidden) || Array.isArray(value?.parts) && value.parts.some(hidden));
  const abortError = () => Object.assign(new Error("生成已停止"), { name: "AbortError" });
  const number = (value) => Number.isFinite(value) && value >= 0 ? value : null;
  function extract(payload, supplied) {
    const data = payload?.data && (payload.data.choices || payload.data.candidates || payload.data.output || payload.data.output_text) ? payload.data : payload;
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && (data.title || data.novel_title) && (typeof data.content === "string" || typeof data.body === "string")) return JSON.stringify(data);
    if (typeof supplied === "function") { const result = supplied(data); if (typeof result === "string") return result; }
    const choice = data?.choices?.find((item) => item.index === 0) || data?.choices?.[0];
    if (choice) return partsText(choice.message?.content ?? choice.delta?.content ?? choice.text);
    if (data?.candidates) return partsText((data.candidates.find((item) => item.index === 0) || data.candidates[0])?.content?.parts);
    if (typeof data?.output_text === "string") return data.output_text;
    if (Array.isArray(data?.output)) return data.output.filter((item) => item.type === "message").map((item) => partsText(item.content)).join("");
    if (Array.isArray(data?.content)) return partsText(data.content);
    if (data?.type === "message" || data?.message?.content != null) return partsText(data.content ?? data.message.content);
    // A provider may return the chapter object itself rather than an API
    // envelope. Keep its title/body/summary for the chapter parser.
    return data == null ? "" : JSON.stringify(data);
  }
  function usageFrom(payload, usage) {
    if (payload?.data && (payload.data.choices || payload.data.candidates || payload.data.output)) payload = payload.data;
    const value = payload?.usage || payload?.usageMetadata || payload?.message?.usage || payload?.response?.usage;
    if (!value) return;
    const entries = {
      inputTokens: value.prompt_tokens ?? value.input_tokens ?? value.promptTokenCount,
      outputTokens: value.completion_tokens ?? value.output_tokens ?? value.candidatesTokenCount,
      reasoningTokens: value.completion_tokens_details?.reasoning_tokens ?? value.output_tokens_details?.reasoning_tokens ?? value.thoughtsTokenCount,
      cachedInputTokens: value.prompt_tokens_details?.cached_tokens ?? value.input_tokens_details?.cached_tokens ?? value.cachedContentTokenCount ?? value.cache_read_input_tokens
    };
    for (const [key, candidate] of Object.entries(entries)) if (number(candidate) !== null) usage[key] = candidate;
  }
  function readChunk(reader, signal) {
    if (!signal) return reader.read();
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => { if (!settled) { settled = true; signal.removeEventListener("abort", stopped); fn(value); } };
      const stopped = () => { Promise.resolve(reader.cancel()).catch(() => {}); finish(reject, abortError()); };
      signal.addEventListener("abort", stopped, { once: true });
      reader.read().then((value) => finish(resolve, value), (error) => finish(reject, error));
      if (signal.aborted) stopped();
    });
  }
  async function read(response, { signal, onProgress, extractText } = {}) {
    const started = Date.now(), usage = { inputTokens: null, outputTokens: null, reasoningTokens: null, cachedInputTokens: null };
    const stats = { firstTextMs: null, receiveMs: 0, visibleChars: 0, eventCount: 0, bytesReceived: 0, malformedEvents: 0, reasoningSeen: false, streamed: false };
    const unparsedEvents = [];
    let raw = "", complete = false, ended = false, terminal = false, broken = false, aborted = false, failure = "", finishReason = "";
    const state = { blocks: new Map(), responseParts: new Map() };
    function snapshot() {
      const receiveMs = Date.now() - started, duration = stats.firstTextMs == null ? 0 : receiveMs - stats.firstTextMs;
      return { ...stats, receiveMs, visibleChars: raw.length, charactersPerSecond: duration > 0 ? raw.length * 1000 / duration : null };
    }
    function emit() {
      if (!onProgress) return;
      const progress = { raw, visibleChars: raw.length, phase: raw ? "writing" : stats.reasoningSeen ? "thinking" : "waiting", stats: snapshot() };
      try { Promise.resolve(onProgress(progress)).catch(() => {}); } catch { /* UI errors cannot discard received prose. */ }
    }
    function update(value, replace = false) {
      if (typeof value !== "string" || !value) return;
      if (replace && raw.startsWith(value)) return; // Ignore an older cumulative snapshot.
      const next = replace ? value : raw + value;
      if (next === raw) return;
      raw = next;
      if (stats.firstTextMs === null) stats.firstTextMs = Date.now() - started;
      emit();
    }
    function markFinish(reason) { if (typeof reason === "string" && reason) { finishReason = reason; complete = true; terminal = true; } }
    function providerError(data) {
      if (data?.error || data?.type === "error" || data?.type === "response.failed")
        throw new Error("API 返回错误：" + (text(data.error?.message || data.error || data.message || data.response?.error?.message) || "流式响应失败"));
    }
    function event(data, eventName = "") {
      stats.eventCount++;
      if (typeof data === "string") { update(data); return; }
      if (!data || typeof data !== "object") return;
      const value = data.data && (data.data.choices || data.data.candidates || data.data.output) ? data.data : data;
      if (eventName === "error") throw new Error("API 返回错误：" + (text(value.error?.message || value.message || value.error) || "流式响应失败"));
      providerError(value); usageFrom(value, usage);
      const previousReasoning = stats.reasoningSeen;
      if (usage.reasoningTokens > 0) stats.reasoningSeen = true;
      const type = value.type || eventName;
      if (/thinking|reasoning/.test(type || "")) stats.reasoningSeen = true;
      if (type === "content_block_start") {
        const block = value.content_block;
        if (hidden(block)) stats.reasoningSeen = true;
        else if (block?.type === "text") { state.blocks.set(value.index ?? 0, text(block.text)); update([...state.blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v).join(""), true); }
      } else if (type === "content_block_delta") {
        if (value.delta?.type === "thinking_delta" || value.delta?.type === "signature_delta") stats.reasoningSeen = true;
        else if (value.delta?.type === "text_delta") {
          const index = value.index ?? 0; state.blocks.set(index, (state.blocks.get(index) || "") + text(value.delta.text));
          update([...state.blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v).join(""), true);
        }
      } else if (type === "message_delta") markFinish(value.delta?.stop_reason);
      else if (type === "message_stop") { complete = true; terminal = true; }
      else if (type === "response.output_text.delta" || type === "response.output_text.done") {
        const key = String(value.output_index ?? 0) + ":" + String(value.content_index ?? 0);
        if (type.endsWith(".delta")) state.responseParts.set(key, (state.responseParts.get(key) || "") + text(value.delta));
        else if (typeof value.text === "string") state.responseParts.set(key, value.text);
        update([...state.responseParts.entries()].sort(([a], [b]) => { const x = a.split(":").map(Number), y = b.split(":").map(Number); return x[0] - y[0] || x[1] - y[1]; }).map(([, v]) => v).join(""), true);
      } else if (type === "response.completed" || type === "response.incomplete") {
        if (value.response) {
          usageFrom(value.response, usage);
          const body = value.response;
          if (typeof body.output_text === "string" || Array.isArray(body.output) || body.choices || body.candidates) {
            const content = extract(body, extractText); if (content) update(content, true);
          }
        }
        markFinish(type === "response.completed" ? "stop" : value.response?.incomplete_details?.reason || "incomplete");
      } else if (Array.isArray(value.choices)) {
        const choice = value.choices.find((item) => item.index === 0) || value.choices.find((item) => item.index == null);
        if (choice) {
          if (reasoning(choice.delta) || reasoning(choice.message)) stats.reasoningSeen = true;
          if (choice.delta) update(partsText(choice.delta.content));
          else if (choice.message) update(partsText(choice.message.content), true);
          else if (typeof choice.text === "string") update(choice.text);
          markFinish(choice.finish_reason);
        }
      } else if (Array.isArray(value.candidates)) {
        const candidate = value.candidates.find((item) => item.index === 0) || value.candidates.find((item) => item.index == null);
        if (candidate) {
          if (reasoning(candidate.content)) stats.reasoningSeen = true;
          update(partsText(candidate.content?.parts), value.cumulative === true || candidate.cumulative === true);
          markFinish(candidate.finishReason);
        }
      } else if (type === "message_start") {
        if (reasoning(value.message)) stats.reasoningSeen = true;
        if (value.message?.content?.length) update(partsText(value.message.content), true);
      } else if (typeof value.output_text === "string" || value.message?.content != null || type === "message") {
        update(extract(value, extractText), true);
      } else if (typeof value.delta?.text === "string") update(value.delta.text);
      if (previousReasoning !== stats.reasoningSeen && !raw) emit();
    }
    let lineBuffer = "", eventName = "", dataLines = [];
    function dispatch() {
      if (!dataLines.length) { eventName = ""; return; }
      const data = dataLines.join("\n"), name = eventName;
      dataLines = []; eventName = "";
      if (data.trim() === "[DONE]") { ended = true; complete = true; return; }
      try { event(JSON.parse(data), name); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        if (name === "error") throw new Error("API 流式响应返回错误：" + data);
        if (/^[\s]*[{\[]/.test(data)) { broken = true; stats.malformedEvents++; unparsedEvents.push(data); return; }
        if (!["ping", "heartbeat"].includes(name)) event(data, name);
      }
    }
    function line(value) {
      if (!value) { dispatch(); return; }
      if (value[0] === ":") return;
      const colon = value.indexOf(":"), field = colon < 0 ? value : value.slice(0, colon);
      let content = colon < 0 ? "" : value.slice(colon + 1); if (content[0] === " ") content = content.slice(1);
      if (field === "data") dataLines.push(content); else if (field === "event") eventName = content;
    }
    function feed(value, flush = false) {
      lineBuffer += value;
      let start = 0;
      for (let i = 0; i < lineBuffer.length; i++) {
        if (lineBuffer[i] !== "\r" && lineBuffer[i] !== "\n") continue;
        if (lineBuffer[i] === "\r" && i + 1 === lineBuffer.length && !flush) break;
        line(lineBuffer.slice(start, i));
        if (lineBuffer[i] === "\r" && lineBuffer[i + 1] === "\n") i++;
        start = i + 1; if (ended) break;
      }
      lineBuffer = ended ? "" : lineBuffer.slice(start);
      if (flush && !ended) { if (lineBuffer) line(lineBuffer); lineBuffer = ""; dispatch(); }
    }
    emit();
    const reader = response.body?.getReader?.(), decoder = new TextDecoder();
    // Some compatible endpoints ignore stream:true or mislabel a JSON body as
    // event-stream. Sniff the first actual field so neither case requires retry.
    let wire = "", mode = "unknown";
    const json = { at: 0, root: -1, stack: [], quote: false, escape: false, stopped: false };
    const envelope = (value) => Array.isArray(value) ? value.some(envelope) : !!(value && typeof value === "object" &&
      (Array.isArray(value.choices) || Array.isArray(value.candidates) || Array.isArray(value.output) || typeof value.output_text === "string" ||
        value.type === "message" && Array.isArray(value.content) || value.error || value.data && envelope(value.data)));
    function completeJson() {
      if (json.stopped) return false;
      for (; json.at < wire.length; json.at++) {
        const c = wire[json.at];
        if (json.root < 0) {
          if (/\s|\uFEFF/.test(c)) continue;
          if (c !== "{" && c !== "[") { json.stopped = true; return false; }
          json.root = json.at;
        }
        if (json.quote) {
          if (json.escape) json.escape = false;
          else if (c === "\\") json.escape = true;
          else if (c === '"') json.quote = false;
          continue;
        }
        if (c === '"') { json.quote = true; continue; }
        if (c === "{" || c === "[") json.stack.push(c);
        else if (c === "}" || c === "]") {
          if (json.stack.pop() !== (c === "}" ? "{" : "[")) { json.stopped = true; return false; }
          if (!json.stack.length) {
            json.stopped = true;
            try {
              const value = JSON.parse(wire.slice(json.root, json.at + 1));
              if (envelope(value)) { wire = wire.slice(json.root, json.at + 1); return true; }
            } catch {}
            return false;
          }
        }
      }
      return false;
    }
    try {
      if (reader) {
        while (!ended) {
          const chunk = await readChunk(reader, signal);
          if (chunk.done) break;
          stats.bytesReceived += chunk.value.byteLength;
          const decoded = decoder.decode(chunk.value, { stream: true });
          if (mode === "sse") { feed(decoded); if (terminal) ended = true; }
          else {
            wire += decoded;
            if (/^\s*(?:data:|event:|:|id:|retry:)/.test(wire)) { mode = "sse"; stats.streamed = true; feed(wire.replace(/^\uFEFF/, "")); wire = ""; }
            else if (completeJson()) ended = true;
            if (terminal) ended = true;
          }
        }
        const tail = decoder.decode();
        if (mode === "sse") feed(tail, true); else wire += tail;
      } else {
        if (signal?.aborted) throw abortError();
        wire = await response.text(); stats.bytesReceived = new TextEncoder().encode(wire).byteLength;
        if (/^\s*(?:data:|event:|:|id:|retry:)/.test(wire)) { mode = "sse"; stats.streamed = true; feed(wire.replace(/^\uFEFF/, ""), true); wire = ""; }
      }
      if (mode !== "sse") {
        let payload;
        try { payload = JSON.parse(wire); }
        catch { update(wire); broken = /^[\s]*[{\[]/.test(wire); complete = !broken; }
        if (payload !== undefined) {
          if (Array.isArray(payload) && payload.some((part) => part?.choices || part?.candidates)) payload.forEach((part) => event(part));
          else { providerError(payload); usageFrom(payload, usage); update(extract(payload, extractText), true); }
          const unwrapped = payload?.data || payload;
          if (reasoning(unwrapped) || unwrapped?.choices?.[0]?.message && reasoning(unwrapped.choices[0].message) || unwrapped?.candidates?.[0]?.content && reasoning(unwrapped.candidates[0].content)) stats.reasoningSeen = true;
          if (usage.reasoningTokens > 0) stats.reasoningSeen = true;
          markFinish(unwrapped?.choices?.[0]?.finish_reason || unwrapped?.candidates?.[0]?.finishReason || unwrapped?.stop_reason);
          complete = true;
        }
      }
    } catch (error) {
      const unfinished = mode === "sse"
        ? (dataLines.length || /(?:^|\n)data:/.test(lineBuffer) ? [...dataLines, lineBuffer].filter(Boolean).join("\n") : "")
        : /^API 返回错误：/.test(error.message || "") ? "" : wire;
      if (unfinished) { unparsedEvents.push(unfinished); stats.malformedEvents++; }
      aborted = signal?.aborted || error.name === "AbortError";
      broken = true; failure = aborted ? "生成已停止" : error.message || String(error);
      if (!raw && !aborted) { error.partialRaw = raw; error.unparsedEvents = unparsedEvents; error.stats = snapshot(); throw error; }
    } finally {
      if (reader) { if (ended || aborted) Promise.resolve(reader.cancel()).catch(() => {}); try { reader.releaseLock(); } catch {} }
    }
    stats.reasoningSeen ||= usage.reasoningTokens > 0;
    emit();
    return { raw, partial: broken || !complete || /^(?:length|max_tokens|max_output_tokens|incomplete|continuation)$/i.test(finishReason),
      aborted, finishReason, usage, unparsedEvents, stats: snapshot(), ...(failure ? { error: failure } : unparsedEvents.length ? { error: "收到" + unparsedEvents.length + "个格式异常的数据包，原始片段已保留，正文可能不完整。" } : {}) };
  }
  return Object.freeze({ read });
});
