import * as webpush from "web-push";

/**
 * Web Push 发送层。
 *
 * 只有服务端能 import（web-push 依赖 node:crypto 和 node:https）。
 * 浏览器侧拿到的是 NEXT_PUBLIC_VAPID_PUBLIC_KEY，私钥永远不进前端 bundle。
 */

/** 一条订阅 = 一台设备上的一个浏览器。端点是唯一标识，user_id 会有多条。 */
export interface PushTarget {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * VAPID subject：推送服务用它在你把推送基础设施用坏时联系你。
 * 规范要求是 https: URL 或 mailto:，Apple / FCM 会校验格式（不校验是否真实可达）。
 */
const DEFAULT_SUBJECT = "mailto:info-keeper@example.com";

/** 两个 VAPID 变量都配了才算可用。公开 key 是 NEXT_PUBLIC_ 前缀，构建时就注入。 */
export function isPushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) return null;

  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT?.trim() || DEFAULT_SUBJECT,
  };
}

let vapidReady = false;

/**
 * 把密钥注册成 web-push 的全局默认值（进程内只做一次）。
 * 没配置时抛错，由调用方转成 503 —— 不静默失败，否则定时任务会「成功」但一条都没发。
 */
function ensureVapid(): VapidConfig {
  const config = getVapidConfig();

  if (!config) {
    throw new Error(
      "缺少 VAPID 密钥。\n" +
        "生成：npx web-push generate-vapid-keys\n" +
        "本地：写进 .env.local；线上：Vercel → Settings → Environment Variables 配置 " +
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT。",
    );
  }

  if (!vapidReady) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    vapidReady = true;
  }

  return config;
}

export type PushOutcome =
  | { ok: true }
  /** permanent = 订阅已失效（404/410），应该从库里删掉，别再重试 */
  | { ok: false; permanent: boolean; statusCode: number | null; reason: string };

/**
 * 发一条推送。
 *
 * 错误分两类：
 *   - 410 Gone / 404 Not Found：端点被浏览器或推送服务回收（用户卸载了 PWA、清了站点数据、换了设备）。
 *     这类订阅**永远发不成功**，必须删库，否则会一直失败、还拖慢整批发送。
 *   - 其余（网络抖动、429 限流、5xx、413 payload 过大）：保留订阅，下次再试。
 */
export async function sendPush(target: PushTarget, payload: string): Promise<PushOutcome> {
  ensureVapid();

  const subscription: webpush.PushSubscription = {
    endpoint: target.endpoint,
    keys: { p256dh: target.keys.p256dh, auth: target.keys.auth },
  };

  try {
    await webpush.sendNotification(subscription, payload, {
      // 早报过期就没意义了：6 小时后还没投递到设备就丢掉，别在中午突然弹「早上好」
      TTL: 6 * 60 * 60,
      // 设备省电时也尽量立刻送达
      urgency: "high",
      // 同一天只保留一条，避免重试时刷屏
      topic: "daily-reminder",
      // 单条请求超时，避免一个卡死的端点拖住整批
      timeout: 10_000,
    });

    return { ok: true };
  } catch (error) {
    const statusCode = extractStatusCode(error);
    const permanent = statusCode === 404 || statusCode === 410;

    return {
      ok: false,
      permanent,
      statusCode,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * web-push 对非 2xx 抛 WebPushError（带 statusCode）；
 * 参数校验失败等抛普通 Error（没有 statusCode）。用鸭子类型判断，避免 instanceof 在打包后失效。
 */
function extractStatusCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const value = (error as { statusCode: unknown }).statusCode;
    if (typeof value === "number") return value;
  }
  return null;
}

/** 通知文案：与 sw.js 的解析逻辑、以及产品需求里那句「早上好！你今天有 X 件待办需要处理，点击查看。」对齐。 */
export function buildDailyReminderPayload(taskCount: number): string {
  const count = Math.max(1, Math.floor(taskCount));

  return JSON.stringify({
    title: "信息管家 · 每日早报",
    body: `早上好！你今天有 ${count} 件待办需要处理，点击查看。`,
    url: "/tasks",
    tag: "daily-reminder",
  });
}

export interface PushJob {
  target: PushTarget;
  payload: string;
}

/**
 * 分批并发发送。
 *
 * 为什么不是一次 Promise.all：几百条同时发会打开几百个 socket，
 * 既容易撞到 Vercel 的并发/连接限制，也可能被推送服务按 IP 限流（429）。
 * 所以切成小批次顺序推进，每批内部并发。
 *
 * 每条任务自带 payload —— 早报的文案里有各自的待办数量，不能合成一条群发。
 */
export async function sendPushBatch(jobs: PushJob[], batchSize = 20): Promise<PushOutcome[]> {
  const results: PushOutcome[] = [];

  for (let index = 0; index < jobs.length; index += batchSize) {
    const slice = jobs.slice(index, index + batchSize);
    const settled = await Promise.all(slice.map((job) => sendPush(job.target, job.payload)));
    results.push(...settled);
  }

  return results;
}
