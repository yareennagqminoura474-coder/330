// Service Worker 文件 (sw.js) - 强力保活版

// 缓存版本号
const CACHE_VERSION = "v1.7.133"; // 版本号+1
const CACHE_NAME = `ephone-cache-${CACHE_VERSION}`;

const CORE_URLS_TO_CACHE = [
  "./api-stream-http.js?v=1.7.133",
  "./vendor/katex/katex.min.css?v=1.7.133",
  "./vendor/katex/katex.min.js?v=1.7.133",
  "./vendor/katex/mhchem.min.js?v=1.7.133",
  "./vendor/katex/auto-render.min.js?v=1.7.133",
  "./vendor/katex/fonts/KaTeX_AMS-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2",
  "./vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2",
  "./vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Main-Bold.woff2",
  "./vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2",
  "./vendor/katex/fonts/KaTeX_Main-Italic.woff2",
  "./vendor/katex/fonts/KaTeX_Main-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2",
  "./vendor/katex/fonts/KaTeX_Math-Italic.woff2",
  "./vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2",
  "./vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2",
  "./vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Script-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Size1-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Size2-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Size3-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Size4-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2",
  "./api-transport.js?v=1.7.133",
  "./image-api-core.js?v=1.7.133",
  "./image-api.js?v=1.7.133",
  "./chat-finance-rollback.js?v=1.7.133",
  "./chat-image-view.js?v=1.7.133",
  "./request-context.js?v=1.7.133",
  "./api-routing-core.js?v=1.7.133",
  "./life-market-core.js?v=1.7.133",
  "./player-identity.js?v=1.7.133",
  "./person-kind.js?v=1.7.133",
  "./story-expenses.js?v=1.7.133",
  "./character-wallet-core.js?v=1.7.133",
  "./finance-records-core.js?v=1.7.133",
  "./character-wallet.js?v=1.7.133",
  "./character-wallet.css?v=1.7.133",
  "./character-social-core.js?v=1.7.133",
  "./life-simulation-core.js?v=1.7.133",
  "./life-simulation.js?v=1.7.133",
  "./life-simulation.css?v=1.7.133",
  "./character-daily.js?v=1.7.133",
  "./character-social.js?v=1.7.133",
  "./character-social.css?v=1.7.133",
  "./market-orders.js?v=1.7.133",
  "./life-market.js?v=1.7.133",
  "./life-market.css?v=1.7.133",
  "./index.html",
  "./style.css?v=1.7.133",
  "./persona-spaces.js?v=1.7.133",
  "./group-context.js?v=1.7.133",
  "./novel-context.js?v=1.7.133",
  "./novel-chapters.js?v=1.7.133",
  "./novel-reading.js?v=1.7.133",
  "./novel-response.js?v=1.7.133",
  "./novel-presentation.js?v=1.7.133",
  "./novel-stream.js?v=1.7.133",
  "./novel-sources.js?v=1.7.133",
  "./spectator-money.js?v=1.7.133",
  "./space-wallet.js?v=1.7.133",
  "./chat-response.js?v=1.7.133",
  "./chat-rounds.js?v=1.7.133",
  "./ny-core.js?v=1.7.133",
  "./ny-features.js?v=1.7.133",
  "./ny-engine.js?v=1.7.133",
  "./ny-engine.css?v=1.7.133",
  "./script.js?v=1.7.133",
  "./api-payload-guard.js?v=1.7.133",
  "./narration-mode.js?v=1.7.133",
  "./time-machine.js?v=1.7.133",
  "./holiday-calendar.js?v=1.7.133",
];

const OPTIONAL_URLS_TO_CACHE = [
  "https://unpkg.com/dexie/dist/dexie.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://phoebeboo.github.io/mewoooo/pp.js",
  "https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/StreamSaver.min.js",
  "https://s3plus.meituan.net/opapisdk/op_ticket_885190757_1758510900942_qdqqd_djw0z2.jpeg",
  "https://s3plus.meituan.net/opapisdk/op_ticket_885190757_1756312261242_qdqqd_g0eriz.jpeg",
];

// Only this app's known static files belong in the offline cache. API requests
// must remain window-initiated: a worker cannot prompt for local-network access.
const STATIC_CACHE_URLS = new Set(
  [...CORE_URLS_TO_CACHE, ...OPTIONAL_URLS_TO_CACHE].map((url) =>
    new URL(url, self.registration.scope).href,
  ),
);

// --- 强力保活核心代码 Start ---
// 只要浏览器允许，这个 Interval 会一直运行，试图保持 SW 活跃
setInterval(() => {
  // 像看门狗一样，每20秒检查一次
  // 实际上什么都不做，只是为了保持 JS 线程活跃
  // 如果需要更强力的，可以尝试 self.registration.update(); 但那会消耗流量
  // console.log('SW Heartbeat: ❤️');
}, 20000);
// --- 强力保活核心代码 End ---

// 1. 安装事件
self.addEventListener("install", (event) => {
  console.log("Service Worker 正在安装 (保活增强版)...");
  // 强制跳过等待，立刻接管
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("缓存核心文件...");
      return cache.addAll(CORE_URLS_TO_CACHE).then(() =>
        Promise.allSettled(OPTIONAL_URLS_TO_CACHE.map((url) => cache.add(url))),
      );
    }),
  );
});

// 2. 激活事件
self.addEventListener("activate", (event) => {
  console.log("Service Worker 正在激活...");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName.startsWith("ephone-cache-") && cacheName !== CACHE_NAME) {
              console.log("删除旧缓存:", cacheName);
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(() => {
        console.log("Service Worker 准备就绪，开始接管页面！");
        // 关键：立即控制所有打开的客户端（Tab页）
        return self.clients.claim();
      }),
  );
});

// 3. 拦截网络请求
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  // Never read/cache authenticated requests, even if an API happens to use a
  // URL that looks like a static asset. No API credentials enter Cache Storage.
  if (["authorization", "proxy-authorization", "x-api-key", "x-goog-api-key"].some((name) => request.headers.has(name))) return;

  // 如果是心跳 Ping 请求（虚拟地址），直接返回 200 OK，不走网络
  // 这是配合 script.js 里的保活 fetch 使用的
  if (url.origin === self.location.origin && url.pathname === "/_keep_alive_ping_") {
    event.respondWith(new Response("pong"));
    return;
  }

  if (request.mode === "navigate" && url.origin === self.location.origin && url.href.startsWith(self.registration.scope)) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./index.html")),
    );
    return;
  }

  // Do not call respondWith or fetch for local/external API routes. This is
  // intentionally an allowlist rather than guessing which URLs are APIs.
  if (!STATIC_CACHE_URLS.has(url.href)) return;

  event.respondWith(
    caches.match(request).catch(() => null).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request);
    }),
  );
});

// 4. 监听消息（配合主线程心跳）
self.addEventListener("message", (event) => {
  if (event.data === "ping") {
    // console.log('SW: 收到主线程 Ping，我还活着');
    // 可以选择回复，也可以不回复，接收到消息本身就会重置 SW 的休眠倒计时
  }
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url.includes("index.html") && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow("./index.html");
        }
      }),
  );
});
