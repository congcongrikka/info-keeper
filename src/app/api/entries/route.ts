import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, jsonOk, rateLimit, requireUser } from "@/lib/api";
import { createEntry } from "@/lib/services/entries";
import { listEntries } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const createSchema = z.object({
  content: z.string().trim().min(1, "内容不能为空").max(20000, "单条记录不要超过 2 万字"),
  kind: z.enum(["idea", "note", "task", "link", "reference"]).nullish(),
  sourceUrl: z.string().trim().max(2000).nullish(),
  title: z.string().trim().max(120).nullish(),
  analyze: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const params = request.nextUrl.searchParams;
    const kind = params.get("kind");
    const status = params.get("status");

    const entries = await listEntries(supabase, {
      userId: user.id,
      q: params.get("q") ?? undefined,
      kind: kind === "idea" || kind === "note" || kind === "task" || kind === "link" || kind === "reference" ? kind : undefined,
      status:
        status === "inbox" || status === "active" || status === "done" || status === "archived"
          ? status
          : undefined,
      tag: params.get("tag") ?? undefined,
      limit: Number.parseInt(params.get("limit") ?? "60", 10) || 60,
    });

    return jsonOk({ entries });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    rateLimit(`entries:create:${user.id}`, 40, 60_000);

    const raw = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message ?? "请求参数不正确", 422, "invalid_input");
    }

    if (parsed.data.sourceUrl) {
      try {
        new URL(parsed.data.sourceUrl);
      } catch {
        throw new HttpError("链接格式不正确", 422, "invalid_url");
      }
    }

    const result = await createEntry(supabase, user.id, {
      content: parsed.data.content,
      kind: parsed.data.kind ?? null,
      sourceUrl: parsed.data.sourceUrl ?? null,
      title: parsed.data.title ?? null,
      analyze: parsed.data.analyze,
    });

    return jsonOk(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
