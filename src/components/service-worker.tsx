"use client";

import { useEffect } from "react";

/**
 * 注册 Service Worker。
 * 只在生产环境注册：开发时 SW 会缓存页面，导致改代码后看不到变化。
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((error) => console.warn("[pwa] Service Worker 注册失败", error));
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
