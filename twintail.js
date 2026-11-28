// 双马尾 v5.0.23，小手机接收适配。沿用原插件的 JSON 数组逐元素扫描及 90 秒静默提示。
(function (root) {
  "use strict";
  const storageKey = "ephone.twintail.v5";
  let settings = { enabled: true, chatStream: false };
  try { Object.assign(settings, JSON.parse(root.localStorage.getItem(storageKey))); } catch {}
  const active = new Set();
  let last = null, clock;

  // Parse at the end of each balanced object, even if the final array bracket
  // never arrives. Quoted brackets and escaped quotes may span network chunks.
  function arrayDecoder(accept, emit) {
    let buffer = "", cursor = 0, depth = 0, quoted = false, escaped = false;
    let state = "open", supported = false;
    return {
      get supported() { return supported; },
      get closed() { return state === "closed"; },
      get remainder() { return buffer.trim(); },
      feed(chunk) {
        buffer += chunk;
        while (cursor < buffer.length) {
          const char = buffer[cursor++];
          if (depth) {
            if (quoted) {
              if (escaped) escaped = false;
              else if (char === "\\") escaped = true;
              else if (char === '"') quoted = false;
            } else if (char === '"') quoted = true;
            else if (char === "{" || char === "[") depth++;
            else if ((char === "}" || char === "]") && --depth === 0) {
              let packet;
              try { packet = JSON.parse(buffer.slice(0, cursor)); } catch { return false; }
              if (!supported && !accept(packet)) return false;
              supported = true; state = "comma";
              buffer = buffer.slice(cursor); cursor = 0;
              emit(packet);
            }
          } else if (/\s/.test(char)) continue;
          else if (state === "open" && char === "[") state = "first";
          else if ((state === "comma" || state === "first") && char === "]") state = "closed";
          else if (state === "comma" && char === ",") state = "item";
          else if ((state === "item" || state === "first") && char === "{") {
            buffer = buffer.slice(cursor - 1); cursor = 1; depth = 1;
          } else return false;
        }
        if (!depth) { buffer = ""; cursor = 0; }
        return true;
      }
    };
  }

  function show() {
    const node = root.document?.getElementById("twintail-status");
    if (!node) return;
    const rows = [...active];
    if (last) rows.push(last);
    node.textContent = rows.map(run => {
      const quiet = Math.floor((Date.now() - run.activity) / 1000);
      const phase = !run.done && quiet >= 90 ? "已等待新数据 " + quiet + " 秒" : run.phase;
      return run.label + " · " + phase + " · 已收正文 " + run.raw.length.toLocaleString() + " 字符";
    }).join("\n") || "暂无接收记录";
    node.hidden = !rows.length;
    root.document.getElementById("twintail-view").hidden = !last?.raw;
  }
  async function read(response, options, label) {
    if (!settings.enabled) return root.EPhoneNovelStream.read(response, options);
    const run = { label, activity: Date.now(), phase: "等待正文", raw: "", done: false };
    active.add(run); show();
    clock ??= root.setInterval(show, 1000);
    try {
      const out = await root.EPhoneNovelStream.read(response, { ...options, arrayDecoder,
        onActivity(update) { run.activity = Date.now(); options.onActivity?.(update); },
        onProgress(update) {
          run.raw = update.raw; run.phase = update.raw ? "接收正文" : update.phase === "thinking" ? "收到思考，等待正文" : "等待正文";
          return options.onProgress?.(update);
        }
      });
      run.raw = out.raw; run.phase = out.aborted ? "已停止" : out.partial || out.error ? "返回未完整" : out.raw ? "接收结束" : "没有正文";
      return out;
    } catch (error) {
      run.phase = options.signal?.aborted ? "已停止" : "接收出错";
      throw error;
    } finally {
      run.done = true; active.delete(run); last = run;
      if (!active.size) { root.clearInterval(clock); clock = undefined; }
      show();
    }
  }
  function nativeUrl(url, streaming) {
    if (!streaming) return url;
    const target = new URL(url);
    target.pathname = target.pathname.replace(/:generateContent$/, ":streamGenerateContent");
    target.searchParams.set("alt", "sse");
    return target.href;
  }
  async function chat(response, signal, label, streaming) {
    if (!streaming && !(settings.enabled && /text\/event-stream/i.test(response.headers.get("content-type") || ""))) return response.json();
    const out = await read(response, { signal, waitForEOF: true, extractText: root.ephoneChatResponse.extractText }, label);
    signal?.throwIfAborted();
    if (out.providerError) throw new Error(out.error || out.providerError.message);
    const usage = out.usage;
    return { choices: [{ message: { content: out.raw }, finish_reason: out.finishReason }],
      usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, completion_tokens_details: { reasoning_tokens: usage.reasoningTokens } } };
  }
  function mount() {
    const doc = root.document;
    const enabled = doc.getElementById("twintail-enabled"), stream = doc.getElementById("twintail-chat");
    if (!enabled || !stream) return;
    const sync = () => { enabled.checked = !!settings.enabled; stream.checked = !!settings.chatStream; stream.disabled = !enabled.checked; };
    sync();
    for (const [element, field] of [[enabled, "enabled"], [stream, "chatStream"]]) element.onchange = () => {
      settings[field] = element.checked;
      try { root.localStorage.setItem(storageKey, JSON.stringify(settings)); } catch {}
      sync();
    };
    const dialog = doc.getElementById("twintail-dialog");
    doc.getElementById("twintail-view").onclick = () => {
      dialog.querySelector("textarea").value = last?.raw || ""; dialog.showModal();
    };
    dialog.querySelector("button").onclick = () => dialog.close();
    dialog.onclose = () => { dialog.querySelector("textarea").value = ""; };
    show();
  }
  root.EPhoneTwinTail = { arrayDecoder, read, chat, nativeUrl, get chatStream() { return !!(settings.enabled && settings.chatStream); } };
  if (root.document) mount();
})(typeof window === "undefined" ? globalThis : window);
