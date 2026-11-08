import type { NextRequest } from "next/server";
import { errorResponse, HttpError, jsonOk, rateLimit, requireUser } from "@/lib/api";
import { listOpenTasks } from "@/lib/db";
import { normalizeTaskPlan, type TaskPlan } from "@/lib/ai/normalize";
import { buildTaskPlanMessages } from "@/lib/ai/prompts";
import { complete, extractJson, isAiEnabled } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const EMPTY_PLAN: TaskPlan = {
  today: [],
  this_week: [],
  later: [],
  blocked: [],
  drop_candidates: [],
  note: "还没有待办。把要做的事按「明天下午给张三发方案」这样的完整句子记下来就行。",
};

export async function POST(_request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    rateLimit(`ai:tasks:${user.id}`, 10, 60_000);

    const tasks = await listOpenTasks(supabase, user.id, 50);
    if (tasks.length === 0) {
      return jsonOk({ plan: EMPTY_PLAN, task_count: 0 });
    }

    if (!isAiEnabled()) {
      throw new HttpError("尚未配置大模型 API Key，无法整理待办", 503, "ai_not_configured");
    }

    const { text } = await complete(buildTaskPlanMessages({ tasks }), {
      json: true,
      temperature: 0.3,
      maxTokens: 1200,
    });

    const plan = normalizeTaskPlan(extractJson(text));
    return jsonOk({ plan, task_count: tasks.length });
  } catch (error) {
    return errorResponse(error);
  }
}
