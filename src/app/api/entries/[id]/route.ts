import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, jsonOk, requireUser } from "@/lib/api";
import { ENTRY_COLUMNS } from "@/lib/db";
import { hydrateEntry } from "@/lib/ai/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z
  .object({
    title: z.string().trim().max(120).nullish(),
    content: z.string().trim().min(1).max(20000).optional(),
    kind: z.enum(["idea", "note", "task", "link", "reference"]).optional(),
    status: z.enum(["inbox", "active", "done", "archived"]).optional(),
    tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
    priority: z.number().int().min(1).max(3).optional(),
    due_at: z.string().trim().max(40).nullish(),
  })
  .strict();

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser();
    const { id } = await context.params;
    if (!UUID_RE.test(id)) throw new HttpError("条目 ID 不合法", 422, "invalid_id");

    const raw = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message ?? "请求参数不正确", 422, "invalid_input");
    }
    if (Object.keys(parsed.data).length === 0) {
      throw new HttpError("没有需要更新的字段", 422, "empty_patch");
    }

    const patch: Record<string, unknown> = { ...parsed.data };
    // 空字符串统一转成 null：前端会退回用正文首行展示
    if (patch.title === "") patch.title = null;
    if (typeof patch.due_at === "string") {
      const date = new Date(patch.due_at);
      if (Number.isNaN(date.getTime())) throw new HttpError("截止时间格式不正确", 422, "invalid_due_at");
      patch.due_at = date.toISOString();
    }
    if (patch.due_at === null) {
      patch.due_at = null;
    }

    const { data, error } = await supabase
      .from("entries")
      .update(patch)
      .eq("id", id)
      .eq("user_id", user.id)
      .select(ENTRY_COLUMNS)
      .maybeSingle();

    if (error) throw new HttpError(`更新失败：${error.message}`, 500, "update_failed");
    if (!data) throw new HttpError("条目不存在或无权访问", 404, "not_found");

    return jsonOk({ entry: hydrateEntry(data as Record<string, unknown>) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser();
    const { id } = await context.params;
    if (!UUID_RE.test(id)) throw new HttpError("条目 ID 不合法", 422, "invalid_id");

    const { error } = await supabase.from("entries").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw new HttpError(`删除失败：${error.message}`, 500, "delete_failed");

    return jsonOk({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
