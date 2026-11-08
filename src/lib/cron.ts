import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { HttpError } from "@/lib/api";

/**
 * 定时任务的调用方校验。
 *
 * 这个接口没有登录用户（Vercel Cron 不会带 cookie），如果放着不管，
 * 任何人访问一次就能给全体用户刷一条推送 —— 既是骚扰，也会烧掉推送配额。
 * 所以要求请求头带 `Authorization: Bearer <CRON_SECRET>`。
 *
 * 没配 CRON_SECRET 时**拒绝执行**（503）而不是放行：
 * 宁可早报停一天，也不能让接口裸奔。本地想手动跑一次，就在 .env.local 里随便设一个值。
 */

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** 常量时间比较：长度不同时也要走完一次比较，避免提前返回泄露长度信息（同 src/lib/invite.ts）。 */
function safeEqual(expected: string, provided: string): boolean {
  const expectedDigest = digest(expected);
  const providedDigest = digest(provided);
  return timingSafeEqual(expectedDigest, providedDigest) && provided.length === expected.length;
}

export function isCronConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET);
}

export function verifyCronSecret(request: NextRequest): void {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    throw new HttpError(
      "服务端未配置 CRON_SECRET，定时推送已停用。请在环境变量里补上后再试。",
      503,
      "cron_disabled",
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const provided = match?.[1]?.trim() ?? "";

  if (!provided || !safeEqual(expected, provided)) {
    throw new HttpError("无权调用该接口。", 401, "unauthorized");
  }
}
