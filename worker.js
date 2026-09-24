const UPSTREAM_ORIGIN = "https://gcli.ggchan.dev";
const ALLOWED_ORIGIN = "https://yareennagqminoura474-coder.github.io";
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "authorization",
  "content-type",
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function jsonResponse(status, message, origin) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(origin ? corsHeaders(origin) : { "Cache-Control": "no-store" }),
    },
  });
}

function getAllowedRoute(pathname, token) {
  const prefix = `/${token}`;
  if (!pathname.startsWith(`${prefix}/`)) return null;
  const route = pathname.slice(prefix.length);
  if (route === "/v1/models") return { path: route, method: "GET" };
  if (route === "/v1/chat/completions")
    return { path: route, method: "POST" };
  return null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (origin !== ALLOWED_ORIGIN)
      return jsonResponse(403, "This EPhone deployment is not allowed.");

    const token = String(env.PROXY_TOKEN || "");
    if (!/^[a-f0-9]{64}$/i.test(token))
      return jsonResponse(503, "Worker setup is incomplete.", origin);

    const url = new URL(request.url);
    const route = getAllowedRoute(url.pathname, token);
    if (!route) return jsonResponse(404, "Endpoint not found.", origin);

    if (request.method === "OPTIONS") {
      const requestedMethod = request.headers
        .get("Access-Control-Request-Method")
        ?.toUpperCase();
      const requestedHeaders = (
        request.headers.get("Access-Control-Request-Headers") || ""
      )
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);

      if (
        requestedMethod !== route.method ||
        requestedHeaders.some((header) => !ALLOWED_REQUEST_HEADERS.has(header))
      )
        return jsonResponse(403, "CORS preflight rejected.", origin);

      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== route.method)
      return jsonResponse(405, "Method not allowed.", origin);

    const upstreamHeaders = new Headers();
    for (const name of ALLOWED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) upstreamHeaders.set(name, value);
    }
    if (!upstreamHeaders.has("Authorization"))
      return jsonResponse(401, "Missing API authorization.", origin);

    const upstreamUrl = new URL(`${route.path}${url.search}`, UPSTREAM_ORIGIN);
    try {
      const upstream = await fetch(upstreamUrl, {
        method: route.method,
        headers: upstreamHeaders,
        ...(route.method === "POST" ? { body: request.body } : {}),
        redirect: "manual",
      });
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete("Set-Cookie");
      for (const [name, value] of Object.entries(corsHeaders(origin)))
        responseHeaders.set(name, value);
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch {
      return jsonResponse(502, "Could not reach the configured API host.", origin);
    }
  },
};
