(function (root) {
  "use strict";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const safeImage = (v) => typeof v === "string" && (/^https?:\/\//i.test(v) || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(v) || /^blob:/i.test(v)) ? v : "";
  const clean = (v) => typeof v === "string" ? v.trim() : "";
  function drawingText(message) {
    const explicit = clean(message.image_prompt);
    return { text: explicit || clean(message.description) || clean(message.content), fromDescription: !explicit || message.imagePromptSource === "description" };
  }
  function messageFields(action) {
    const prompt = drawingText(action), url = safeImage(action.imageUrl);
    return { type: "ai_image", content: clean(action.description) || clean(action.content), image_prompt: prompt.text,
      imagePromptSource: prompt.fromDescription ? "description" : "explicit", ...(url ? { imageUrl: url } : {}) };
  }
  function getPromptRule(settings = {}) {
    return settings.enableAiDrawing ? '\n# 图片字段完整性\n需要发送图片时，ai_image 必须同时提供非空 description（中文画面描述）和 image_prompt（与画面对应的具体英文绘图提示词，普通文本，不要 URL 编码）。群聊还需 name 本名。示例：{"type":"ai_image","description":"柜台上的一杯奶茶","image_prompt":"a cup of milk tea on a counter, product illustration"}。不要只返回描述、空白提示词或字段占位词；只描述这张图片的画面，不要把整段聊天、人设或 API 信息写进提示词。无需为了凑数额外发图片。\n' : "";
  }
  function source(message, settings = {}) {
    const existing = safeImage(message.imageUrl); if (existing) return { url: existing, reason: "已有图片附件" };
    if (!settings.enableAiDrawing) return { url: "", reason: "普通生图未开启；这是主聊天 API 生成的图片描述，不是真实图片。" };
    const drawing = drawingText(message);
    if (!drawing.text) return { url: "", reason: "本条没有有效的图片描述或绘图提示词，无法生成图片。" };
    let prompt = drawing.text;
    // Decode old URL-encoded explicit prompts once. Descriptions are plain text:
    // literal percentages and %20 in them must not be rewritten.
    if (!drawing.fromDescription) try { prompt = decodeURIComponent(prompt); } catch { /* Plain prompt. */ }
    if (prompt.toWellFormed) prompt = prompt.toWellFormed();
    return { url: "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt), fromDescription: drawing.fromDescription,
      reason: drawing.fromDescription ? "提示词缺失，已按这条图片描述尝试生图，不额外调用文字 API。" : "通用绘图服务提供图片，不使用主/副聊天 API 的密钥。" };
  }
  function render(message, settings) {
    const image = source(message, settings), description = String(message.content || message.description || "未提供图片描述");
    if (!image.url) return `<button type="button" class="ai-image-description-card" data-description="${esc(description)}" style="white-space:normal;text-align:left;padding:16px;border:0;border-radius:10px;background:var(--bg-secondary,#f5f5f5);color:inherit"><strong>图片描述 · 未生成图片</strong><small style="display:block;margin-top:8px">${esc(image.reason)}</small><span style="display:block;margin-top:8px">${esc(description.slice(0, 120))}</span></button>`;
    return `<figure class="ephone-chat-image" style="margin:0"><img src="${esc(image.url)}" class="ai-generated-image" alt="图片附件" data-description="${esc(description)}" style="max-width:100%"><figcaption style="font-size:12px;padding:5px">点击查看大图 · <button type="button" class="ai-image-description-card" data-description="${esc(description)}">查看描述</button>${image.fromDescription ? '<small style="display:block">已按图片描述补全提示词</small>' : ""}<span class="ephone-image-status"></span></figcaption></figure>`;
  }
  function open(img) {
    if (!img || img.dataset.imageFailed === "true") { root.alert?.("图片尚未加载成功；这不代表主或副聊天 API 失败。请检查绘图服务，或查看图片描述。"); return; }
    const doc = root.document, placeholder = doc.createElement("span"), overlay = doc.createElement("div"), close = doc.createElement("button"), caption = doc.createElement("p");
    placeholder.style.cssText = `display:block;width:${img.clientWidth}px;height:${img.clientHeight}px`; img.before(placeholder);
    overlay.id = "ephone-chat-image-preview"; overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-label", "图片预览"); overlay.setAttribute("aria-modal", "true"); overlay.tabIndex = -1;
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.94);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;overflow:auto;color:white";
    const oldStyle = img.getAttribute("style"), previouslyFocused = doc.activeElement;
    img.style.cssText = "max-width:100%;max-height:75vh;object-fit:contain";
    close.type = "button"; close.textContent = "关闭"; close.style.cssText = "position:absolute;right:20px;top:20px;padding:10px";
    caption.textContent = img.dataset.description || ""; caption.style.cssText = "max-width:90vw;overflow-wrap:anywhere";
    const dismiss = () => { placeholder.replaceWith(img); if (oldStyle == null) img.removeAttribute("style"); else img.setAttribute("style", oldStyle); overlay.remove(); previouslyFocused?.focus?.({ preventScroll: true }); };
    close.onclick = dismiss; overlay.onclick = (e) => { if (e.target === overlay) dismiss(); }; overlay.onkeydown = (e) => { if (e.key === "Escape") dismiss(); };
    // Move the already loaded image, not a new img/src: opening does not issue
    // another generation request, call a chat API, or alter stored chat data.
    overlay.append(close, img, caption); doc.body.append(overlay); close.focus();
  }
  const api = { source, render, open, messageFields, getPromptRule }; root.ephoneChatImages = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.document?.addEventListener("error", (e) => { const img = e.target; if (!img?.classList?.contains("ai-generated-image")) return; img.dataset.imageFailed = "true"; const status = img.closest("figure")?.querySelector(".ephone-image-status"); if (status) status.textContent = " · 绘图服务加载失败，未获得图片（仍可查看描述）"; }, true);
  root.document?.addEventListener("click", (e) => { const button = e.target.closest?.(".ai-image-description-card"); if (!button) return; e.stopPropagation(); root.alert?.("图片描述：\n" + (button.dataset.description || "未提供描述")); });
})(typeof window !== "undefined" ? window : globalThis);
