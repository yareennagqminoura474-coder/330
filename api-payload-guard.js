// Keep photos in local chat history, but do not resend their full originals forever.
// This runs before script.js and only changes OpenAI-compatible chat POST bodies.
(() => {
  const originalFetch = window.fetch.bind(window);
  const MAX_REQUEST_CHARS = 2_800_000;
  const HISTORY_IMAGE_NOTE = "[历史图片已保存在聊天记录中，此次请求省略图片数据]";

  function isChatRequest(input, options) {
    if (String(options?.method || "GET").toUpperCase() !== "POST") return false;
    try {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      return /\/chat\/completions\/?$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("当前图片无法读取，请重新选择图片后再试"));
      image.src = dataUrl;
    });
  }

  async function compressImage(dataUrl) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法压缩当前图片，请重新选择较小的图片");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL("image/jpeg", 0.78);
    if (result.length > 900_000) {
      canvas.width = Math.max(1, Math.round(canvas.width * 0.7));
      canvas.height = Math.max(1, Math.round(canvas.height * 0.7));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      result = canvas.toDataURL("image/jpeg", 0.62);
    }
    return result;
  }

  async function compactChatBody(body) {
    if (body.length <= MAX_REQUEST_CHARS) return body;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return body;
    }
    if (!Array.isArray(payload.messages)) return body;

    const messages = payload.messages;
    const lastUserIndex = messages.findLastIndex((message) => message?.role === "user");
    const lastUserMessage = messages[lastUserIndex];
    for (let index = 0; index < messages.length; index++) {
      const content = messages[index]?.content;
      if (!Array.isArray(content)) continue;
      for (let partIndex = 0; partIndex < content.length; partIndex++) {
        const part = content[partIndex];
        const dataUrl = part?.image_url?.url;
        if (part?.type !== "image_url" || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) continue;
        if (index === lastUserIndex) {
          part.image_url.url = await compressImage(dataUrl);
        } else {
          content[partIndex] = { type: "text", text: HISTORY_IMAGE_NOTE };
        }
      }
    }

    let compacted = JSON.stringify(payload);
    // If text alone is still oversized, keep the system instructions and newest turns.
    while (compacted.length > MAX_REQUEST_CHARS && messages.length > 2) {
      const oldestHistoryIndex = messages.findIndex((message, index) => index > 0 && message !== lastUserMessage);
      if (oldestHistoryIndex < 0) break;
      messages.splice(oldestHistoryIndex, 1);
      compacted = JSON.stringify(payload);
    }
    if (compacted.length > MAX_REQUEST_CHARS) {
      throw new Error("发送给 API 的内容仍然过大；请缩短角色设定或本次输入后重试。聊天记录没有被删除");
    }
    return compacted;
  }

  window.fetch = async function ephoneGuardedFetch(input, options) {
    if (!isChatRequest(input, options) || typeof options?.body !== "string") {
      return originalFetch(input, options);
    }
    const compactedBody = await compactChatBody(options.body);
    return originalFetch(input, compactedBody === options.body ? options : { ...options, body: compactedBody });
  };
})();
