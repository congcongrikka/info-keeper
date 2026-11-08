import type { NextRequest } from "next/server";
import { z } from "zod";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getPublicEnv } from "@/lib/env";
import { isSignupOpen, verifyInviteCode } from "@/lib/invite";
import { errorResponse, HttpError, jsonOk, rateLimit } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.email("邮箱格式不正确").max(200),
  password: z.string().min(6, "密码至少 6 位").max(200),
  inviteCode: z.string().max(128).optional(),
  next: z.string().max(300).optional(),
});

/** 取一个尽量稳定的请求来源标识，用于限流（不信任 X-Forwarded-For 的完整链） */
function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

/**
 * 受邀请码保护的注册入口。
 *
 * 两种后端模式（自动选择）：
 *   A. 配置了 SUPABASE_SERVICE_ROLE_KEY → 走 Admin API 建号。
 *      配合在 Supabase 控制台【关闭公开注册】，浏览器端 signUp 会被 Supabase 直接拒绝，
 *      绕不过邀请码。这是推荐模式。
 *   B. 没有 service_role key → 退回普通 signUp。
 *      此时 Supabase 的公开注册开关必须保持开启，浏览器端可以绕过本接口直接注册，
 *      邀请码只挡住「从界面点进来的人」。安全性弱于 A。
 */
export async function POST(request: NextRequest) {
  try {
    // 限流放在最前面：连邀请码都不看就先限速，防止拿本接口爆破邀请码
    rateLimit(`auth:register:${clientKey(request)}`, 8, 60_000);

    if (!isSignupOpen()) {
      throw new HttpError(
        "服务端还没配置 INVITE_CODE，注册通道已关闭。请联系管理员。",
        503,
        "invite_not_configured",
      );
    }

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message ?? "请求参数不正确", 422, "invalid_input");
    }

    const { email, password, inviteCode, next } = parsed.data;
    const cleanEmail = email.trim().toLowerCase();

    // ---- 邀请码闸门：不通过就直接 403，绝不触碰 Supabase ----
    const invite = verifyInviteCode(inviteCode);
    if (!invite.ok) {
      throw new HttpError(invite.message, invite.status, invite.code);
    }

    const origin = new URL(request.url).origin;
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (serviceKey) {
      // ---------- 模式 A：Admin API，配合 Supabase 关闭公开注册 ----------
      const { url } = getPublicEnv();
      const admin = createAdminClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data, error } = await admin.auth.admin.createUser({
        email: cleanEmail,
        password,
        // 邀请码已经是真正的闸门；Supabase 自带邮件服务限流很严（免费档每小时个位数），
        // 所以默认直接确认邮箱。想保留「点邮件才算注册成功」的话，设 INVITE_AUTO_CONFIRM=false。
        email_confirm: process.env.INVITE_AUTO_CONFIRM !== "false",
        user_metadata: { invited: true },
      });

      if (error) {
        const message = error.message.toLowerCase();
        if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
          throw new HttpError("这个邮箱已经注册过了，直接登录吧", 409, "already_registered");
        }
        throw new HttpError(`创建账号失败：${error.message}`, 400, "signup_failed");
      }

      // 账号建好之后立刻用刚设的密码登录一次，让本路由直接把会话 cookie 写进响应。
      // 客户端拿到的就是「已登录」，少一次往返，也避免前端重复处理密码。
      let signedIn = false;
      try {
        const supabase = await createClient();
        const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        signedIn = !signInError && Boolean(session.session);
      } catch (signInFailure) {
        console.warn("[auth/register] 建号成功但自动登录失败", signInFailure);
      }

      return jsonOk(
        {
          ok: true,
          status: signedIn ? "signed_in" : "pending_confirm",
          user_id: data.user?.id ?? null,
          redirect_to: redirectTo,
        },
        { status: 201 },
      );
    }

    // ---------- 模式 B：普通 signUp（需要 Supabase 公开注册开启） ----------
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("already") || message.includes("registered")) {
        throw new HttpError("这个邮箱已经注册过了，直接登录吧", 409, "already_registered");
      }
      if (message.includes("signups not allowed") || message.includes("signup is disabled")) {
        throw new HttpError(
          "Supabase 项目已关闭公开注册，但服务端没有配置 SUPABASE_SERVICE_ROLE_KEY，注册走不通。请二选一：配置 service_role key，或在 Supabase 重新开启注册。",
          503,
          "signup_disabled",
        );
      }
      if (message.includes("rate limit")) {
        throw new HttpError("注册太频繁了，过一会儿再试", 429, "rate_limited");
      }
      throw new HttpError(`注册失败：${error.message}`, 400, "signup_failed");
    }

    const needsConfirm = !data.session;

    return jsonOk(
      {
        ok: true,
        status: needsConfirm ? "pending_confirm" : "signed_in",
        user_id: data.user?.id ?? null,
        redirect_to: redirectTo,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET 只用来告诉前端「注册通道是否开放」，不泄露邀请码本身 */
export async function GET() {
  return jsonOk({ signup_open: isSignupOpen() });
}
