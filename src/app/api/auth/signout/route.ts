import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 彻底登出。
 *
 * 为什么要有这个路由，而不是前端直接 supabase.auth.signOut()：
 * - @supabase/ssr 会把会话 cookie 分片（sb-<ref>-auth-token、…​.0、…​.1），
 *   光靠 SDK 在部分分支下会残留分片，切换账号时会出现「又跳回上一个人的会话」。
 * - 这里在服务端 signOut() 之后，再把所有 sb-* 会话 cookie 逐个以 Max-Age=0 覆盖，
 *   覆盖请求、响应两侧，确保下一次请求一定是未登录状态。
 */

/** 判断是不是 Supabase 写入的会话 cookie（含分片） */
function isAuthCookie(name: string): boolean {
  return name.startsWith("sb-") || name.includes("-auth-token");
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (error) {
    // 会话已经失效时 signOut 也可能报错，这不影响「清干净」这个目标
    console.warn("[auth/signout] signOut 失败，继续清 cookie", error);
  }

  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL("/login", url.origin), { status: 303 });

  // 收集所有需要清掉的 cookie 名：客户端带来的 + Supabase 最新写出的
  const names = new Set<string>();
  for (const cookie of request.cookies.getAll()) {
    if (isAuthCookie(cookie.name)) names.add(cookie.name);
  }
  for (const cookie of response.cookies.getAll()) {
    if (isAuthCookie(cookie.name)) names.add(cookie.name);
  }

  const secure = url.protocol === "https:";
  for (const name of names) {
    response.cookies.set(name, "", {
      path: "/",
      maxAge: 0,
      expires: new Date(0),
      sameSite: "lax",
      secure,
    });
  }

  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

/** 让 GET 也能用（点了链接直接登出），但只重定向，不返回敏感信息 */
export async function GET(request: NextRequest) {
  return POST(request);
}
