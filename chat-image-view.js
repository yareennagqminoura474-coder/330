(function (root) {
  "use strict";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const safeImage = (v) => typeof v === "string" && (/^https?:\/\//i.test(v) || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(v) || /^blob:/i.test(v)) ? v : "";
  function source(message, settings = {}) {
    const existing = safeImage(message.imageUrl); if (existing) return { url: existing, reason: "已有图片附件" };
    if (!settings.enableAiDrawing) return { url: "", reason: "普通生图未开启；这是主聊天 API 生成的图片描述，不是真实图片。" };
    if (!message.image_prompt) return { url: "", reason: "本条没有绘图提示词，仅保存了文字描述，尚未生成图片。" };
    let prompt = String(message.image_prompt); try { prompt = decodeURIComponent(prompt); } catch { /* Plain prompt. */ }
    return { url: "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt), reason: "通用绘图服务提供图片，不使用主/副聊天 API 的密钥。" };
  }
  function render(message, settings) {
    const image = source(message, settings), description = String(message.content || message.description || "未提供图片描述");
    if (!image.url) return `<button type="button" class="ai-image-description-card" data-description="${esc(description)}" style="white-space:normal;text-align:left;padding:16px;border:0;border-radius:10px;background:var(--bg-secondary,#f5f5f5);color:inherit"><strong>图片描述 · 未生成图片</strong><small style="display:block;margin-top:8px">${esc(image.reason)}</small><span style="display:block;margin-top:8px">${esc(description.slice(0, 120))}</span></button>`;
    return `<figure class="ephone-chat-image" style="margin:0"><img src="${esc(image.url)}" class="ai-generated-image" alt="图片附件" data-description="${esc(description)}" style="max-width:100%"><figcaption style="font-size:12px;padding:5px">点击查看大图 · <button type="button" class="ai-image-description-card" data-description="${esc(description)}">查看描述</button><span class="ephone-image-status"></span></figcaption></figure>`;
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
  const api = { source, render, open }; root.ephoneChatImages = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.document?.addEventListener("error", (e) => { const img = e.target; if (!img?.classList?.contains("ai-generated-image")) return; img.dataset.imageFailed = "true"; const status = img.closest("figure")?.querySelector(".ephone-image-status"); if (status) status.textContent = " · 绘图服务加载失败，未获得图片（仍可查看描述）"; }, true);
  root.document?.addEventListener("click", (e) => { const button = e.target.closest?.(".ai-image-description-card"); if (!button) return; e.stopPropagation(); root.alert?.("图片描述：\n" + (button.dataset.description || "未提供描述")); });
})(typeof window !== "undefined" ? window : globalThis);
