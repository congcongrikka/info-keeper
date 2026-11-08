import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/offline",
  "/api/health",
  // 注册要走服务端邀请码校验，未登录也必须能访问
  "/api/auth/register",
  // 登出必须在任何会话状态下都能执行
  "/api/auth/signout",
  // 定时任务由 Vercel Cron 调起，没有登录 cookie，靠 CRON_SECRET 头自证身份（见 src/lib/cron.ts）
  "/api/cron",
];
const PUBLIC_FILES = ["/manifest.webmanifest", "/sw.js", "/favicon.ico", "/icons/", "/apple-touch-icon.png"];

function copyCookies(from: NextResponse, to: NextResponse) {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}

/**
 * 统一入口守卫：
 * 1) 每次请求刷新 Supabase 会话 cookie（否则 access token 一小时后过期，用户会被踢出）
 * 2) 未登录访问页面 → 跳登录并带回跳地址；访问 API → 401 JSON
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 环境尚未配置时不要把所有请求打死，交给页面给出配置提示
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isPublic =
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    PUBLIC_FILES.some((p) => pathname === p || pathname.startsWith(p));

  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "未登录或会话已过期", code: "unauthorized" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return copyCookies(response, NextResponse.redirect(home));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * 跳过静态资源；其余全部经过（包括 /api），保证会话持续刷新
     */
    "/((?!_next/static|_next/image|icons/|favicon.ico|apple-touch-icon.png|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
