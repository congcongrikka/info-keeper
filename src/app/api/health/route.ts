import { NextResponse } from "next/server";
import { isAiEnabled } from "@/lib/ai/provider";
import { hasSupabaseEnv } from "@/lib/env";
import { isPushConfigured } from "@/lib/push";
import { isCronConfigured } from "@/lib/cron";
import { isEmailConfigured } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    supabase: hasSupabaseEnv() ? "configured" : "missing",
    ai: isAiEnabled() ? "enabled" : "disabled",
    // 推送相关：排查「按钮点了没反应」时先看这里
    push: isPushConfigured() ? "configured" : "missing",
    cron: isCronConfigured() ? "configured" : "missing",
    // 邮件早报：没配 SMTP 时设置页的「邮件早报」卡片会置灰
    email: isEmailConfigured() ? "configured" : "missing",
    // 方便肉眼确认线上跑的是哪一版（排查「改了怎么没生效」）：
    // 有 git 关联时给 commit 短 sha，否则退回平台注入的部署 id，本地跑给 local。
    build:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
      process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 12) ||
      "local",
  });
}
