import type { NextRequest } from "next/server";
import { errorResponse, HttpError, jsonOk } from "@/lib/api";
import { verifyCronSecret } from "@/lib/cron";
import {
  buildDigestEmail,
  getSiteUrl,
  isEmailConfigured,
  sendEmailBatch,
  type DigestTask,
  type EmailMessage,
} from "@/lib/email";
import { buildDailyReminderPayload, getVapidConfig, sendPushBatch, type PushJob } from "@/lib/push";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";
// 一轮要查库 + 发几百条推送/邮件。60s 是 Vercel Hobby 的上限，Pro 可以按需调大。
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** 每次从库里取多少条订阅来发。分页是为了不把几万条订阅一次读进内存。 */
const SUBSCRIPTION_PAGE = 500;

/**
 * 一次按多少个 user_id 过滤。
 * PostgREST 的 in(...) 是拼在 URL 查询串里的，用户多了会超过 URL 长度上限，
 * 所以要切块（80 个 UUID ≈ 3 KB，安全）。
 */
const USER_ID_CHUNK = 80;

/** 邮件里列多少条待办。再多就没人看了，剩下的用「还有 N 件」带过。 */
const DIGEST_TASK_PREVIEW = 10;

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PendingCountRow {
  user_id: string;
  task_count: number | string;
}

interface RecipientRow {
  user_id: string;
  email: string | null;
}

interface TaskRow {
  user_id: string;
  title: string | null;
  content: string;
  priority: number | null;
}

export interface CronSummary {
  /** 这一轮有多少用户有待办 */
  usersWithTasks: number;
  /** 其中有多少人开着 Web Push 订阅 */
  subscribedUsers: number;
  /** 实际发送的推送条数（= 订阅数，一个人多台设备就是多条） */
  sent: number;
  /** 推送失败但订阅保留（网络抖动/限流/服务端错误），下次再试 */
  failed: number;
  /** 订阅已失效（404/410），这一轮顺手删掉的条数 */
  pruned: number;
  /** 删除失效订阅时出错的条数 */
  pruneFailed: number;
  skipped: number;
  /** 开启了邮件早报、且这一轮确实有邮件要发的人数 */
  emailRecipients: number;
  /** 邮件发送成功数 */
  emailSent: number;
  /** 邮件发送失败数 */
  emailFailed: number;
  /** 这一轮用了哪些通道（push / email），方便在 Vercel 日志里一眼看出跑的是哪条路 */
  channels: string[];
  durationMs: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/** title 可能为空（schema 只要求 title/content 至少有一个），退回正文第一行。 */
function digestTitle(row: TaskRow): string {
  const raw = (row.title ?? row.content.split("\n")[0] ?? "").trim();
  return raw || "（无标题）";
}

/**
 * 取这些用户各自的待办标题，用于邮件正文。
 * 只取前 DIGEST_TASK_PREVIEW 条不够用 —— PostgREST 没有「每个用户各取 N 条」的写法，
 * 所以按用户分块拉，然后在内存里按 user_id 分组截断。
 */
async function loadDigestTasks(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[],
): Promise<Map<string, DigestTask[]>> {
  const byUser = new Map<string, DigestTask[]>();

  for (const userIdChunk of chunk(userIds, USER_ID_CHUNK)) {
    const { data, error } = await admin
      .from("entries")
      .select("user_id, title, content, priority")
      .in("user_id", userIdChunk)
      .eq("kind", "task")
      .in("status", ["inbox", "active"])
      // 优先级数字小的更重要（1 最高），其次是新加的
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      // 42501 = 权限不足。service_role 能绕过 RLS，但表级 GRANT 照样要。
      // 邮件正文会退化成「只有数字、没有标题」，不至于发不出去，所以只记日志不抛。
      if (error.code === "42501") {
        console.error(
          "[cron] load digest tasks failed: service_role 没有 entries 表的 SELECT 权限，" +
            "请在 Supabase SQL Editor 执行 supabase/fix-service-role-grant.sql",
          error,
        );
      } else {
        console.error("[cron] load digest tasks failed", error);
      }
      continue;
    }

    for (const row of (data ?? []) as TaskRow[]) {
      const list = byUser.get(row.user_id) ?? [];
      if (list.length >= DIGEST_TASK_PREVIEW) continue;
      list.push({ title: digestTitle(row), priority: row.priority ?? 2 });
      byUser.set(row.user_id, list);
    }
  }

  return byUser;
}

/**
 * GET /api/cron/daily-reminder
 *
 * Vercel Cron 每天早上 8:00（北京时间）= 每天 00:00 UTC 调用一次（见 vercel.json）。
 *
 * 两条通道，谁配好了走谁，都配好就都走：
 *   - Web Push：桌面 Edge / 装了 Google 服务的安卓 / iOS 主屏 PWA
 *   - 邮件：安卓国行这类收不到 FCM 推送的设备，靠邮箱兜底
 *
 * 流程：
 *   1. 校验 CRON_SECRET（没有它会变成一个人人可刷的群发接口）
 *   2. 用 service_role 客户端跨用户查数据 —— 定时任务没有登录用户，
 *      RLS 会把它当成匿名，什么都查不到
 *   3. public.pending_task_counts() 一次拿到「谁有几件待办」，避免逐用户 N+1 查询
 *   4. 推送：分页 + 分块取订阅，按人分别组装文案，分批并发发送；404/410 当场删库
 *   5. 邮件：public.digest_recipients() 拿到「开了邮件早报的人 + 邮箱」，逐人发
 *
 * 一个有待办的用户都没有时也正常返回 200，让 Vercel 的 cron 记录保持干净。
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();

  try {
    verifyCronSecret(request);

    if (!isAdminConfigured()) {
      throw new HttpError(
        "缺少 SUPABASE_SERVICE_ROLE_KEY，定时任务无法跨用户查询。",
        503,
        "cron_disabled",
      );
    }

    const vapid = getVapidConfig();
    const emailReady = isEmailConfigured();

    // 两条通道都没配就没必要跑下去了 —— 但这是「没配置」不是「出错」，用 503 让监控看得出来。
    if (!vapid && !emailReady) {
      throw new HttpError(
        "推送和邮件两条通道都没配置。至少要配 VAPID 密钥或 SMTP 账号，否则早上什么也发不出去。",
        503,
        "push_disabled",
      );
    }

    const admin = createAdminClient();

    const { data: counts, error: countsError } = await admin.rpc("pending_task_counts");

    if (countsError) {
      console.error("[cron] pending_task_counts failed", countsError);
      throw new HttpError("统计待办数量失败。", 500, "db_error");
    }

    /** user_id -> 待办数量 */
    const taskCounts = new Map<string, number>();

    for (const row of (counts ?? []) as PendingCountRow[]) {
      const count = Number(row.task_count);
      if (Number.isFinite(count) && count > 0) {
        taskCounts.set(row.user_id, count);
      }
    }

    const summary: CronSummary = {
      usersWithTasks: taskCounts.size,
      subscribedUsers: 0,
      sent: 0,
      failed: 0,
      pruned: 0,
      pruneFailed: 0,
      skipped: 0,
      emailRecipients: 0,
      emailSent: 0,
      emailFailed: 0,
      channels: [],
      durationMs: 0,
    };

    if (vapid) summary.channels.push("push");
    if (emailReady) summary.channels.push("email");

    if (taskCounts.size === 0) {
      summary.durationMs = Date.now() - startedAt;
      return jsonOk(summary);
    }

    // ── 通道一：Web Push ────────────────────────────────────────────────
    if (vapid) {
      const subscribedUsers = new Set<string>();
      const expiredIds: string[] = [];

      for (const userIdChunk of chunk([...taskCounts.keys()], USER_ID_CHUNK)) {
        let offset = 0;

        for (;;) {
          const { data, error } = await admin
            .from("push_subscriptions")
            .select("id, user_id, endpoint, p256dh, auth")
            .in("user_id", userIdChunk)
            .order("user_id", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + SUBSCRIPTION_PAGE - 1);

          if (error) {
            console.error("[cron] load subscriptions failed", error);
            // 42501 = 权限不足。最常见的成因是建库时漏了对 service_role 的表授权，
            // 报错里那句 hint 就是可以直接拿去跑的 GRANT 语句，原样透出来省得翻日志。
            if (error.code === "42501") {
              throw new HttpError(
                "定时任务没有读取 push_subscriptions 的权限。请在 Supabase SQL Editor 执行建表脚本末尾的 grant 语句。",
                500,
                "db_error",
              );
            }
            throw new HttpError("读取推送订阅失败。", 500, "db_error");
          }

          const rows = (data ?? []) as SubscriptionRow[];
          if (rows.length === 0) break;

          // 一条订阅一条 payload：文案里有各自的待办数量，不能合成一条群发
          const pending: { row: SubscriptionRow; job: PushJob }[] = [];

          for (const row of rows) {
            const taskCount = taskCounts.get(row.user_id);
            if (!taskCount) {
              // 理论上不会发生（订阅是按 user_id 过滤出来的），防御性跳过
              summary.skipped += 1;
              continue;
            }

            subscribedUsers.add(row.user_id);
            pending.push({
              row,
              job: {
                target: {
                  endpoint: row.endpoint,
                  keys: { p256dh: row.p256dh, auth: row.auth },
                },
                payload: buildDailyReminderPayload(taskCount),
              },
            });
          }

          const outcomes = await sendPushBatch(pending.map((item) => item.job));

          outcomes.forEach((outcome, index) => {
            if (outcome.ok) {
              summary.sent += 1;
              return;
            }

            summary.failed += 1;

            if (outcome.permanent) {
              const item = pending[index];
              if (item) expiredIds.push(item.row.id);
            }
          });

          if (rows.length < SUBSCRIPTION_PAGE) break;
          offset += SUBSCRIPTION_PAGE;
        }
      }

      summary.subscribedUsers = subscribedUsers.size;

      // 失效订阅集中删除：一条 delete + in(...) 比逐条删省得多。
      // 但 in(...) 同样是拼进 URL 的，一次几百个 UUID 会把 URL 撑爆，所以照样切块。
      for (const idChunk of chunk(expiredIds, USER_ID_CHUNK)) {
        const { error: pruneError } = await admin
          .from("push_subscriptions")
          .delete()
          .in("id", idChunk);

        if (pruneError) {
          console.error("[cron] prune expired subscriptions failed", pruneError);
          summary.pruneFailed += idChunk.length;
        } else {
          summary.pruned += idChunk.length;
        }
      }
    }

    // ── 通道二：邮件早报 ────────────────────────────────────────────────
    if (emailReady) {
      const { data: recipients, error: recipientsError } = await admin.rpc("digest_recipients");

      if (recipientsError) {
        console.error("[cron] digest_recipients failed", recipientsError);
        // 邮件通道挂了不应该让整轮 cron 失败 —— 推送已经发出去了，抛错反而会让
        // Vercel 把这轮标记成失败、下次还报警。这里只记日志，不增加 emailFailed
        // （那个字段统计的是「收件人确定、但投递失败」的条数）。
      } else {
        const siteUrl = getSiteUrl();

        // 只给「有待办」的人发：没待办的人不该被叫醒
        const targets = ((recipients ?? []) as RecipientRow[]).filter((row) => {
          const count = taskCounts.get(row.user_id);
          return Boolean(row.email) && Boolean(count && count > 0);
        });

        summary.emailRecipients = targets.length;

        if (targets.length > 0) {
          const tasksByUser = await loadDigestTasks(
            admin,
            targets.map((row) => row.user_id),
          );

          const messages: { userId: string; message: EmailMessage }[] = [];

          for (const row of targets) {
            const email = row.email;
            const taskCount = taskCounts.get(row.user_id) ?? 0;
            if (!email || taskCount <= 0) continue;

            const tasks = tasksByUser.get(row.user_id) ?? [];
            const content = buildDigestEmail(taskCount, tasks, siteUrl);

            messages.push({
              userId: row.user_id,
              message: {
                to: email,
                subject: content.subject,
                text: content.text,
                html: content.html,
              },
            });
          }

          const outcomes = await sendEmailBatch(messages.map((item) => item.message));

          outcomes.forEach((outcome, index) => {
            if (outcome.ok) {
              summary.emailSent += 1;
              return;
            }
            summary.emailFailed += 1;
            const item = messages[index];
            console.error("[cron] digest email failed", {
              userId: item?.userId,
              reason: outcome.reason,
              permanent: outcome.permanent,
            });
          });
        }
      }
    }

    summary.durationMs = Date.now() - startedAt;

    return jsonOk(summary);
  } catch (error) {
    return errorResponse(error);
  }
}
