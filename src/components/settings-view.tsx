"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing,
  ChevronRight,
  Download,
  KeyRound,
  LoaderCircle,
  LogOut,
  Mail,
  ShieldCheck,
  Smartphone,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { PushToggle } from "@/components/push-toggle";
import { EmailToggle } from "@/components/email-toggle";
import type { Stats } from "@/lib/db";

interface SettingsViewProps {
  email: string;
  userId: string;
  aiEnabled: boolean;
  aiModel: string;
  stats: Stats;
  pushConfigured: boolean;
  vapidPublicKey: string;
  emailConfigured: boolean;
}

export function SettingsView({
  email,
  userId,
  aiEnabled,
  aiModel,
  stats,
  pushConfigured,
  vapidPublicKey,
  emailConfigured,
}: SettingsViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [installEvent, setInstallEvent] = useState<Event | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // 判断「当前是不是以已安装的 App 形态在跑」。三个平台口径不一样：
    // - iOS/iPadOS：`beforeinstallprompt` 永远不触发，官方判定只有 navigator.standalone；
    // - Android/Chrome：manifest 的 display: standalone 生效，matchMedia 可用；
    // - 桌面 Chrome/Edge：同上（也可能是窗口化窗口，minimal-ui 也算已安装）。
    // 注意：matchMedia("(display-mode: fullscreen)") 不能当安装信号——
    // 普通标签页调 Fullscreen API 也会命中。
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      window.matchMedia("(display-mode: window-controls-overlay)").matches ||
      // 非标准属性，但这是 iOS 上唯一可靠的判定（TS 的 Navigator 类型里没有）
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) setInstalled(true);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = async () => {
    if (!installEvent) return;
    const event = installEvent as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
      toast("已添加到主屏幕", "success");
    }
    setInstallEvent(null);
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      // 服务端路由负责 signOut + 清掉所有 sb-* 会话 cookie，换账号更干净
      await fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" });
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-tight text-bright sm:text-[30px]">
          设置 <span className="text-miku">♪</span>
        </h1>
        <p className="mt-1 text-[12.5px] text-faint">账号、备份与安装</p>
      </header>

      <section className="glass-strong rounded-3xl p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-miku to-neon-blue text-lg font-semibold text-white">
            {(email || "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-bright">{email}</p>
            <p className="mt-0.5 font-mono text-[10.5px] text-faint">{userId.slice(0, 8)}…</p>
          </div>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-miku/15 px-2 py-1 text-[10.5px] font-medium text-miku">
            <ShieldCheck className="size-3" />
            已登录
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-miku/15 pt-4">
          <Stat label="记录" value={stats.total} />
          <Stat label="待整理" value={stats.inbox} />
          <Stat label="待办" value={stats.openTasks} />
        </div>
      </section>

      <section className="glass-strong rounded-3xl p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-bright">
          <Download className="size-4 text-miku" />
          数据备份
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
          导出全部记录、关联和阶段总结为一个 JSON 文件。建议每月存一份到自己的硬盘或网盘。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a
            href="/api/export"
            className="neon-soft inline-flex items-center gap-1.5 rounded-full bg-miku px-4 py-2 text-[12.5px] font-medium text-night transition hover:neon"
          >
            <Download className="size-3.5" />
            导出全部数据
          </a>
          <span className="text-[11px] text-faint">包含 {stats.total} 条记录</span>
        </div>
      </section>

      <section className="glass-strong rounded-3xl p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-bright">
          <Sparkles className="size-4 text-miku" />
          智能引擎
        </h2>
        <div className="mt-2.5 flex items-center justify-between rounded-2xl bg-white/5 px-3.5 py-3">
          <div>
            <p className="text-[12.5px] text-muted">{aiEnabled ? "已连接" : "未配置"}</p>
            <p className="mt-0.5 text-[11px] text-faint">{aiEnabled ? aiModel : "缺少 AI_API_KEY"}</p>
          </div>
          <span
            className={
              aiEnabled
                ? "rounded-full bg-miku/15 px-2 py-0.5 text-[10.5px] font-medium text-miku"
                : "rounded-full bg-amber/15 px-2 py-0.5 text-[10.5px] font-medium text-amber"
            }
          >
            {aiEnabled ? "运行中" : "未启用"}
          </span>
        </div>

        {!aiEnabled && (
          <div className="mt-3 rounded-2xl border border-miku/15 bg-white/5 p-3">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
              <KeyRound className="size-3.5" />
              在服务端环境变量里补上这几项，然后重新部署
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-night-2 px-3 py-2 text-[10.5px] leading-relaxed text-miku/90">
{`AI_BASE_URL=https://api.deepseek.com/v1
AI_API_KEY=sk-...
AI_MODEL=deepseek-chat`}
            </pre>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              API Key 只存在服务端，前端代码里不会出现，也不会被浏览器拿到。
            </p>
          </div>
        )}
      </section>

      <section className="glass-strong rounded-3xl p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-bright">
          <Smartphone className="size-4 text-miku" />
          装到手机上
        </h2>
        {installed ? (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-miku">已经以独立应用的方式运行了。</p>
        ) : (
          <>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
              用手机浏览器打开本站，添加到主屏幕后就像一个原生 App，没有地址栏。
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/5 p-3">
                <p className="text-[11.5px] font-medium text-muted">iPhone / iPad</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
                  Safari → 分享 → 「添加到主屏幕」
                </p>
              </div>
              <div className="rounded-2xl bg-white/5 p-3">
                <p className="text-[11.5px] font-medium text-muted">Android</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
                  Chrome / Edge → 右上角菜单 → 「安装应用」
                </p>
              </div>
            </div>
            {installEvent && (
              <button
                type="button"
                onClick={install}
                className="glass mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] text-muted transition hover:border-miku/50 hover:text-miku"
              >
                立即安装
                <ChevronRight className="size-3.5" />
              </button>
            )}
          </>
        )}
      </section>

      <section className="glass-strong rounded-3xl p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-bright">
          <BellRing className="size-4 text-miku" />
          每日早报
        </h2>
        <PushToggle pushConfigured={pushConfigured} vapidPublicKey={vapidPublicKey} />
      </section>

      <section className="glass-strong rounded-3xl p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-bright">
          <Mail className="size-4 text-miku" />
          邮件早报
        </h2>
        <EmailToggle emailConfigured={emailConfigured} />
      </section>

      <section className="glass-strong rounded-3xl p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-bright">
          <WifiOff className="size-4 text-faint" />
          离线使用
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
          断网时会显示离线页；有新内容需要联网才能保存。
        </p>
      </section>

      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="glass flex w-full items-center justify-center gap-2 rounded-3xl py-3.5 text-[13px] text-muted transition hover:border-sakura/50 hover:text-sakura disabled:opacity-60"
      >
        {signingOut ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
        退出登录
      </button>

      <p className="pb-2 text-center text-[10.5px] tracking-wide text-faint/70">
        <span className="text-miku">♪</span> 信息管家 · 数据存在你自己的 Supabase 项目里
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-[19px] font-semibold tabular-nums text-bright">{value}</p>
      <p className="mt-0.5 text-[10.5px] text-faint">{label}</p>
    </div>
  );
}
