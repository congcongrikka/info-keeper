import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

/**
 * 特权 Supabase 客户端（service_role key）。
 *
 * ⚠️ 只能出现在服务端：它会**绕过 RLS**，拿到的是整库权限。
 * 现有用途只有两个：
 *   1) /api/auth/register —— 邀请制建号
 *   2) /api/cron/daily-reminder —— 定时任务没有登录用户，必须跨用户查数据
 *
 * 规矩：用它的地方必须自己把 user_id 条件写进查询。
 * 少了 RLS 这道锁，显式 user_id 就是唯一防线（见 src/lib/db.ts 顶部注释）。
 */
export function isAdminConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * 建特权客户端。没配 key 时抛中文错误，由调用方转成 503。
 * 关掉 autoRefreshToken / persistSession：这是长驻的 Node 进程，
 * 没有浏览器上下文，也没必要替 service_role 维护会话。
 */
export function createAdminClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    throw new Error(
      "缺少 SUPABASE_SERVICE_ROLE_KEY。\n" +
        "本地：在 .env.local 里补上（Supabase → Project Settings → API → service_role）。\n" +
        "线上：在 Vercel → Settings → Environment Variables 中配置后重新部署。",
    );
  }

  const { url } = getPublicEnv();

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
