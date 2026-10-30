// Browser HTTP reception for long text generations. One XHR = one API request.
// Preserve progress bytes before XHR's network-error steps clear responseText.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EPhoneStreamHTTP = api;
})(typeof window === "undefined" ? globalThis : window, function (root) {
  "use strict";
  function canUse(input, options = {}) {
    if (typeof root.XMLHttpRequest !== "function" || typeof root.ReadableStream !== "function" || typeof root.Response !== "function") return false;
    if (typeof input !== "string" && !(input instanceof URL)) return false;
    if (options.redirect && options.redirect !== "follow" || options.targetAddressSpace || options.mode === "no-cors") return false;
    if (String(options.method || "GET").toUpperCase() !== "POST" || options.body != null && typeof options.body !== "string") return false;
    try {
      const url = new URL(input, root.location?.href);
      // Keep the existing window-fetch permission path for local/Termux APIs.
      if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") || /(?:\.localhost|\.local|\.internal)$|^\d+(?:\.\d+){3}$/i.test(url.hostname)) return false;
      if (options.credentials === "omit" && url.origin === root.location?.origin) return false;
      return true;
    } catch { return false; }
  }
  function request(input, options = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new root.XMLHttpRequest(), encoder = new TextEncoder();
      let resolved = false, finished = false, cancelled = false, cursor = 0;
      let chunks = [], nextChunk = 0, pulling = false, controller, ending;
      const abortError = () => Object.assign(new Error("生成已停止"), { name: "AbortError" });
      function fail(error) { try { error.ephoneTransport = "browser xhr"; } catch {} reject(error); }
      function deliver() {
        if (!pulling || !controller || cancelled) return;
        if (nextChunk < chunks.length) {
          pulling = false; controller.enqueue(chunks[nextChunk++]);
          if (nextChunk === chunks.length) { chunks = []; nextChunk = 0; }
        } else if (ending) {
          pulling = false;
          if (ending instanceof Error) controller.error(ending); else controller.close();
        }
      }
      function available(final = false) {
        let value;
        try { value = xhr.responseText; } catch { return; }
        if (typeof value !== "string" || value.length <= cursor) return;
        let end = value.length;
        if (!final && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
        if (end > cursor) { chunks.push(encoder.encode(value.slice(cursor, end))); cursor = end; deliver(); }
      }
      function detach() {
        xhr.onreadystatechange = xhr.onprogress = xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
        options.signal?.removeEventListener("abort", stop);
      }
      function headers() {
        if (resolved || cancelled || !xhr.status) return;
        const responseHeaders = new Headers();
        for (const line of (xhr.getAllResponseHeaders() || "").split(/\r?\n/)) {
          const colon = line.indexOf(":");
          if (colon > 0) responseHeaders.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
        }
        const noBody = [204, 205, 304].includes(xhr.status);
        const body = noBody ? null : new root.ReadableStream({
          start(value) { controller = value; },
          pull() { pulling = true; deliver(); },
          cancel() {
            cancelled = true; chunks = []; ending = null; detach();
            if (!finished) { finished = true; xhr.abort(); }
          }
        });
        const response = new root.Response(body, { status: xhr.status, statusText: xhr.statusText, headers: responseHeaders });
        Object.defineProperty(response, "ephoneTransport", { value: "browser xhr" });
        Object.defineProperty(response, "url", { value: xhr.responseURL || String(input) });
        resolved = true; resolve(response);
      }
      function finish(error) {
        if (finished || cancelled) return;
        // On network error responseText may already be empty. Progress events
        // have copied the arrived bytes; do not error a stream with queued data,
        // because ReadableStream.error() would discard that queue immediately.
        available(!error); headers(); finished = true; detach();
        ending = error || "eof";
        if (!resolved) fail(error || new TypeError("API 未返回可读取的 HTTP 响应"));
        else deliver();
      }
      function stop() {
        if (finished || cancelled) return;
        const error = abortError(); finish(error); xhr.abort();
      }
      try {
        options.signal?.throwIfAborted();
        xhr.open(options.method || "POST", String(input), true);
        xhr.responseType = "text"; xhr.timeout = 0;
        xhr.withCredentials = options.credentials === "include";
        for (const [key, value] of new Headers(options.headers || {})) xhr.setRequestHeader(key, value);
        xhr.onreadystatechange = () => { if (xhr.readyState >= 2) headers(); if (xhr.readyState === 3) available(); };
        xhr.onprogress = () => { headers(); available(); };
        xhr.onload = () => finish();
        xhr.onerror = () => finish(new TypeError("network error"));
        xhr.onabort = () => finish(abortError());
        xhr.ontimeout = () => finish(new TypeError("API 连接超时"));
        options.signal?.addEventListener("abort", stop, { once: true });
        if (options.signal?.aborted) stop(); else xhr.send(options.body ?? null);
      } catch (error) { finished = true; detach(); fail(error); }
    });
  }
  return Object.freeze({ canUse, request });
});
