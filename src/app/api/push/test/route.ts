import { errorResponse, HttpError, jsonOk, rateLimit, requireUser } from "@/lib/api";
import { buildDailyReminderPayload, getVapidConfig, sendPush } from "@/lib/push";
import { getStats } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 一个账号的订阅通常只有一两条，给个别留几十条的账号兜个上限 */
const MAX_TEST_SUBSCRIPTIONS = 10;

/**
 * POST /api/push/test
 * 给当前用户自己的所有设备发一条测试通知。
 *
 * 为什么需要它：推送是「装上去之后当天可能一辈子等不到」的功能，
 * 用户点完「开启」后除了等第二天早上 8:00 没有任何反馈渠道 ——
 * 一旦中间哪一步（VAPID、订阅落库、系统通知开关）出问题，用户根本无从判断。
 * 这个接口把整条链路一次性走完：读库里的订阅 → 真实调用推送服务 → 回报结果。
 *
 * 只发给自己：用 requireUser 的会话客户端读订阅，RLS 会把范围锁死在本人的行，
 * 不碰 service_role，避免测试接口顺带具备「给任意人发通知」的能力。
 */
export async function POST() {
  try {
    const { supabase, user } = await requireUser();

    // 测试通知很轻，但别让人拿去刷推送服务的配额
    rateLimit(`push:test:${user.id}`, 5, 60_000);

    if (!getVapidConfig()) {
      throw new HttpError("服务端还没配置 VAPID 密钥，发不了测试通知。", 503, "push_disabled");
    }

    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", user.id)
      // 只测最近登记的设备，避免一次撑爆通知栏
      .order("created_at", { ascending: false })
      .limit(MAX_TEST_SUBSCRIPTIONS);

    if (error) {
      console.error("[push] load subscriptions for test failed", error);
      throw new HttpError("读取订阅失败，请稍后重试。", 500, "db_error");
    }

    const rows = data ?? [];

    if (rows.length === 0) {
      return jsonOk({
        sent: 0,
        failed: 0,
        detail: "数据库里没有这台设备的订阅记录，说明「开启」那一步没保存成功。先关掉提醒再重新开启一次。",
      });
    }

    // 测试通知里放真实待办数，顺便验证「按用户取数」这条路也是通的
    const stats = await getStats(supabase, user.id).catch(() => null);
    const payload = buildDailyReminderPayload(stats?.openTasks ?? 1);

    let sent = 0;
    let failed = 0;
    let firstError: string | null = null;
    const expiredIds: string[] = [];

    for (const row of rows) {
      const outcome = await sendPush(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        payload,
      );

      if (outcome.ok) {
        sent += 1;
      } else {
        failed += 1;
        firstError ??= outcome.statusCode
          ? `${outcome.statusCode}：${outcome.reason}`
          : outcome.reason;
        if (outcome.permanent) expiredIds.push(row.id);
      }
    }

    // 顺手清理彻底失效的订阅，和定时任务的处理保持一致
    if (expiredIds.length > 0) {
      const { error: pruneError } = await supabase
        .from("push_subscriptions")
        .delete()
        .eq("user_id", user.id)
        .in("id", expiredIds);

      if (pruneError) {
        console.error("[push] prune expired subscriptions failed", pruneError);
      }
    }

    return jsonOk({
      sent,
      failed,
      detail:
        sent === 0 && firstError
          ? `推送服务拒绝了这条通知：${firstError}`
          : expiredIds.length > 0
            ? `已发出 ${sent} 条；另有 ${expiredIds.length} 条订阅已失效并清理，重新开启提醒即可恢复。`
            : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
