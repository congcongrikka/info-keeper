/* ============================================================
   信息管家 · Service Worker
   策略：
   - 页面导航：network-first，但**只缓存离线页本身**，不缓存任何登录后的页面。
     为什么：本项目是多用户共用一份代码，收件箱/任务/洞察这些页面的 HTML 是
     服务端按当前登录用户渲染的。如果把它们塞进 Cache Storage，那么在 iPhone 上
     「同一个人换账号」或者「朋友在同一台设备上登出再登入」时，离线回退可能把
     上一个人的页面壳端出来。Cache Storage 不区分 cookie，所以一律不存。
   - 静态资源：cache-first（/_next/static、图标）
   - /api/**：完全不缓存（数据必须实时，且涉及登录态）
   ============================================================ */

// v4：2026-11-08 主屏图标从矢量剪影换成初音头像，必须换版本号，
// 否则老的 ik-static-v3 里缓存着旧图标，主屏和通知栏会一直显示剪影。
const VERSION = "v4";
const STATIC_CACHE = `ik-static-${VERSION}`;
const OFFLINE_CACHE = `ik-offline-${VERSION}`;
const PRECACHE = ["/offline", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ik-") && key !== STATIC_CACHE && key !== OFFLINE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    // 断网时只给通用离线页，绝不回放任何登录后页面的缓存
    const offline = await caches.match("/offline");
    if (offline) return offline;
    return new Response("离线了，联网后自动恢复。", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/* ============================================================
   Web Push（每日早报）
   服务端 /api/cron/daily-reminder 每天北京时间 8:00 发一条：
     { title, body, url, tag }
   注意：payload 一定要 try/catch 解析。加密推送传来的是原始 bytes，
   服务端哪天换格式、或者用户点了「重新订阅」但旧 SW 还在，都不能让
   整条推送静默失败 —— 没有 showNotification 的 push 事件在 Chrome 上
   会被判为「滥用推送」，累积几次就可能被吊销推送权限。
   ============================================================ */

const DEFAULT_ICON = "/icons/icon-192.png";
const DEFAULT_BADGE = "/icons/icon-192.png";
const DEFAULT_TITLE = "信息管家";
const DEFAULT_URL = "/tasks";

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // 不是 JSON（或是纯文本），退化成把原文当正文
    try {
      payload = { body: event.data ? event.data.text() : "" };
    } catch {
      payload = {};
    }
  }

  const title = typeof payload.title === "string" && payload.title ? payload.title : DEFAULT_TITLE;
  const body =
    typeof payload.body === "string" && payload.body
      ? payload.body
      : "早上好！点开看看今天要做什么。";
  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : DEFAULT_URL;
  // tag 相同的新通知会替换旧的，避免一天里攒一串早报
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag : "daily-reminder";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: DEFAULT_ICON,
      badge: DEFAULT_BADGE,
      // 让通知在锁屏/通知中心也可见（Android 需要）
      data: { url },
      // 没有这个，部分平台会静默丢弃
      renotify: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : DEFAULT_URL;

  event.waitUntil(
    (async () => {
      // 优先复用已经开着的窗口，别每次都开新标签页
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of clientList) {
        // 已经在目标页：聚焦即可
        if (client.url.includes(target) && "focus" in client) {
          return client.focus();
        }
      }

      // 有窗口但不在目标页：导航过去再聚焦
      for (const client of clientList) {
        if ("navigate" in client) {
          try {
            const navigated = await client.navigate(target);
            if (navigated && "focus" in navigated) return navigated.focus();
          } catch {
            // navigate 在跨源/已关闭窗口上会抛，继续走 openWindow
          }
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }

      return undefined;
    })(),
  );
});
