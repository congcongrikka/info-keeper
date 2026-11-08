import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Supabase 邮件确认 / Magic Link 的回跳地址。
 * PKCE 流程下会带 ?code=...，用它换一个正式的会话 cookie。
 *
 * 只接受站内相对路径：以单个 "/" 开头，且不是 "//" 或 "/\"（协议相对 URL 会被
 * 浏览器当成外站，等于开放重定向）。
 */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

/** PKCE 兑换失败的几种典型原因，分开返回给登录页显示不同文案 */
function classify(message: string): "pkce" | "expired" | "unknown" {
  const text = message.toLowerCase();
  // 最常见的一种：在 A 浏览器/设备发起注册，却在 B 浏览器点开邮件。
  // code_verifier 存在发起方浏览器的 cookie 里，换设备就找不到了；
  // 苹果手机上的典型场景是：手机注册 → 在 Mac 的邮件客户端里点链接。
  if (text.includes("code verifier") || text.includes("verifier")) return "pkce";
  if (text.includes("expired") || text.includes("invalid")) return "expired";
  return "unknown";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    console.warn("[auth/callback]", classify(error.message), error.message);
    return NextResponse.redirect(
      new URL(`/login?error=callback&reason=${classify(error.message)}`, url.origin),
    );
  }

  return NextResponse.redirect(new URL("/login?error=callback", url.origin));
}
