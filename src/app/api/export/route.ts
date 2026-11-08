import { errorResponse, requireUser } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 1000;

/** Supabase 单次 select 默认最多返回 1000 行，导出必须翻页，否则数据会静默丢失 */
async function fetchAll<T>(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  table: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 10000; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`${table} 导出失败：${error.message}`);
    if (!data?.length) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

export async function GET() {
  try {
    const { supabase, user } = await requireUser();

    const [entries, links, reviews, profiles] = await Promise.all([
      fetchAll<Record<string, unknown>>(supabase, "entries"),
      fetchAll<Record<string, unknown>>(supabase, "entry_links"),
      fetchAll<Record<string, unknown>>(supabase, "reviews"),
      supabase.from("profiles").select("*").eq("id", user.id),
    ]);

    const payload = {
      app: "info-keeper",
      schema_version: 1,
      exported_at: new Date().toISOString(),
      account: { id: user.id, email: user.email ?? null },
      counts: {
        entries: entries.length,
        entry_links: links.length,
        reviews: reviews.length,
      },
      profile: profiles.data?.[0] ?? null,
      entries,
      entry_links: links,
      reviews,
    };

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="info-keeper-backup-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
