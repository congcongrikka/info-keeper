import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, jsonOk, rateLimit, requireUser } from "@/lib/api";
import { getEntry, listRelated } from "@/lib/db";
import { analyzeEntry, extractKeyPoints } from "@/lib/services/entries";
import { isAiEnabled } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  mode: z.enum(["full", "points"]).default("full"),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser();
    const { id } = await context.params;
    if (!UUID_RE.test(id)) throw new HttpError("条目 ID 不合法", 422, "invalid_id");

    if (!isAiEnabled()) {
      throw new HttpError("尚未配置大模型 API Key，无法使用 AI 功能", 503, "ai_not_configured");
    }

    rateLimit(`entries:analyze:${user.id}`, 20, 60_000);

    const raw = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw ?? {});
    if (!parsed.success) throw new HttpError("参数不正确", 422, "invalid_input");
    const { mode } = parsed.data;

    const entry = await getEntry(supabase, id, user.id);
    if (!entry) throw new HttpError("条目不存在或无权访问", 404, "not_found");

    if (mode === "points") {
      const result = await extractKeyPoints(supabase, user.id, entry);
      return jsonOk(result);
    }

    const result = await analyzeEntry(supabase, user.id, entry, null);
    const related = await listRelated(supabase, id, user.id);
    return jsonOk({ entry: result.entry, analysis: result.analysis, related });
  } catch (error) {
    return errorResponse(error);
  }
}
