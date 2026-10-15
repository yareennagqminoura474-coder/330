// Owner-authenticated, opt-in relay. No API keys in server settings or logs.
const OWNER_ORIGIN = "https://yareennagqminoura474-coder.github.io";
const UPSTREAM_HEADERS = ["accept", "authorization", "content-type", "x-api-key", "x-goog-api-key", "anthropic-version"];
const REQUEST_HEADERS = [...UPSTREAM_HEADERS, "x-ephone-target", "x-ephone-relay-token"];
function cors() { return { "Access-Control-Allow-Origin": OWNER_ORIGIN, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": REQUEST_HEADERS.join(", "), "Access-Control-Max-Age": "3600", "Cache-Control": "no-store", Vary: "Origin" }; }
function failure(status, message) { return Response.json({ error: { message } }, { status, headers: cors() }); }
async function authorised(provided, expected) {
  const encoder = new TextEncoder();
  const hashes = await Promise.all([provided, expected].map((value) => crypto.subtle.digest("SHA-256", encoder.encode(value))));
  return crypto.subtle.timingSafeEqual(hashes[0], hashes[1]);
}
function validateTarget(value, method) {
  let url; try { url = new URL(value); } catch { throw new Error("无效的目标 API 地址。"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.hash || !host.includes(".") || host.startsWith("[") || /^\d+(?:\.\d+){3}$/.test(host) || /\.(?:localhost|local|internal|invalid|test|onion)$/.test(host) || host.endsWith(".workers.dev")) throw new Error("中转仅允许公网 HTTPS API 域名；本地、内网及中转自身地址不可中转。");
  const valid = method === "GET" ? /\/models\/?$/i.test(url.pathname) : method === "POST" && /\/(?:chat\/completions|images\/generations|models\/[^/]+:(?:generateContent|streamGenerateContent))\/?$/i.test(url.pathname);
  if (!valid) throw new Error("中转仅支持模型列表、聊天回复和生图接口。");
  for (const key of ["key", "api_key", "apikey", "api-key"]) if (url.searchParams.has(key)) throw new Error("请通过请求头发送 API 密钥，不要放在网址中。");
  return url;
}
export default {
  async fetch(request, env) {
    // Origin is additional restriction, not authentication; token is mandatory.
    if (request.headers.get("Origin") !== OWNER_ORIGIN) return new Response("Forbidden", { status: 403 });
    const url = new URL(request.url), check = url.pathname === "/device/check", legacy = /^\/([a-f0-9]{64})(\/v1\/(?:models|chat\/completions))$/i.exec(url.pathname);
    if (url.pathname !== "/relay" && !legacy && !check) return failure(404, "中转接口不存在。");
    if (request.method === "OPTIONS") {
      const method = request.headers.get("Access-Control-Request-Method"), headers = (request.headers.get("Access-Control-Request-Headers") || "").toLowerCase().split(",").map((v) => v.trim()).filter(Boolean);
      if (!(check ? method === "GET" : ["GET", "POST"].includes(method)) || headers.some((h) => !REQUEST_HEADERS.includes(h))) return failure(403, "不允许的预检请求。");
      return new Response(null, { status: 204, headers: cors() });
    }
    const expected = String(env.PROXY_TOKEN || "");
    if (!/^[a-f0-9]{64}$/i.test(expected)) return failure(503, "中转授权尚未配置。");
    const provided = legacy?.[1] || request.headers.get("X-EPhone-Relay-Token") || "";
    const device = String(env.DEVICE_TOKEN || ""), matches = await Promise.all([authorised(provided, expected), authorised(provided, device)]);
    if (!matches[0] && !(/^[a-f0-9]{64}$/i.test(device) && matches[1])) return failure(401, "中转授权码不正确；不是服务商 API Key，请检查中转设置。");
    if (check) return request.method === "GET" ? Response.json({ ok: true }, { headers: cors() }) : failure(405, "配置验证仅允许 GET。");
    let target;
    try { target = validateTarget(legacy ? "https://gcli.ggchan.dev" + legacy[2] + url.search : request.headers.get("X-EPhone-Target"), request.method); }
    catch (error) { return failure(400, error.message); }
    const headers = new Headers();
    for (const name of UPSTREAM_HEADERS) { const value = request.headers.get(name); if (value) headers.set(name, value); }
    if (!headers.has("authorization") && !headers.has("x-api-key") && !headers.has("x-goog-api-key")) return failure(401, "缺少服务商 API 密钥。");
    try {
      const upstream = await fetch(target.href, { method: request.method, headers, ...(request.method === "POST" ? { body: request.body } : {}), redirect: "manual", signal: request.signal });
      // Do not forward credentials to redirects or let browser follow them.
      if (upstream.status >= 300 && upstream.status < 400) { await upstream.body?.cancel(); return failure(502, "API 地址返回重定向。请填写服务商最终 API 地址；本次未跟随或补发。"); }
      const responseHeaders = new Headers(cors());
      for (const name of ["content-type", "retry-after", "x-request-id"]) { const value = upstream.headers.get(name); if (value) responseHeaders.set(name, value); }
      // Stream unchanged JSON/SSE/binary. No buffering, cache, cookies or retry.
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
    } catch { return failure(502, "中转暂时无法连接此 API 服务；本次没有改为直连或自动重发。"); }
  },
};
