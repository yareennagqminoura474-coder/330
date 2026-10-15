(function (root) {
  "use strict";
  const clean = (v) => typeof v === "string" ? v.trim() : "";
  const list = (v) => Array.isArray(v) ? v : [];
  const protocols = ["auto", "images", "chat", "gemini"];
  function config(value = {}) {
    return { baseUrl: clean(value.baseUrl), apiKey: clean(value.apiKey), model: clean(value.model),
      protocol: protocols.includes(value.protocol) ? value.protocol : "auto", size: clean(value.size), quality: clean(value.quality) };
  }
  function snapshot(preset) {
    return config(preset.config || { baseUrl: preset.proxyUrl, apiKey: preset.apiKey, model: preset.model });
  }
  function protocol(value) {
    const c = config(value);
    if (c.protocol !== "auto") return c.protocol;
    try { if (new URL(c.baseUrl).hostname === "generativelanguage.googleapis.com") return "gemini"; } catch { /* Validate separately. */ }
    return /gemini|nano[-_ ]?banana/i.test(c.model) ? "chat" : "images";
  }
  function endpoint(value, kind = "generate") {
    const c = config(value), native = protocol(c) === "gemini";
    let url; try { url = new URL(c.baseUrl); } catch { throw new Error("请填写完整的第三方生图 API 地址。"); }
    if (url.username || url.password || url.hash || !["https:", "http:"].includes(url.protocol)) throw new Error("生图 API 地址格式不正确，请把密钥填写在单独的密钥栏。");
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("生图 API 请使用 HTTPS 地址，避免密钥明文传输。");
    let path = url.pathname.replace(/\/+$/, "").replace(/\/(?:images\/generations|chat\/completions|models(?:\/[^/]+:generateContent)?)$/i, "");
    if (native) {
      path = path.replace(/\/v\d+(?:beta\d*)?$/i, "") + "/v1beta";
      url.pathname = path + (kind === "models" ? "/models" : "/models/" + encodeURIComponent(c.model.replace(/^models\//, "")) + ":generateContent");
    } else {
      if (!/\/v\d+(?:beta\d*)?$/i.test(path)) path += "/v1";
      url.pathname = path + (kind === "models" ? "/models" : protocol(c) === "chat" ? "/chat/completions" : "/images/generations");
    }
    // API keys belong in headers, never in a generated image URL or chat data.
    for (const key of ["key", "api_key", "apikey", "api-key"]) url.searchParams.delete(key);
    return url.href;
  }
  function validate(value, needModel = true) {
    const c = config(value); endpoint(c, "models");
    if (!c.apiKey) throw new Error("请先填写或从预设载入生图 API 密钥。");
    if (needModel && !c.model) throw new Error("请选择或填写支持生图的模型，普通文字模型不能生成图片。");
    return c;
  }
  function request(value, prompt) {
    const c = validate(value), text = clean(prompt); if (!text) throw new Error("这条消息没有可用的图片描述或提示词。");
    const format = protocol(c), headers = { "Content-Type": "application/json" };
    if (format === "gemini") headers["x-goog-api-key"] = c.apiKey; else headers.Authorization = "Bearer " + c.apiKey;
    let body;
    if (format === "gemini") body = { contents: [{ role: "user", parts: [{ text }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } };
    else if (format === "chat") body = { model: c.model, messages: [{ role: "user", content: "请生成一张图片，不要只返回文字描述：\n" + text }], stream: false };
    else body = { model: c.model, prompt: text, n: 1, ...(c.size && c.size !== "auto" ? { size: c.size } : {}), ...(c.quality && c.quality !== "auto" ? { quality: c.quality } : {}) };
    return { url: endpoint(c), options: { method: "POST", headers, body: JSON.stringify(body) }, format };
  }
  function safeImage(value) {
    const text = clean(value);
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(text)) return text;
    try { const url = new URL(text); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; }
  }
  function base64(data, mime = "image/png") {
    return /^(?:image\/(?:png|jpeg|webp|gif))$/i.test(mime) && typeof data === "string" && /^[A-Za-z0-9+/=\s]+$/.test(data) ? safeImage(`data:${mime};base64,${data.replace(/\s/g, "")}`) : "";
  }
  function extract(value) {
    const native = value?.candidates?.[0];
    for (const part of list(native?.content?.parts)) {
      if (part.thought === true) continue;
      const inline = part.inlineData || part.inline_data, found = base64(inline?.data, inline?.mimeType || inline?.mime_type);
      if (found) return found;
    }
    for (const item of list(value?.data)) {
      const found = base64(item?.b64_json) || safeImage(item?.url); if (found) return found;
    }
    const message = value?.choices?.[0]?.message;
    for (const item of [...list(message?.images), ...list(message?.content)]) {
      if (item?.thought === true) continue;
      const found = safeImage(item?.image_url?.url || item?.image_url || (item?.type === "image" ? item?.url : "")); if (found) return found;
    }
    const content = typeof message?.content === "string" ? message.content : list(message?.content).filter((p) => p?.type === "text" && !p.thought).map((p) => p.text || "").join("");
    for (const match of String(content || "").matchAll(/!\[[^\]]*\]\(\s*(<?(?:https?:\/\/|data:image\/)[^\s]+?>?)(?:\s+["'][^"']*["'])?\s*\)/g)) {
      const found = safeImage(match[1].replace(/^<|>$/g, "")); if (found) return found;
    }
    if (/^data:image\//i.test(content?.trim())) return safeImage(content);
    const blocked = value?.promptFeedback?.blockReason || native?.finishReason || value?.choices?.[0]?.finish_reason;
    if (/SAFETY|CONTENT_FILTER|BLOCKLIST|PROHIBITED|IMAGE_SAFETY/i.test(blocked || "")) throw new Error("生图服务拦截了本次请求，没有返回图片；不会自动重试。");
    throw new Error("接口没有返回真实图片（可能只返回了描述）。请核对生图模型与接口类型；本次不会换接口或自动重试。");
  }
  function redact(error, value = {}) {
    let message = String(error?.message || error || "未知错误"); const key = clean(value.apiKey);
    if (key) message = message.split(key).join("[密钥已隐藏]");
    message = message.replace(/data:image\/[^\s"']+/gi, "[图片数据]").replace(/(Bearer\s+)[^\s"']+/gi, "$1[已隐藏]");
    return message.slice(0, 350);
  }
  async function generate(value, prompt, transport, { signal } = {}) {
    const c = config(value), req = request(c, prompt); signal?.throwIfAborted();
    try {
      const response = await transport(req.url, { ...req.options, signal });
      if (!response.ok) { const body = await response.text(); let detail = ""; try { const json = JSON.parse(body); detail = json.error?.message || json.message || ""; } catch { detail = body.replace(/<[^>]*>/g, " ").slice(0, 160); } throw new Error(`生图 API 请求失败：${response.status}${detail ? " · " + detail : ""}`); }
      if (/^image\/(?:png|jpeg|webp|gif)/i.test(response.headers?.get("content-type") || "")) {
        const bytes = new Uint8Array(await response.arrayBuffer()); let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const image = base64(btoa(binary), response.headers.get("content-type").split(";")[0]);
        if (!image) throw new Error("生图接口返回了空图片数据，没有生成可显示的图片。");
        return image;
      }
      const data = await response.json(); signal?.throwIfAborted(); const image = extract(data);
      if (/^https?:/i.test(image) && c.apiKey && (image.includes(c.apiKey) || image.includes(encodeURIComponent(c.apiKey)))) throw new Error("服务商返回了包含 API 密钥的图片链接，已停止保存；请使用不暴露密钥的图片返回格式。");
      return image;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      throw new Error(redact(error, c));
    }
  }
  async function models(value, transport, { signal } = {}) {
    const c = validate(value, false), headers = protocol(c) === "gemini" ? { "x-goog-api-key": c.apiKey } : { Authorization: "Bearer " + c.apiKey };
    try {
      const response = await transport(endpoint(c, "models"), { headers, signal });
      if (!response.ok) throw new Error("拉取生图模型失败：HTTP " + response.status);
      const data = await response.json(), result = [...new Set([...list(data.data).map((m) => m.id), ...list(data.models).map((m) => m.name?.replace(/^models\//, ""))].filter((m) => typeof m === "string" && m.trim()))];
      if (!result.length) throw new Error("没有返回模型列表；可以直接手动填写服务商提供的生图模型名称。");
      return result;
    } catch (error) { throw new Error(redact(error, c)); }
  }
  const api = { config, snapshot, protocol, endpoint, validate, request, extract, safeImage, generate, models, redact }; root.ephoneImageApiCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
