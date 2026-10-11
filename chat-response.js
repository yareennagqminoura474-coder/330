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
    const choice = response?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content === "string") return content;
    const parts = Array.isArray(content) ? content : response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    return parts.filter((part) => part && part.thought !== true &&
      (!part.type || part.type === "text" || part.type === "output_text") &&
      typeof part.text === "string").map((part) => part.text).join("");
  }

  function finishReason(response) {
    return String(response?.choices?.[0]?.finish_reason || response?.candidates?.[0]?.finishReason || "").toUpperCase();
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

  const recoveryPrompt = "【本轮回复完整性修复】刚才接口返回的这一轮不完整、格式未闭合或只有时间开头，尚未发送任何内容。请重新生成本轮完整回复，不要接着残缺的 JSON 续写。输出一个合法、闭合的 JSON 数组；时间地点旁白之后必须有实际动作、剧情或台词。人设、历史和本轮当前时间不变，不重复历史，不再次推进时间。若输出空间不足，精简本轮铺陈，优先完整表达并闭合格式，不要只写开头。条数随情境，不设固定数量。";

  async function complete(request, { signal, parse, isRenderable } = {}) {
    let issue = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      signal?.throwIfAborted();
      let response;
      try { response = await request(attempt ? recoveryPrompt : ""); }
      catch (error) {
        signal?.throwIfAborted();
        // A broken HTTP JSON envelope is not a valid partial chat either.
        if (!(error instanceof SyntaxError)) throw error;
        issue = "接口响应数据未完整传输";
        continue;
      }
      signal?.throwIfAborted();
      assertNotBlocked(response);
      if (response?.error) throw new Error("API 返回错误：" + String(response.error.message || response.error));
      let raw = extractText(response);
      // Thinking models can exhaust their output budget before emitting ANY
      // visible parts. Preserve the finish reason and recover that empty batch.
      if (raw === null && (Array.isArray(response?.choices) || Array.isArray(response?.candidates))) raw = "";
      if (raw === null) throw new Error("API 没有返回可读取的回复内容，请检查所选模型。");
      const report = inspect(raw);
      const items = report.structured ? report.items : [{ type: "text", content: raw }];
      const parsed = !report.incomplete && parse ? parse(raw) : items;
      issue = /^(LENGTH|MAX_TOKENS)$/.test(finishReason(response)) ? "达到服务商输出长度上限" :
        report.incomplete ? "回复格式被截断或未闭合" :
        !raw.trim() || !hasBody(parsed, isRenderable) ? "回复为空或只有时间开头" : "";
      if (!issue) return { raw, items: parsed, response };
      // No history, wallet, or clock writes until a complete batch is accepted.
    }
    throw new Error("回复仍不完整（" + issue + "），已自动重试一次。本轮未发送，请稍后重试或检查服务商的模型输出上限。");
  }

  return { extractText, inspect, finishReason, isTimeHeader, hasBody, complete };
});
