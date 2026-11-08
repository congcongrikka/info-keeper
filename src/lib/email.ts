import nodemailer, { type Transporter } from "nodemailer";

/**
 * 邮件早报的发送层。
 *
 * 为什么需要它：安卓手机上收不到 Web Push —— 安卓的推送投递最终都要过 Google 的
 * FCM 通道（连 Firefox 安卓版也一样，见 Mozilla 源码文档里的
 * Firebase Cloud Messaging → AbstractFirebasePushService），国行手机没有 Google 服务
 * 就拿不到推送地址。邮件不依赖任何推送服务商，是最稳的兜底通道。
 *
 * 配置（全部是可选的，没配就自动跳过邮件通道）：
 *   SMTP_HOST    smtp.qq.com / smtp.163.com / smtp.exmail.qq.com ...
 *   SMTP_PORT    465（SSL）或 587（STARTTLS）
 *   SMTP_SECURE  显式指定是否用 SSL；不填时按端口推断（465 = true）
 *   SMTP_USER    登录账号（通常就是发件邮箱）
 *   SMTP_PASS    授权码 / SMTP 密码（不是网页登录密码）
 *   MAIL_FROM    发件人地址，不填就用 SMTP_USER
 *   MAIL_FROM_NAME 发件人显示名，默认「信息管家」
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

function envTrim(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function isEmailConfigured(): boolean {
  return Boolean(envTrim("SMTP_HOST") && envTrim("SMTP_USER") && envTrim("SMTP_PASS"));
}

export function getSmtpConfig(): SmtpConfig | null {
  const host = envTrim("SMTP_HOST");
  const user = envTrim("SMTP_USER");
  const pass = envTrim("SMTP_PASS");
  if (!host || !user || !pass) return null;

  const port = Number(envTrim("SMTP_PORT") || "465");
  // 465 是隐式 SSL（连上就握手），587 是明文连上再 STARTTLS —— 两者不能搞反，
  // 搞反的典型症状是「连上了但一直等不到欢迎语」然后超时。
  const secureRaw = envTrim("SMTP_SECURE").toLowerCase();
  const secure =
    secureRaw === "" ? port === 465 : secureRaw === "true" || secureRaw === "1" || secureRaw === "yes";

  const from = envTrim("MAIL_FROM") || user;
  const fromName = envTrim("MAIL_FROM_NAME") || "信息管家";

  return { host, port, secure, user, pass, from, fromName };
}

/** 站点根地址，用于邮件里的按钮链接。 */
export function getSiteUrl(): string {
  const explicit = envTrim("NEXT_PUBLIC_SITE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");

  // Vercel 会自动注入生产域名（不带协议）
  const vercel = envTrim("VERCEL_PROJECT_PRODUCTION_URL") || envTrim("VERCEL_URL");
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

/**
 * 传输器复用：同一进程里连续发几十封时不必反复建 TLS 连接。
 * 配置变了（改环境变量重启）会重建。
 */
let cached: { key: string; transporter: Transporter } | null = null;

function getTransport(config: SmtpConfig): Transporter {
  const key = `${config.host}:${config.port}:${config.secure}:${config.user}`;
  if (cached && cached.key === key) return cached.transporter;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    // 连接超时给足一点：国内到某些海外 SMTP 首包会慢，但也不能无限等，
    // 否则一个卡住的连接会拖垮整轮 cron。
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    pool: false,
  });

  cached = { key, transporter };
  return transporter;
}

export interface EmailOutcome {
  ok: boolean;
  /** 服务端明确拒绝（5xx / 收件人不存在）—— 这类重试也不会成功 */
  permanent: boolean;
  reason: string;
}

function describeError(error: unknown): { reason: string; permanent: boolean } {
  if (!(error instanceof Error)) {
    return { reason: "未知错误", permanent: false };
  }

  const code = (error as Error & { responseCode?: number }).responseCode;
  const raw = error.message || error.name || "未知错误";

  // 5xx 是「服务器明确说不」，4xx 里的 421 是临时限流，其余按可重试处理。
  if (typeof code === "number") {
    if (code >= 500 && code !== 552) return { reason: `${raw}（SMTP ${code}）`, permanent: true };
    if (code === 550 || code === 551 || code === 553) {
      return { reason: `${raw}（SMTP ${code}，收件地址可能无效）`, permanent: true };
    }
    return { reason: `${raw}（SMTP ${code}）`, permanent: false };
  }

  const lower = raw.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("authentication")) {
    return { reason: `${raw}（账号或授权码不对）`, permanent: true };
  }
  if (lower.includes("econnection") || lower.includes("timeout") || lower.includes("econnreset")) {
    return { reason: `${raw}（网络不通或超时）`, permanent: false };
  }

  return { reason: raw, permanent: false };
}

export async function sendEmail(message: EmailMessage): Promise<EmailOutcome> {
  const config = getSmtpConfig();
  if (!config) {
    return { ok: false, permanent: true, reason: "服务端没有配置 SMTP，邮件通道未启用。" };
  }

  try {
    await getTransport(config).sendMail({
      from: `"${config.fromName}" <${config.from}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { ok: true, permanent: false, reason: "" };
  } catch (error) {
    const described = describeError(error);
    console.error("[email] send failed", {
      to: message.to,
      reason: described.reason,
      permanent: described.permanent,
    });
    return { ok: false, permanent: described.permanent, reason: described.reason };
  }
}

/** 并发受限的批量发送：邮件服务器对并发连接通常不友好，4 路足够了。 */
export async function sendEmailBatch(
  messages: EmailMessage[],
  concurrency = 4,
): Promise<EmailOutcome[]> {
  const results: EmailOutcome[] = new Array(messages.length);
  let index = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const current = index;
      index += 1;
      const message = messages[current];
      if (!message) return;
      results[current] = await sendEmail(message);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, messages.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 纯文本兜底里的任务标题可能很长，截一下。 */
function clip(value: string, max: number): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

export interface DigestTask {
  title: string;
  priority: number;
}

export interface DigestContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * 组装早报正文。
 *
 * 文案刻意跟 Web Push 那条保持一致（「早上好！你今天有 X 件待办需要处理」），
 * 这样两个通道收到的信息不会互相矛盾。
 */
export function buildDigestEmail(
  taskCount: number,
  tasks: DigestTask[],
  siteUrl: string,
): DigestContent {
  const tasksUrl = `${siteUrl}/tasks`;
  const subject = `早上好！你今天有 ${taskCount} 件待办需要处理`;
  const shown = tasks.slice(0, 10);
  const rest = taskCount - shown.length;

  const textLines = [
    "早上好！",
    "",
    `你今天有 ${taskCount} 件待办需要处理。`,
    "",
    ...shown.map((task, index) => `${index + 1}. ${clip(task.title, 80)}`),
  ];
  if (rest > 0) textLines.push(`…… 还有 ${rest} 件，点开下面这个链接看全部。`);
  textLines.push("", `查看全部：${tasksUrl}`, "", "—— 信息管家");

  const itemRows = shown
    .map((task) => {
      // priority 1 是最高（见 src/lib/types.ts 的 KIND_META/STATUS_META 约定）
      const dot = task.priority === 1 ? "#f7768e" : "#7dcfff";
      return `<li style="margin:0 0 8px;padding:0;list-style:none;display:flex;gap:8px;align-items:flex-start">
        <span style="flex:none;margin-top:7px;width:6px;height:6px;border-radius:999px;background:${dot}"></span>
        <span style="color:#d7dbe8;font-size:14px;line-height:1.6">${escapeHtml(clip(task.title, 120))}</span>
      </li>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 16px;background:#16161e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#1e1e2e;border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:24px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;color:#7aa2f7">信息管家 · 每日早报</p>
    <h1 style="margin:0 0 16px;font-size:19px;line-height:1.5;color:#e6e9f5;font-weight:600">
      早上好！你今天有 <span style="color:#7dcfff">${taskCount}</span> 件待办需要处理
    </h1>
    <ul style="margin:0 0 20px;padding:0">${itemRows}</ul>
    ${rest > 0 ? `<p style="margin:0 0 16px;font-size:12.5px;color:#8b90a8">还有 ${rest} 件没列出来。</p>` : ""}
    <a href="${escapeHtml(tasksUrl)}"
       style="display:inline-block;background:#7dcfff;color:#16161e;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:999px">
      打开待办清单
    </a>
    <p style="margin:22px 0 0;font-size:11px;color:#6b7089;line-height:1.7">
      这封邮件由信息管家自动发送。想关掉的话：设置 → 邮件早报 → 关闭。
    </p>
  </div>
</body></html>`;

  return { subject, text: textLines.join("\n"), html };
}
