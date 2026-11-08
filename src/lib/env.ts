/**
 * 公开环境变量（会进入浏览器 bundle —— 只能放 anon key 这类本身就不保密的值）。
 * 说明：Supabase 的 anon key 天生设计为可公开，真正的权限边界由数据库 RLS 决定。
 */
export function getPublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY。\n" +
        "本地：复制 .env.example 为 .env.local 并填入 Supabase 项目参数。\n" +
        "线上：在 Vercel → Settings → Environment Variables 中配置后重新部署。",
    );
  }

  return { url, anonKey };
}

export function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
