"use client";

import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, Lock, Mail, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { MikuSilhouette } from "@/components/miku-icons";
import { MikuArt } from "@/components/miku-art";

type Mode = "signin" | "signup";

function translate(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) return "邮箱或密码不正确";
  if (text.includes("email not confirmed")) return "邮箱还没验证，请先点开确认邮件里的链接";
  if (text.includes("user already registered")) return "这个邮箱已经注册过了，直接登录吧";
  if (text.includes("password should be at least")) return "密码至少 6 位";
  if (text.includes("rate limit") || text.includes("after")) return "操作太频繁了，过一会儿再试";
  if (text.includes("unable to validate email")) return "邮箱格式看起来不对";
  if (text.includes("signups not allowed")) return "当前项目已关闭注册，请在 Supabase 控制台开启或直接用已有账号登录";
  if (text.includes("failed to fetch")) return "连不上 Supabase，检查网络和项目配置";
  return message;
}

/** 服务端注册接口返回的结构（见 src/app/api/auth/register/route.ts） */
interface RegisterResponse {
  ok?: boolean;
  status?: "signed_in" | "pending_confirm";
  redirect_to?: string;
  error?: string;
  code?: string;
}

/**
 * 调服务端注册接口。
 * 邀请码校验在服务端做，浏览器只负责把用户填的值送上去 —— INVITE_CODE 永远不出现在前端代码里。
 */
async function register(payload: {
  email: string;
  password: string;
  inviteCode: string;
  next: string;
}): Promise<RegisterResponse> {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as RegisterResponse;

  if (!response.ok) {
    // 403 = 邀请码不对，429 = 限流，其余按通用错误处理
    throw new Error(data.error || `注册失败（HTTP ${response.status}）`);
  }
  return data;
}

/** 邮件确认链接回跳失败的提示。reason 由 /auth/callback 分类后带回来。 */
function callbackError(reason: string | null): string | null {
  if (reason === "pkce") {
    // iOS 上最常见的坑：在手机上注册，却在另一台设备（或邮件客户端的预览）里点链接。
    // PKCE 的 code_verifier 存在发起注册那台设备/那个浏览器的 cookie 里，换设备必然失败。
    return "确认链接要在「发起注册的那台设备、那个浏览器」里点开。如果换了设备，请直接回到登录页用邮箱和密码登录。";
  }
  if (reason === "expired") {
    return "确认链接已经过期或失效了。回登录页用邮箱密码登录，或者重新注册一次。";
  }
  return "确认链接失效了，请重新登录或再发一次确认邮件";
}

export function LoginForm({ signupOpen = true }: { signupOpen?: boolean }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  // 只接受站内路径：`//evil.com` 会被浏览器当成外站，等于开放重定向
  const rawNext = searchParams.get("next") || "/";
  const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "callback" ? callbackError(searchParams.get("reason")) : null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;

    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();

      if (mode === "signin") {
        const supabase = createClient();
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signInError) throw signInError;
        router.replace(nextPath);
        router.refresh();
      } else {
        // 注册走服务端：邀请码在服务端校验，不通过直接 403，Supabase 连碰都不会碰。
        const result = await register({
          email: cleanEmail,
          password,
          inviteCode,
          next: nextPath,
        });

        if (result.status === "signed_in") {
          router.replace(nextPath);
          router.refresh();
        } else {
          setNotice("账号已创建。确认邮件已发出，点开邮件里的链接后就能进来了。");
          setMode("signin");
          setPassword("");
          setInviteCode("");
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? translate(caught.message) : "出了点问题，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-[392px]">
        <div className="flex items-center gap-2.5">
          <span className="neon-soft flex size-10 items-center justify-center rounded-[12px] bg-gradient-to-br from-miku to-neon-blue text-white">
            <MikuSilhouette className="size-[24px]" />
          </span>
          <div className="leading-tight">
            <p className="text-[18px] font-semibold tracking-tight text-bright">信息管家</p>
            <p className="text-[9px] font-medium uppercase tracking-[0.22em] text-faint">Info Keeper</p>
          </div>
        </div>

        <MikuArt name="login" priority halo className="mx-auto mt-7 w-48 lg:w-64" />

        <h1 className="mt-6 text-[28px] font-semibold leading-[1.35] tracking-tight text-bright sm:text-[32px]">
          把零散的想法，
          <br />
          收回一处。
        </h1>
        <p className="mt-3 text-[13px] leading-relaxed text-faint">
          想到什么就丢进来。分类、摘要、串联、回顾，交给我。
        </p>

        <div className="glass-strong mt-8 rounded-3xl p-1.5">
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white/5 p-1">
            {(
              [
                ["signin", "登录"],
                ["signup", "注册"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={cn(
                  "rounded-xl py-2 text-[13px] font-medium transition",
                  mode === value
                    ? "neon-soft bg-miku text-night"
                    : "text-faint hover:text-bright",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3 px-4 pb-4 pt-4">
            <label className="block">
              <span className="text-[11.5px] font-medium text-muted">邮箱</span>
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  /* iOS 上邮箱键盘会把首字母自动大写，还开着自动纠错 */
                  autoCapitalize="none"
                  autoCorrect="off"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="glass h-11 w-full rounded-xl pl-9 pr-3 text-[14px] text-bright outline-none transition placeholder:text-faint/70 focus:border-miku/60 focus:neon-soft"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-[11.5px] font-medium text-muted">密码</span>
              <div className="relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "signup" ? "至少 6 位" : "输入密码"}
                  className="glass h-11 w-full rounded-xl pl-9 pr-10 text-[14px] text-bright outline-none transition placeholder:text-faint/70 focus:border-miku/60 focus:neon-soft"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-faint transition hover:text-bright"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </label>

            {mode === "signup" && (
              <label className="block">
                <span className="text-[11.5px] font-medium text-muted">邀请码</span>
                <div className="relative mt-1.5">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                  <input
                    type="text"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    /* iOS 键盘的三个坑：默认首字母大写（abcd01 → Abcd01）、
                       自动纠错会改写单词、智能标点会替换引号。邀请码必须原样输入。 */
                    autoCapitalize="none"
                    autoCorrect="off"
                    inputMode="text"
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                    placeholder={signupOpen ? "向管理员索取" : "注册通道已关闭"}
                    disabled={!signupOpen}
                    className="glass h-11 w-full rounded-xl pl-9 pr-3 text-[14px] text-bright outline-none transition placeholder:text-faint/70 focus:border-miku/60 focus:neon-soft disabled:cursor-not-allowed disabled:text-faint"
                  />
                </div>
                <span className="mt-1.5 block text-[11px] leading-relaxed text-faint/80">
                  没有邀请码就进不来 —— 这是为了保护共用的模型额度。
                </span>
              </label>
            )}

            {error && (
              <p className="rounded-xl bg-sakura/15 px-3 py-2 text-[12px] leading-relaxed text-sakura">{error}</p>
            )}
            {notice && (
              <p className="rounded-xl bg-miku/15 px-3 py-2 text-[12px] leading-relaxed text-miku">{notice}</p>
            )}

            <button
              type="submit"
              disabled={
                loading ||
                !email.trim() ||
                password.length < 6 ||
                (mode === "signup" && (!signupOpen || !inviteCode.trim()))
              }
              className="neon-soft mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-miku text-[13.5px] font-medium text-night transition hover:neon active:scale-[0.995] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-faint"
            >
              {loading && <LoaderCircle className="size-4 animate-spin" />}
              {mode === "signin" ? "进入" : "创建账号"}
            </button>
          </form>
        </div>

        <p className="mt-6 flex items-start gap-1.5 text-[11px] leading-relaxed text-faint/80">
          <Sparkles className="mt-0.5 size-3 shrink-0 text-miku" />
          这是邀请制的私人空间。注册需要管理员给的邀请码；每个人的记录只有自己能看见。
        </p>
      </div>
    </div>
  );
}
