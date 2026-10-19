(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ephoneChatResponse = api;
})(typeof window === "undefined" ? null : window, function () {
  "use strict";

  // Only the first candidate is the chosen answer; other candidates are alternatives.
  // Thought/reasoning parts are not visible chat messages. Text parts may split JSON
  // anywhere (even inside a string), so never insert extra separators between them.
  function extractText(response) {
    const data = unwrap(response), choice = data?.choices?.[0];
    const visible = (content) => {
      if (typeof content === "string") return content;
      if (content && !Array.isArray(content) && typeof content === "object" && messageItems(content).length) return JSON.stringify(content);
      if (!Array.isArray(content)) return null;
      const parts = content.filter((part) => part && part.thought !== true && !hiddenTypes.has(part.type));
      if (parts.some((part) => typeof part.content === "string" || typeof part.message === "string" || typeof part.c === "string")) return JSON.stringify(parts);
      return parts.filter((part) =>
        (!part.type || part.type === "text" || part.type === "output_text") &&
        typeof part.text === "string").map((part) => part.text).join("");
    };
    const candidates = [choice?.message?.content, choice?.text, choice?.delta?.content,
      data?.candidates?.[0]?.content?.parts, data?.output_text,
      Array.isArray(data?.output) ? data.output.filter((item) => item.type === "message").flatMap((item) => item.content || []) : null,
      data?.content, data?.message?.content, choice?.message?.refusal];
    let found = false;
    for (const value of candidates) {
      const text = visible(value);
      if (text) return text;
      if (text !== null) found = true;
    }
    return found ? "" : null;
  }

  function unwrap(response) {
    return response?.data && (response.data.choices || response.data.candidates || response.data.output || response.data.output_text)
      ? response.data : response;
  }

  function finishReason(response) {
    const data = unwrap(response);
    return String(data?.choices?.[0]?.finish_reason || data?.candidates?.[0]?.finishReason || "").toUpperCase();
  }

  function assertNotBlocked(response) {
    const reason = finishReason(response);
    const blocked = response?.promptFeedback?.blockReason ||
      (/^(CONTENT_FILTER|SAFETY|RECITATION|BLOCKLIST|PROHIBITED_CONTENT|SPII|IMAGE_SAFETY)$/.test(reason) ? reason : "");
    if (blocked) throw new Error("API 未提供完整回复，服务商返回拦截原因：" + blocked);
    const refusal = response?.choices?.[0]?.message?.refusal;
    if (refusal) throw new Error("API 未提供回复：" + String(refusal));
  }

  function messageItems(value) {
    if (Array.isArray(value)) return value.flatMap(messageItems);
    if (!value || typeof value !== "object") return [];
    if (typeof value.type === "string" || typeof value.t === "string" || "content" in value || "message" in value || "c" in value ||
      "dialogue" in value || "description" in value) return [value];
    for (const key of ["messages", "replies"]) {
      if (Array.isArray(value[key])) return value[key].flatMap(messageItems);
    }
    return [];
  }

  // Scan complete JSON roots, not a flat-object regex: braces in strings, quotes,
  // nested transfer/quote data, multiple code fences and arrays must all survive.
  // An unfinished tail is reported, never silently presented as a successful batch.
  function inspect(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    const items = [];
    let structured = false, incomplete = false;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "[" && text[i] !== "{") continue;
      // Do not mistake natural dialogue such as [微笑] for JSON.
      const next = text.slice(i + 1).match(/^\s*(.)/s)?.[1];
      if (text[i] === "{" && next !== '"' && next !== "}") continue;
      if (text[i] === "[" && next && next !== "{" && next !== "[" && next !== "]") continue;
      structured = true;
      const start = i, stack = [];
      let quoted = false, escaped = false, closed = false;
      for (; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') quoted = false;
          continue;
        }
        if (char === '"') { quoted = true; continue; }
        if (char === "[" || char === "{") stack.push(char);
        else if (char === "]" || char === "}") {
          if (stack.pop() !== (char === "]" ? "[" : "{")) break;
          if (stack.length === 0) { closed = true; break; }
        }
      }
      if (!closed) { incomplete = true; break; }
      try { items.push(...messageItems(JSON.parse(text.slice(start, i + 1)))); }
      catch { incomplete = true; }
    }
    return { items, structured, incomplete };
  }

  function isTimeHeader(item) {
    const text = String(item?.content || item?.message || "").trim()
      .replace(/^旁白\s*[：:]\s*/, "").replace(/[\r\n]+/g, " ").replace(/[。.]$/, "");
    return text.length < 180 && /^(?:当前(?:虚拟)?时间[：:]?\s*)?\d{4}\s*(?:年|[-/])\s*\d{1,2}\s*(?:月|[-/])\s*\d{1,2}/.test(text) &&
      /(?:\d{1,2}[:：]\d{2}|\d{1,2}\s*(?:点|时)\s*\d{1,2}\s*分)/.test(text) &&
      !/[。！？!?\n]/.test(text);
  }

  function hasBody(items, isRenderable) {
    return items.some((item) => {
      if (!item || ["thought_chain", "update_thoughts", "update_status", "life_update", "relationship_event"].includes(item.type) || isTimeHeader(item) ||
        (isRenderable && !isRenderable(item))) return false;
      return [item.content, item.message, item.c, item.dialogue, item.description].some((value) =>
        typeof value === "string" ? value.trim().length > 0 : Array.isArray(value) && value.length > 0) ||
        ["transfer", "accept_transfer", "decline_transfer", "red_packet", "open_red_packet", "sticker", "ai_image", "voice_message", "quote_reply",
          "pat_user", "friend_request_response", "gift", "poll", "vote", "waimai_order", "waimai_response", "waimai_request",
          "video_call_request", "video_call_response", "group_call_request", "group_call_response", "gomoku_move",
          "market_order_share", "market_phone_check", "market_order_arrived", "cancel_market_order", "wallet_income", "wallet_expense"].includes(item.type);
    });
  }

  const hiddenTypes = new Set(["thought_chain", "update_thoughts", "update_status", "reasoning", "thinking"]);
  const textTypes = new Set(["text", "narration", "narrative", "state", "action", "act", "scene", "voice_message", "offline_text",
    "message", "dialogue", "speech", "reply", "output_text", "旁白", "动作", "描述"]);
  function normalizeItem(item) {
    const next = { ...item }, type = String(item.type || item.t || "text").trim();
    next.type = ["message", "dialogue", "speech", "reply", "output_text"].includes(type) ? "text" : type;
    if (!next.name && (item.n || item.senderName || item.speaker)) next.name = item.n || item.senderName || item.speaker;
    if (typeof next.content !== "string") {
      const text = [item.message, item.c, item.text,
        next.type !== "offline_text" && textTypes.has(next.type) ? item.dialogue ?? item.description : undefined,
      ].find((value) => typeof value === "string");
      if (text !== undefined) next.content = text;
    }
    return next;
  }

  // Decode only characters actually received, including an unfinished final
  // string. Do not invent a continuation or run a second generation request.
  function readString(text, start) {
    let value = "";
    for (let i = start + 1; i < text.length; i++) {
      const char = text[i];
      if (char === '"') return { value, end: i + 1, complete: true };
      if (char !== "\\") { value += char; continue; }
      const next = text[++i], escapes = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (next === undefined) { value += "\\"; break; }
      if (next === "u" && /^[a-f\d]{4}$/i.test(text.slice(i + 1, i + 5))) { value += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16)); i += 4; }
      else value += Object.hasOwn(escapes, next) ? escapes[next] : "\\" + next;
    }
    return { value, end: text.length, complete: false };
  }
  function readValue(text, start) {
    if (text[start] === '"') return readString(text, start);
    if (text[start] !== "{" && text[start] !== "[") {
      let end = start; while (end < text.length && !/[,\]}\s]/.test(text[end])) end++;
      return { end: Math.max(start + 1, end), complete: true };
    }
    const stack = [];
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (char === '"') { const string = readString(text, i); if (!string.complete) break; i = string.end - 1; }
      else if (char === "{" || char === "[") stack.push(char);
      else if (char === "}" || char === "]") {
        if (stack.pop() !== (char === "}" ? "{" : "[")) return { end: i + 1, complete: false };
        if (!stack.length) return { end: i + 1, complete: true };
      }
    }
    return { end: text.length, complete: false };
  }
  function recoverFragment(text) {
    try { return messageItems(JSON.parse(text)); } catch { /* Salvage complete messages and the received text tail locally. */ }
    if (text[0] === "[") {
      const items = []; let i = 1;
      while (i < text.length) {
        while (/[\s,]/.test(text[i] || "")) i++;
        if (i >= text.length || text[i] === "]") break;
        const token = readValue(text, i);
        if (text[i] === "{" || text[i] === "[") items.push(...recoverFragment(text.slice(i, token.end)));
        i = token.end;
      }
      return items;
    }
    if (text[0] !== "{") return [];
    const fields = {}, nested = []; let i = 1;
    while (i < text.length) {
      while (/[\s,]/.test(text[i] || "")) i++;
      if (text[i] !== '"') break;
      const key = readString(text, i); if (!key.complete) break;
      i = key.end; while (/\s/.test(text[i] || "")) i++;
      if (text[i++] !== ":") break;
      while (/\s/.test(text[i] || "")) i++;
      if (i >= text.length) break;
      const token = readValue(text, i);
      if (text[i] === '"') fields[key.value] = token.value;
      else if (["messages", "replies"].includes(key.value) && text[i] === "[") nested.push(...recoverFragment(text.slice(i, token.end)));
      i = token.end;
    }
    if (nested.length) return nested;
    const item = normalizeItem(fields), content = [item.content, fields.dialogue, fields.description].find((value) => typeof value === "string" && value.trim());
    // A half-written payment/order/tool instruction is not an executable event.
    if (!content || !textTypes.has(item.type)) return [];
    return [{ type: ["text", "voice_message"].includes(item.type) ? "text" : "narration", ...(item.name ? { name: item.name } : {}), content }];
  }
  function recover(raw) {
    const text = String(raw || ""), items = []; let cursor = 0;
    const plain = (value) => {
      const content = value.replace(/^\s*```(?:json)?\s*$/gm, "").trim();
      if (content && !/^[\s,\[\]{}]+$/.test(content)) items.push({ type: "text", content });
    };
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "{" && text[i] !== "[") continue;
      const next = text.slice(i + 1).match(/^\s*(.)/s)?.[1];
      if (text[i] === "{" && next !== '"' && next !== "}") continue;
      if (text[i] === "[" && next && !["{", "[", "]"].includes(next)) continue;
      plain(text.slice(cursor, i));
      const token = readValue(text, i), fragment = text.slice(i, token.end), recovered = recoverFragment(fragment);
      items.push(...recovered);
      if (!recovered.length && token.complete) {
        try { const value = JSON.parse(fragment); if (value && Object.keys(value).length) plain(fragment); }
        catch { plain(fragment); }
      }
      cursor = token.end; i = token.end - 1;
    }
    plain(text.slice(cursor));
    return items.map(normalizeItem).filter((item) => !hiddenTypes.has(item.type));
  }

  function emptyReplyError(response) {
    const data = unwrap(response), u = data?.usage || data?.usageMetadata || {}, tokens = u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount,
      reasoning = u.completion_tokens_details?.reasoning_tokens ?? u.output_tokens_details?.reasoning_tokens ?? u.thoughtsTokenCount;
    return new Error("API 返回的最终正文确实为空，没有可显示的回复。" +
      (tokens != null ? `接口记录输出 ${tokens} tokens` + (reasoning != null ? `，其中思考 ${reasoning} tokens` : "") + "；用量包含思考时，不代表已经返回聊天正文。" : "") +
      "本轮仅调用一次，未自动重试。");
  }

  async function complete(request, { signal, parse, isRenderable } = {}) {
    // One user-triggered reply is exactly one generation request. Never retry,
    // regenerate or use another API to repair a paid answer automatically.
    signal?.throwIfAborted();
    let response;
    try { response = await request(); }
    catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error("接口响应数据未完整传输。本轮仅调用一次，未自动重试；请检查服务商响应后再手动重试。");
    }
    signal?.throwIfAborted();
    if (response?.error) throw new Error("API 返回错误：" + String(response.error.message || response.error));
    const raw = extractText(response);
    if (!raw?.trim()) { assertNotBlocked(unwrap(response)); throw emptyReplyError(response); }
    const items = recover(raw);
    let parsed = parse ? parse(JSON.stringify(items)) : items;
    // Plain or unnamed group text still belongs on screen; display it as
    // narration rather than dropping it for missing speaker metadata.
    if (isRenderable) parsed = parsed.map((item) => !item.name && !isRenderable(item) && typeof item.content === "string"
      ? { ...item, type: "narration" } : item);
    if (!parsed.length) throw emptyReplyError(response);
    return { raw, items: parsed, response };
  }

  return { extractText, inspect, recover, finishReason, isTimeHeader, hasBody, complete };
});
