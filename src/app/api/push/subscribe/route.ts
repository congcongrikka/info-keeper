import { z } from "zod";
import { errorResponse, HttpError, jsonOk, rateLimit, requireUser } from "@/lib/api";
import { isPushConfigured } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 一个账号最多留这么多条订阅（= 这么多台设备/浏览器）。超了让用户先关掉旧设备。 */
const MAX_SUBSCRIPTIONS_PER_USER = 20;

/**
 * 浏览器 PushSubscription 的 JSON 形状：
 *   { endpoint, expirationTime, keys: { p256dh, auth } }
 *
 * 这里不收 expirationTime —— 它是浏览器给的提示，可能为 null，
 * 判断订阅是否还有效应该以推送服务返回的 404/410 为准（见 src/lib/push.ts）。
 */
const subscribeSchema = z.object({
  endpoint: z.string().trim().min(1, "缺少 endpoint").max(2048, "endpoint 过长"),
  keys: z.object({
    p256dh: z.string().trim().min(1, "缺少 p256dh").max(512, "p256dh 过长"),
    auth: z.string().trim().min(1, "缺少 auth").max(512, "auth 过长"),
  }),
});

/** 推送端点一定是 https（本地调试 localhost 也是 http，但 Supabase/Vercel 上不会），兜底挡一下乱塞的 URL。 */
function assertHttpEndpoint(endpoint: string) {
  if (!/^https?:\/\//i.test(endpoint)) {
    throw new HttpError("endpoint 不是合法的推送地址。", 422, "invalid_input");
  }
}

/**
 * POST /api/push/subscribe
 * 保存（或刷新）当前浏览器的一条推送订阅。
 *
 * 幂等：同一台设备重复点「开启」会走 upsert 更新 endpoint 那一行，
 * 不会因为唯一约束报错，也不会产生重复推送。
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();

    rateLimit(`push:subscribe:${user.id}`, 20, 60_000);

    if (!isPushConfigured()) {
      throw new HttpError(
        "服务端还没配置 VAPID 密钥，现在开启只会失败。请先在环境变量里配好 VAPID_PRIVATE_KEY。",
        503,
        "push_disabled",
      );
    }

    const raw = await request.json().catch(() => null);
    const parsed = subscribeSchema.safeParse(raw);

    if (!parsed.success) {
      throw new HttpError(
        parsed.error.issues[0]?.message ?? "请求参数不正确",
        422,
        "invalid_input",
      );
    }

    const { endpoint, keys } = parsed.data;
    assertHttpEndpoint(endpoint);

    // 只数「别的设备」，本机重复开启（endpoint 已存在）不该被上限挡住
    const { count, error: countError } = await supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .neq("endpoint", endpoint);

    if (countError) {
      console.error("[push] count subscriptions failed", countError);
      throw new HttpError("读取订阅数量失败，请稍后重试。", 500, "db_error");
    }

    if ((count ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) {
      throw new HttpError(
        `已经登记了 ${MAX_SUBSCRIPTIONS_PER_USER} 台设备，请先在旧设备上关闭提醒。`,
        409,
        "too_many_subscriptions",
      );
    }

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        // 只用来排查问题，不参与业务逻辑
        user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
      { onConflict: "endpoint" },
    );

    if (error) {
      console.error("[push] upsert subscription failed", error);
      throw new HttpError("保存订阅失败，请稍后重试。", 500, "db_error");
    }

    return jsonOk({ ok: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/push/subscribe
 * 关闭提醒：删掉当前设备这一条订阅。
 *
 * 必须用 DELETE 而不是让浏览器 unsubscribe 就算了 —— 只在前端取消，
 * 服务端库里还留着这条，定时任务照样会给它发，白白攒一堆 410。
 */
export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();

    rateLimit(`push:unsubscribe:${user.id}`, 20, 60_000);

    const raw = await request.json().catch(() => null);
    const parsed = z
      .object({ endpoint: z.string().trim().min(1).max(2048) })
      .safeParse(raw);

    if (!parsed.success) {
      throw new HttpError("缺少要取消的 endpoint。", 422, "invalid_input");
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      // 双保险：RLS 已经限定了 auth.uid() = user_id，这里再显式写一次
      //（见 src/lib/db.ts 顶部「多用户隔离的两道锁」）
      .eq("user_id", user.id)
      .eq("endpoint", parsed.data.endpoint);

    if (error) {
      console.error("[push] delete subscription failed", error);
      throw new HttpError("取消订阅失败，请稍后重试。", 500, "db_error");
    }

    return jsonOk({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
