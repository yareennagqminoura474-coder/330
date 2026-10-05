// Service Worker 文件 (sw.js) - 强力保活版

// 缓存版本号
const CACHE_VERSION = "v1.7.60"; // 版本号+1
const CACHE_NAME = `ephone-cache-${CACHE_VERSION}`;

const CORE_URLS_TO_CACHE = [
  "./life-market-core.js?v=1.7.60",
  "./life-market.js?v=1.7.60",
  "./life-market.css?v=1.7.60",
  "./index.html",
  "./style.css?v=1.7.60",
  "./persona-spaces.js?v=1.7.60",
  "./group-context.js?v=1.7.60",
  "./spectator-money.js?v=1.7.60",
  "./space-wallet.js?v=1.7.60",
  "./script.js?v=1.7.60",
  "./api-payload-guard.js?v=1.7.44",
  "./narration-mode.js",
  "./time-machine.js?v=1.7.60",
];

const OPTIONAL_URLS_TO_CACHE = [
  "https://unpkg.com/dexie/dist/dexie.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://phoebeboo.github.io/mewoooo/pp.js",
  "https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/StreamSaver.min.js",
  "https://s3plus.meituan.net/opapisdk/op_ticket_885190757_1758510900942_qdqqd_djw0z2.jpeg",
  "https://s3plus.meituan.net/opapisdk/op_ticket_885190757_1756312261242_qdqqd_g0eriz.jpeg",
];

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
            if (cacheName !== CACHE_NAME) {
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
  // 如果是心跳 Ping 请求（虚拟地址），直接返回 200 OK，不走网络
  // 这是配合 script.js 里的保活 fetch 使用的
  if (event.request.url.includes("/_keep_alive_ping_")) {
    event.respondWith(new Response("pong"));
    return;
  }

  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
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
