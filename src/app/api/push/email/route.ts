import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, jsonOk, rateLimit, requireUser } from "@/lib/api";
import { buildDigestEmail, getSiteUrl, isEmailConfigured, sendEmail, type DigestTask } from "@/lib/email";
import { listOpenTasks } from "@/lib/db";

export const runtime = "nodejs";
// 发一封邮件要等 SMTP 握手 + 投递，60s 是小邮件服务器能容忍的上限
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  enabled: z.boolean(),
});

interface ProfileRow {
  digest_enabled: boolean | null;
}

/** 把待办行收敛成邮件里要用的最小结构。 */
function toDigestTasks(rows: { title: string | null; content: string; priority: number | null }[]): DigestTask[] {
  return rows.map((row) => ({
    // title 可能为空（见 schema 里的 entries_title_or_content 约束），退回正文首行
    title: (row.title ?? row.content.split("\n")[0] ?? "（无标题）").trim() || "（无标题）",
    priority: row.priority ?? 2,
  }));
}

/**
 * GET /api/push/email
 *
 * 返回当前用户的邮件早报状态，供设置页渲染开关。
 * 顺带把「服务端有没有配 SMTP」告诉前端 —— 没配时按钮要置灰，而不是点了才报错。
 */
export async function GET() {
  try {
    const { supabase, user } = await requireUser();

    const { data, error } = await supabase
      .from("profiles")
      .select("digest_enabled")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[email] read profile failed", error);
      throw new HttpError("读取邮件早报设置失败。", 500, "db_error");
    }

    const row = data as ProfileRow | null;

    return jsonOk({
      enabled: Boolean(row?.digest_enabled),
      configured: isEmailConfigured(),
      email: user.email ?? "",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * PUT /api/push/email
 *
 * 开关邮件早报。body: { enabled: boolean }
 *
 * 为什么要 profiles 而不是新建一张表：邮件早报是「一人一个偏好」，
 * 不是「一人多条订阅」，硬塞进 push_subscriptions 会破坏那表的语义。
 * profiles 每用户一行，正好。
 */
export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    rateLimit(`email:digest:${user.id}`, 20, 60_000);

    if (!user.email) {
      throw new HttpError("当前账号没有邮箱，无法接收邮件早报。", 400, "no_email");
    }

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message ?? "请求参数不正确", 422, "invalid_input");
    }

    if (parsed.data.enabled && !isEmailConfigured()) {
      throw new HttpError(
        "服务端还没有配置发信账号（SMTP），暂时开不了邮件早报。",
        503,
        "email_disabled",
      );
    }

    // upsert 而不是 update：profiles 正常由触发器建好，但历史上可能有缺失的行，
    // 用 update 会静默改 0 行，用户以为开了其实没开。
    const { error } = await supabase
      .from("profiles")
      .upsert(
        { id: user.id, digest_enabled: parsed.data.enabled },
        { onConflict: "id" },
      );

    if (error) {
      console.error("[email] update digest_enabled failed", error);
      throw new HttpError("保存邮件早报设置失败。", 500, "db_error");
    }

    return jsonOk({ enabled: parsed.data.enabled });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/push/email
 *
 * 立刻发一封试用邮件。开启只写库、不会马上发信，
 * 用户没法确认配置对不对，所以给一个当场验证的入口。
 */
export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    rateLimit(`email:test:${user.id}`, 3, 60_000);

    if (!user.email) {
      throw new HttpError("当前账号没有邮箱，无法发送测试邮件。", 400, "no_email");
    }

    if (!isEmailConfigured()) {
      throw new HttpError("服务端还没有配置发信账号（SMTP）。", 503, "email_disabled");
    }

    const tasks = await listOpenTasks(supabase, user.id, 20);
    const digestTasks = toDigestTasks(tasks as { title: string | null; content: string; priority: number | null }[]);

    // 没有待办也照样发一封，内容是「今天没有待办」——测试通道是否好用时，
    // 不该因为恰好没待办而让人以为邮件功能坏了。
    const content =
      digestTasks.length > 0
        ? buildDigestEmail(digestTasks.length, digestTasks, getSiteUrl())
        : {
            subject: "信息管家 · 测试邮件",
            text: `这封是测试邮件。链路是通的。\n\n现在待办清单是空的，所以正式早报今天不会发。\n\n—— 信息管家`,
            html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px 16px;background:#16161e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#1e1e2e;border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:24px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;color:#7aa2f7">信息管家 · 每日早报</p>
    <h1 style="margin:0 0 12px;font-size:19px;line-height:1.5;color:#e6e9f5;font-weight:600">测试邮件：链路是通的</h1>
    <p style="margin:0;font-size:13px;line-height:1.7;color:#8b90a8">
      现在待办清单是空的，所以正式早报今天不会发。等你有了待办，每天早上就会收到一封。
    </p>
  </div>
</body></html>`,
          };

    const outcome = await sendEmail({
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });

    if (!outcome.ok) {
      // 投递失败也返回 200 还是 500？这里选 500 —— 前端要能区分「发出去了」和「没发出去」，
      // 200 + ok:false 太容易被当成成功。
      throw new HttpError(`发送失败：${outcome.reason}`, 500, "send_failed");
    }

    return NextResponse.json({ ok: true, to: user.email });
  } catch (error) {
    return errorResponse(error);
  }
}
