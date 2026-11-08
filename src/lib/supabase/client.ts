"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

/**
 * 浏览器端 Supabase 客户端。
 * 只做两件事：登录状态管理 + 需要 Realtime 时订阅；业务数据一律走服务端 API。
 */
export function createClient() {
  const { url, anonKey } = getPublicEnv();
  return createBrowserClient(url, anonKey);
}
