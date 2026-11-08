"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Headphones,
  Inbox,
  ListTodo,
  LogOut,
  ChartNoAxesColumn,
  Settings2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MikuArt, MikuAvatar } from "@/components/miku-art";
import { ToastProvider } from "@/components/ui/toast";

const NAV = [
  { href: "/", label: "收件箱", icon: Inbox, mobile: true },
  { href: "/tasks", label: "待办", icon: ListTodo, mobile: true },
  { href: "/chat", label: "问答", icon: Headphones, mobile: true },
  { href: "/insights", label: "洞察", icon: ChartNoAxesColumn, mobile: true },
  // mobile: false —— 手机上设置入口只放在顶栏的齿轮图标里，底部导航保持四个主功能，避免重复。
  { href: "/settings", label: "设置", icon: Settings2, mobile: false },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/entry");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="信息管家首页">
      {/* 初音头像 Logo：整幅缩放 + 呼吸光环，hover 时光环增强 */}
      <MikuAvatar className="size-9 rounded-[11px] transition group-hover:shadow-[0_0_18px_rgba(57,197,187,0.5)]" />
      {!compact && (
        <span className="flex flex-col leading-tight">
          <span className="flex items-center gap-1 text-[17px] font-semibold tracking-tight text-bright">
            信息管家
            <span className="text-miku">♪</span>
          </span>
          <span className="text-[9px] font-medium uppercase tracking-[0.22em] text-faint">
            Info&nbsp;Keeper
          </span>
        </span>
      )}
    </Link>
  );
}

export function AppShell({
  children,
  email,
  aiEnabled,
}: {
  children: ReactNode;
  email: string;
  aiEnabled: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      // 走服务端路由：signOut + 逐个清 sb-* 会话 cookie（含分片），
      // 换账号测试时不会残留上一个人的会话。
      await fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" });
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  const initial = (email || "?").slice(0, 1).toUpperCase();

  return (
    <ToastProvider>
      <div className="min-h-dvh">
        {/* ---------- 桌面侧栏：深色玻璃 ---------- */}
        <aside className="glass-strong fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col border-r border-miku/20 px-5 py-6 md:flex">
          <Brand />

          <nav className="mt-9 flex flex-col gap-1.5">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                    active
                      ? "glass text-miku neon-soft"
                      : "text-muted hover:bg-white/5 hover:text-bright",
                  )}
                >
                  {/* 选中项左侧发光条 */}
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-miku transition",
                      active ? "neon opacity-100" : "opacity-0",
                    )}
                  />
                  <Icon className={cn("size-[17px]", active ? "text-miku" : "text-faint")} strokeWidth={1.9} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto space-y-3">
            <div className="glass-card rounded-2xl p-3.5">
              <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-faint">
                <Sparkles className={cn("size-3.5", aiEnabled ? "text-miku" : "text-faint")} />
                智能引擎
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                {aiEnabled ? "已连接，新记录会自动分类、摘要并关联。" : "未配置 API Key，当前仅支持手动整理。"}
              </p>
              {!aiEnabled && (
                <Link
                  href="/settings"
                  className="mt-2 inline-flex text-[12px] font-medium text-miku transition hover:text-miku-3"
                >
                  去配置 →
                </Link>
              )}
            </div>

            <div className="flex items-center gap-2 rounded-xl px-1 py-1">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-miku to-neon-blue text-[13px] font-semibold text-white">
                {initial}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-faint" title={email}>
                {email}
              </span>
              <button
                type="button"
                onClick={signOut}
                disabled={signingOut}
                className="rounded-lg p-1.5 text-faint transition hover:bg-white/5 hover:text-sakura disabled:opacity-40"
                aria-label="退出登录"
                title="退出登录"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* ---------- 移动端顶栏：玻璃 ---------- */}
        {/* .pt-safe：iOS 主屏应用（appleWebApp.statusBarStyle = black-translucent
            + viewport-fit=cover）下内容会顶进状态栏，刘海屏上会压住标题和头像。
            安全区内边距只在有刘海的设备上生效，桌面端外观不变。 */}
        <header className="glass-strong pt-safe sticky top-0 z-40 border-b border-miku/15 md:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <Brand />
            {/* 右上角原本是「邮箱首字母」圆形头像，手机上很多人以为是头像而不是入口，
                而且设置页现在已经在底部导航里。这里换成明确的齿轮图标，语义直白。 */}
            <Link
              href="/settings"
              className={cn(
                "flex size-9 items-center justify-center rounded-full border transition",
                pathname === "/settings"
                  ? "border-miku/60 bg-miku/15 text-miku"
                  : "border-miku/25 bg-white/5 text-faint hover:border-miku/50 hover:text-miku",
              )}
              aria-label="设置"
              title="设置"
            >
              <Settings2 className="size-[18px]" strokeWidth={1.9} />
            </Link>
          </div>
        </header>

        {/* ---------- 内容区 ---------- */}
        <div className="md:pl-[252px]">
          <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6 md:pb-16 md:pt-10">{children}</main>
        </div>

        {/* ---------- 收件箱右下角陪伴图：只在收件箱出现，且不拦截点击 ---------- */}
        {pathname === "/" && (
          <div className="pointer-events-none fixed bottom-16 right-4 z-30 w-28 md:bottom-6 md:right-6 md:w-32">
            <MikuArt name="corner" float halo />
          </div>
        )}

        {/* ---------- 移动端底部导航：玻璃 ---------- */}
        <nav className="glass-strong pb-safe fixed inset-x-0 bottom-0 z-50 border-t border-miku/20 px-2 pt-1.5 md:hidden">
          <div className="mx-auto flex max-w-md items-stretch justify-between">
            {NAV.filter((item) => item.mobile).map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] transition",
                    active ? "text-miku" : "text-faint",
                  )}
                >
                  {active && <span className="neon-soft absolute inset-0 rounded-xl bg-miku/10" />}
                  <Icon className="relative size-[19px]" strokeWidth={active ? 2.1 : 1.8} />
                  <span className="relative">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </ToastProvider>
  );
}
