"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Mail, ShieldAlert } from "lucide-react";
import { useToast } from "@/components/ui/toast";

interface EmailToggleProps {
  /** 服务端有没有配 SMTP —— 没配就把按钮禁掉并说明原因 */
  emailConfigured: boolean;
}

type EmailState = "checking" | "on" | "off" | "working";

interface StatusPayload {
  enabled: boolean;
  configured: boolean;
  email: string;
}

/**
 * 「邮件早报」开关。
 *
 * 为什么要有它：安卓手机的 Web Push 最后都要过 Google 的 FCM 通道，
 * 国行没有 Google 服务就拿不到推送（详见 push-toggle 里的说明）。
 * 邮件不依赖任何浏览器推送通道，邮箱 App 一响就是通知，所以作为兜底。
 */
export function EmailToggle({ emailConfigured }: EmailToggleProps) {
  const { toast } = useToast();
  const [state, setState] = useState<EmailState>("checking");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/push/email", { credentials: "same-origin" });
      if (!response.ok) {
        setState("off");
        return;
      }
      const data = (await response.json()) as StatusPayload;
      setEmail(data.email ?? "");
      setState(data.enabled ? "on" : "off");
    } catch {
      // 读不到状态就当没开，让用户还能点开关自己去试
      setState("off");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async () => {
    const next = state !== "on";
    setState("working");
    setMessage("");

    try {
      const response = await fetch("/api/push/email", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });

      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? `保存失败（HTTP ${response.status}）`);
      }

      setState(next ? "on" : "off");
      toast(next ? "邮件早报已开启" : "邮件早报已关闭", "success");
    } catch (error) {
      setState(next ? "off" : "on");
      const reason = error instanceof Error ? error.message : "保存失败";
      setMessage(reason);
      toast(reason, "error");
    }
  }, [state, toast]);

  const sendTest = useCallback(async () => {
    setTesting(true);
    setMessage("");

    try {
      const response = await fetch("/api/push/email", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; to?: string; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? `发送失败（HTTP ${response.status}）`);
      }

      toast(`已发送到 ${data?.to ?? email}，去收件箱看看`, "success");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "发送失败";
      setMessage(reason);
      toast(reason, "error");
    } finally {
      setTesting(false);
    }
  }, [email, toast]);

  const busy = state === "working" || state === "checking";

  return (
    <div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
        每天早上 8:00（北京时间）给注册邮箱发一封：今天有几件待办、都是什么。
        有待办才发，没有就安静一整天。手机上的邮箱 App 会弹通知，不需要装任何东西。
      </p>

      {!emailConfigured && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-sakura/10 p-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-sakura" />
          <p className="text-[11.5px] leading-relaxed text-muted">
            服务器还没有配置发信账号，暂时开不了邮件早报。
            <br />
            <span className="text-faint">
              在环境变量里补上 <code className="text-miku">SMTP_HOST</code>、
              <code className="text-miku">SMTP_USER</code>、
              <code className="text-miku">SMTP_PASS</code> 之后重新部署即可。
            </span>
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={busy || (!emailConfigured && state !== "on")}
          className={
            state === "on"
              ? "glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] text-muted transition hover:border-sakura/50 hover:text-sakura disabled:opacity-60"
              : "neon-soft inline-flex items-center gap-1.5 rounded-full bg-miku px-4 py-2 text-[12.5px] font-medium text-night transition hover:neon disabled:opacity-60"
          }
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Mail className="size-4" />}
          {state === "checking"
            ? "检查中…"
            : state === "working"
              ? "处理中…"
              : state === "on"
                ? "关闭邮件早报"
                : "开启邮件早报"}
        </button>

        {state === "on" && (
          <button
            type="button"
            onClick={sendTest}
            disabled={testing}
            className="glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] text-muted transition hover:border-miku/50 hover:text-miku disabled:opacity-60"
          >
            {testing ? <LoaderCircle className="size-4 animate-spin" /> : <Mail className="size-4" />}
            发一封测试邮件
          </button>
        )}
      </div>

      {state === "on" && email && (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          会发到 <span className="text-miku">{email}</span>。
          想换地址只能换账号 —— 邮件早报用的是登录邮箱，不额外收集别的地址。
        </p>
      )}

      {message && <p className="mt-2 text-[11.5px] leading-relaxed text-sakura">{message}</p>}

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        开启后先点「发一封测试邮件」确认能收到；收不到就翻一下垃圾邮件箱，
        把发件人加进白名单。
      </p>
    </div>
  );
}
