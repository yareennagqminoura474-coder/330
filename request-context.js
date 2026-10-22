(function (root) {
  "use strict";
  const labels = { base: "人设/记忆/系统规则", history: "本轮聊天消息", social: "关系与当天生活", life: "生活连续性/私有记忆", wallet: "角色资产", orders: "购物订单/购物车", money: "转账红包" };
  const headingCategory = (heading) => /人物关系网与独立生活/.test(heading) ? "social" : /生活连续性与信息差/.test(heading) ? "life" :
    /角色独立资产与实际收支/.test(heading) ? "wallet" : /本空间角色身份与订单记忆边界|购物车/.test(heading) ? "orders" :
    /转账和红包的实际状态|观看模式转账与红包/.test(heading) ? "money" : "base";
  // This is explicitly a character-based approximation, NOT a model tokenizer.
  const estimate = (chars) => Math.ceil(chars / 1.5);
  function inspect(payload) {
    if (typeof payload === "string") payload = JSON.parse(payload);
    const chars = Object.fromEntries(Object.keys(labels).map((k) => [k, 0])); let images = 0, messageCount = 0;
    function addText(value, system) {
      if (typeof value !== "string") return;
      if (!system) { chars.history += value.length; return; }
      const re = /^#{1,6}[^\r\n]*/gm; let category = "base", start = 0, match;
      while ((match = re.exec(value))) { chars[category] += match.index - start; category = headingCategory(match[0]); start = match.index; }
      chars[category] += value.length - start;
    }
    function parts(content, system) {
      if (typeof content === "string") return addText(content, system);
      for (const part of Array.isArray(content) ? content : []) {
        if (typeof part?.text === "string") addText(part.text, system);
        else if (part?.image_url || part?.inline_data || part?.inlineData || part?.file_data || part?.fileData) images++;
      }
    }
    if (Array.isArray(payload?.messages)) for (const m of payload.messages) { parts(m.content, m.role === "system" || m.role === "developer"); messageCount++; }
    else if (Array.isArray(payload?.contents)) {
      parts(payload.systemInstruction?.parts || payload.system_instruction?.parts, true);
      payload.contents.forEach((m, i) => { parts(m.parts, i === 0 && !payload.systemInstruction && !payload.system_instruction); messageCount++; });
    } else throw new Error("无法统计请求格式");
    const textChars = Object.values(chars).reduce((a, b) => a + b, 0);
    return { textChars, estimatedInputTokens: estimate(textChars), images, messageCount,
      categories: Object.entries(chars).filter(([, n]) => n > 0).map(([key, textChars]) => ({ key, textChars, estimatedTokens: estimate(textChars) })) };
  }
  function usage(raw) {
    const u = raw?.usage || raw?.usageMetadata || {}, number = (v) => Number.isFinite(v) && v >= 0 ? v : null;
    return { inputTokens: number(u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount),
      outputTokens: number(u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount),
      cachedInputTokens: number(u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? u.cachedContentTokenCount) };
  }
  function start(db, chatId, model, attempt = 1) {
    // Capture the concrete space table NOW, never resolve it after a space switch.
    const table = db.spaceProfiles, id = "context-usage:" + String(chatId);
    let record = null;
    const save = async () => { try { if (record) await table.put(record); } catch { /* Statistics must never block a reply. */ } };
    return {
      async sent(body) {
        try { record = { id, kind: "context-usage", model: String(model || ""), attempt, timestamp: Date.now(), ...inspect(body), inputTokens: null, outputTokens: null, cachedInputTokens: null }; await save(); }
        catch { /* Do not persist the body, credentials, messages or private text. */ }
      },
      async finish(raw) { if (record) { Object.assign(record, usage(raw)); await save(); } return raw; }
    };
  }
  async function render(db, chatId, isCurrent = () => true) {
    const doc = root.document, total = doc?.getElementById("request-context-total"), actual = doc?.getElementById("request-context-actual"), details = doc?.getElementById("request-context-details");
    if (!total || !actual || !details) return;
    try {
      const row = await db.spaceProfiles.get("context-usage:" + String(chatId)); if (!isCurrent()) return;
      if (!row) { total.textContent = "首次发送后显示"; actual.textContent = "暂无"; details.textContent = "下方基础资料估算不是完整请求总量。完整请求包含系统规则及附加资料；这里不调用 API 进行估算。"; return; }
      total.textContent = "约 " + row.estimatedInputTokens.toLocaleString() + " tokens";
      actual.textContent = row.inputTokens == null ? "接口未返回用量" : row.inputTokens.toLocaleString() + " tokens";
      details.textContent = "上次发送：" + new Date(row.timestamp).toLocaleString() + "；模型：" + row.model + "。\n" +
        row.categories.map((c) => (labels[c.key] || c.key) + "：约 " + c.estimatedTokens.toLocaleString()).join("；") +
        "。\n按完整请求文本统计，含系统规则；字符估算会因模型分词不同而有误差，以接口返回为准。" +
        (row.images ? "含 " + row.images + " 个图片/文件输入，其用量未计入文本估算。" : "") +
        (row.attempt > 1 ? "本轮发生补发，此处只显示最后一次请求；平台账单可能累计多次调用。" : "") +
        (row.cachedInputTokens != null ? "缓存输入 " + row.cachedInputTokens.toLocaleString() + " tokens（包含在输入总量中，不要再相加）。" : "") +
        (row.outputTokens != null ? "输出 " + row.outputTokens.toLocaleString() + " tokens（不属于上下文输入）。" : "");
    } catch { if (isCurrent()) { total.textContent = "暂时无法读取"; actual.textContent = "暂无"; details.textContent = "读取统计失败不会影响聊天或记忆。"; } }
  }
  const api = { inspect, usage, start, render, estimate };
  root.ephoneRequestContext = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
