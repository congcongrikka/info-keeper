import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPublicEnv } from "@/lib/env";

/**
 * 服务端 Supabase 客户端（Server Component / Route Handler / Server Action 通用）。
 * 使用 cookie 里的用户会话，所有查询自动带上 JWT，RLS 按 auth.uid() 生效。
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getPublicEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component 内不能写 cookie，交由 middleware 刷新会话，忽略即可
        }
      },
    },
  });
}

/** 取当前登录用户；未登录返回 null（不抛错，方便页面自行分流） */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * 页面级取用户：拿不到就跳登录。
 *
 * 为什么不只依赖 (app)/layout.tsx 的 redirect：
 * layout 和 page 是并发渲染的，layout 里 redirect 之前 page 已经开始取数。
 * 会话过期时 page 会用匿名身份查库 —— RLS 让它查到 0 行，界面就显示「空收件箱」，
 * 而不是「请重新登录」。多用户场景下这会被误读成「数据丢了」。
 */
export async function requireUserPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return { supabase, user };
}
