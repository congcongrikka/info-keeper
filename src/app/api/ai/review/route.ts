import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, jsonOk, rateLimit, requireUser } from "@/lib/api";
import { ENTRY_COLUMNS, listOpenTasks } from "@/lib/db";
import { hydrateEntry, normalizeReview } from "@/lib/ai/normalize";
import { buildReviewMessages } from "@/lib/ai/prompts";
import { complete, extractJson, isAiEnabled } from "@/lib/ai/provider";
import type { Entry, Review } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)]).default(7),
});

const PERIOD_LABEL: Record<number, string> = {
  7: "最近 7 天",
  30: "最近 30 天",
  90: "最近 90 天",
  0: "全部记录",
};

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    rateLimit(`ai:review:${user.id}`, 6, 60_000);

    if (!isAiEnabled()) {
      throw new HttpError("尚未配置大模型 API Key，无法生成总结", 503, "ai_not_configured");
    }

    const raw = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw ?? {});
    if (!parsed.success) throw new HttpError("时间范围不合法", 422, "invalid_input");
    const days = parsed.data.days;

    const end = new Date();
    const start = new Date(end.getTime() - (days === 0 ? 3650 : days) * 86400000);

    const { data, error } = await supabase
      .from("entries")
      .select(ENTRY_COLUMNS)
      .eq("user_id", user.id)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
      .order("created_at", { ascending: false })
      .limit(120);

    if (error) throw new HttpError(`读取记录失败：${error.message}`, 500, "query_failed");

    const entries: Entry[] = (data ?? []).map((row) => hydrateEntry(row as Record<string, unknown>));
    if (entries.length === 0) {
      throw new HttpError("这段时间还没有记录，先去记几条再回来总结吧", 422, "no_entries");
    }

    const openTasks = await listOpenTasks(supabase, user.id, 40);
    const messages = buildReviewMessages({
      entries,
      openTasks,
      periodLabel: PERIOD_LABEL[days] ?? `${days} 天`,
      now: end,
    });

    const { text, model } = await complete(messages, {
      json: true,
      temperature: 0.5,
      maxTokens: 2000,
      timeoutMs: 52000,
    });
    const payload = normalizeReview(extractJson(text));

    const { data: saved, error: saveError } = await supabase
      .from("reviews")
      .insert({
        user_id: user.id,
        period_start: start.toISOString(),
        period_end: end.toISOString(),
        entry_count: entries.length,
        title: payload.title,
        summary: payload.summary,
        themes: payload.themes,
        actions: payload.actions,
        open_loops: payload.open_loops,
        model,
      })
      .select("*")
      .single();

    if (saveError || !saved) {
      throw new HttpError(`保存总结失败：${saveError?.message ?? "未知错误"}`, 500, "save_failed");
    }

    const review: Review = {
      ...(saved as unknown as Review),
      themes: payload.themes,
      actions: payload.actions,
      open_loops: payload.open_loops,
    };

    return jsonOk({ review, open_loops: payload.open_loops });
  } catch (error) {
    return errorResponse(error);
  }
}
