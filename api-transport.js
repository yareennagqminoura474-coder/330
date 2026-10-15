// Explicit, address-scoped transport. Never fall back or retry a paid request.
(function (root) {
  "use strict";
  const relayOrigin = "https://ephone-gcli-proxy.yareennagqminoura474.workers.dev";
  const nativeFetch = root.fetch.bind(root);
  let adapter, row = { id: "api-transport", routes: {}, token: "" }, queue = Promise.resolve();
  const fields = [["primary-transport", "proxy-url"], ["secondary-transport", "secondary-proxy-url"], ["image-api-transport", "image-api-baseUrl"]];
  const el = (id) => document.getElementById(id);
  function local(url) {
    const host = url.hostname.toLowerCase();
    return !host.includes(".") || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.startsWith("[") || /^\d+(?:\.\d+){3}$/.test(host);
  }
  function base(value) {
    try {
      const u = new URL(value || "https://api.openai.com");
      if (local(u) || u.origin === relayOrigin) return "";
      return u.origin + u.pathname.replace(/\/+$/, "").replace(/\/(?:chat\/completions|images\/generations|models(?:\/[^/]+:(?:generateContent|streamGenerateContent))?)$/i, "").replace(/\/v\d+(?:beta\d*)?$/i, "");
    } catch { return ""; }
  }
  function isApi(url, method) {
    return method === "GET" ? /\/models\/?$/i.test(url.pathname) : method === "POST" && /\/(?:chat\/completions|images\/generations|models\/[^/]+:(?:generateContent|streamGenerateContent))\/?$/i.test(url.pathname);
  }
  function render() {
    for (const [id, input] of fields) {
      const key = base(el(input)?.value); if (!el(id)) continue;
      el(id).disabled = !key; el(id).value = key && row.routes[key] === "relay" ? "relay" : "direct";
    }
    if (el("api-relay-token") && document.activeElement !== el("api-relay-token")) el("api-relay-token").value = row.token || "";
  }
  function save(transform) {
    const operation = queue.catch(() => {}).then(async () => {
      const table = adapter.db.globalSettings;
      const next = await table.db.transaction("rw", table, async () => {
        const previous = { id: "api-transport", routes: {}, token: "", ...await table.get("api-transport") };
        const next = transform(previous); await table.put(next); return next;
      });
      row = next; render(); el("api-transport-status").textContent = "连接方式已保存。同一 API 地址共用此选择；其他地址不受影响。";
    });
    queue = operation; return operation;
  }
  async function init(value) {
    adapter = value;
    const table = adapter.db.globalSettings;
    // Backups use the historical singleton main settings layout.
    await table.db.transaction("rw", table, async () => {
      const main = await table.get("main");
      if (main?.ephoneApiTransportSettings) { await table.put({ ...main.ephoneApiTransportSettings, id: "api-transport" }); delete main.ephoneApiTransportSettings; await table.put(main); }
    });
    if (adapter.settings()) delete adapter.settings().ephoneApiTransportSettings;
    row = { ...row, ...await table.get("api-transport") }; row.routes ||= {};
    // Recover only the old owner-issued relay credential, never an API key.
    if (!row.token) {
      const image = await table.get("image-api");
      const old = [...await adapter.db.apiPresets.toArray(), await adapter.db.apiConfig.get("main"), image, ...image?.presets || []];
      for (const item of old) for (const address of [item?.proxyUrl, item?.secondaryProxyUrl, item?.config?.baseUrl]) {
        try { const u = new URL(address); const token = u.pathname.split("/")[1]; if (u.origin === relayOrigin && /^[a-f0-9]{64}$/i.test(token)) { await save((latest) => ({ ...latest, token })); break; } } catch {}
      }
    }
    render();
    const report = (error) => { render(); el("api-transport-status").textContent = "连接方式未保存，请重试。"; };
    for (const [id, input] of fields) {
      el(input).addEventListener("input", render); el(input).addEventListener("change", render);
      el(id).addEventListener("change", () => {
        const key = base(el(input).value), mode = el(id).value;
        if (!key) { render(); return; }
        save((latest) => ({ ...latest, routes: { ...latest.routes, [key]: mode } })).catch(report);
      });
    }
    el("api-relay-token").addEventListener("input", () => {
      let token = el("api-relay-token").value.trim();
      try { const old = new URL(token); if (old.origin === relayOrigin) token = old.pathname.split("/")[1] || ""; } catch {}
      save((latest) => ({ ...latest, token })).catch(report);
    });
    // Existing settings renderers also assign URL values without DOM events.
    document.addEventListener("change", (event) => { if (/preset/.test(event.target.id || "")) queueMicrotask(render); });
    if (root.MutationObserver) new root.MutationObserver(render).observe(el("api-settings-screen"), { attributes: true, attributeFilter: ["class"] });
  }
  root.fetch = async function ephoneSelectedTransport(input, options = {}) {
    let url; try { url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href); } catch { return nativeFetch(input, options); }
    const method = String(options.method || input?.method || "GET").toUpperCase();
    if (!adapter || !isApi(url, method)) return nativeFetch(input, options);
    await queue; options.signal?.throwIfAborted();
    if (!base(url.href) || row.routes[base(url.href)] !== "relay") return nativeFetch(input, options);
    if (!/^[a-f0-9]{64}$/i.test(row.token || "")) throw new Error("已选择中转，但缺少中转授权码。请在 API 设置粘贴原中转完整链接或 64 位授权码；本次未直连或重发。");
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("中转只支持无嵌入凭据的 HTTPS API 地址。");
    const headers = new Headers(options.headers || input?.headers);
    if (url.hostname === "generativelanguage.googleapis.com" && url.searchParams.has("key")) { headers.set("x-goog-api-key", url.searchParams.get("key")); url.searchParams.delete("key"); }
    headers.set("X-EPhone-Target", url.href); headers.set("X-EPhone-Relay-Token", row.token);
    // Guard runs above this wrapper, so the final compacted body is forwarded.
    return nativeFetch(relayOrigin + "/relay", { ...options, method, headers, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  };
  root.ephoneApiTransport = { init, render, base, flush: () => queue, snapshot: () => structuredClone(row) };
})(window);
