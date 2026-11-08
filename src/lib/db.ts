import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entry, EntryKind, EntryStatus, RelatedEntry, Review } from "@/lib/types";
import { hydrateEntry } from "@/lib/ai/normalize";
import { extractTerms } from "@/lib/search";

/**
 * 数据访问层。
 *
 * ── 多用户隔离的两道锁 ───────────────────────────────────────────
 * 1) 数据库端：4 张表全部启用 RLS，策略是 auth.uid() = user_id（见 supabase/schema.sql）。
 *    服务端 Supabase 客户端带的是用户 JWT，所以即使这里写错，也查不到别人的行。
 * 2) 应用端（本文件）：**每个函数都必须显式传 userId，并拼进 where 条件**。
 *    RLS 是兜底，不是唯一防线 —— 一旦哪天有人用 service_role 建了客户端、
 *    或者改错了策略，缺少显式 user_id 的查询就会直接越权。加上这一层，
 *    越权需要同时破掉两道锁。
 *
 * 所以：本文件里所有对 entries / entry_links / reviews 的查询都必须带 userId 过滤，
 * 不接受「靠 RLS 兜底就行」的写法。
 */

export const ENTRY_COLUMNS =
  "id,user_id,kind,title,content,source_url,summary,key_points,next_actions,tags,ai_model,ai_analyzed_at,status,priority,due_at,created_at,updated_at";

export interface ListOptions {
  /** 当前登录用户；所有查询强制带这个条件 */
  userId: string;
  limit?: number;
  kind?: EntryKind;
  status?: EntryStatus;
  q?: string;
  tag?: string;
}

function hydrateAll(rows: unknown): Entry[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => hydrateEntry(row as Record<string, unknown>));
}

function requireId(userId: string): string {
  if (!userId) throw new Error("缺少 userId：数据访问层拒绝执行未绑定用户的查询");
  return userId;
}

export async function listEntries(supabase: SupabaseClient, options: ListOptions): Promise<Entry[]> {
  const userId = requireId(options.userId);
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);

  if (options.q?.trim()) {
    // search_entries 内部已经写了 user_id = auth.uid()，并且是 security invoker，
    // 这里再传一次 userId 是不可能的（函数签名不接收），所以靠函数体内的过滤 + RLS。
    const { data, error } = await supabase.rpc("search_entries", {
      terms: extractTerms(options.q),
      max_rows: limit,
      exclude_id: null,
    });
    if (error) throw new Error(`检索失败：${error.message}`);
    // 双保险：即使函数被改坏，也只留下属于当前用户的行
    return hydrateAll(data).filter((entry) => entry.user_id === userId);
  }

  let query = supabase
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.kind) query = query.eq("kind", options.kind);
  if (options.status) query = query.eq("status", options.status);
  if (options.tag) query = query.contains("tags", [options.tag]);

  const { data, error } = await query;
  if (error) throw new Error(`读取条目失败：${error.message}`);
  return hydrateAll(data);
}

export async function getEntry(
  supabase: SupabaseClient,
  id: string,
  userId: string,
): Promise<Entry | null> {
  const { data, error } = await supabase
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("id", id)
    .eq("user_id", requireId(userId))
    .maybeSingle();
  if (error) throw new Error(`读取条目失败：${error.message}`);
  return data ? hydrateEntry(data as Record<string, unknown>) : null;
}

export async function listRelated(
  supabase: SupabaseClient,
  entryId: string,
  userId: string,
  limit = 6,
): Promise<RelatedEntry[]> {
  const uid = requireId(userId);

  const { data: links, error } = await supabase
    .from("entry_links")
    .select("source_id,target_id,relation,score,reason")
    .eq("user_id", uid)
    .or(`source_id.eq.${entryId},target_id.eq.${entryId}`)
    .order("score", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`读取关联失败：${error.message}`);
  if (!links?.length) return [];

  const otherIds = links.map((link) => (link.source_id === entryId ? link.target_id : link.source_id));
  const { data: rows, error: rowsError } = await supabase
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("user_id", uid)
    .in("id", otherIds);
  if (rowsError) throw new Error(`读取关联条目失败：${rowsError.message}`);

  const byId = new Map(hydrateAll(rows).map((entry) => [entry.id, entry]));
  const result: RelatedEntry[] = [];
  for (const link of links) {
    const other = byId.get(link.source_id === entryId ? link.target_id : link.source_id);
    if (!other) continue;
    result.push({ ...other, relation: link.relation, score: link.score, relation_reason: link.reason });
  }
  return result;
}

/** 写入 AI 判断出的关联（双向只存一条，source 固定为较新的那条） */
export async function saveLinks(
  supabase: SupabaseClient,
  userId: string,
  sourceId: string,
  related: Array<{ id: string; score: number }>,
  reason: string | null,
): Promise<void> {
  const uid = requireId(userId);
  if (!related.length) return;

  const rows = related.map((item) => ({
    user_id: uid,
    source_id: sourceId,
    target_id: item.id,
    relation: "related" as const,
    score: Math.min(1, Math.max(0, item.score)),
    reason,
  }));

  // 只写到自己名下的记录之间（数据库 policy 也要求两端 entry 都属于 auth.uid()）
  const { error } = await supabase
    .from("entry_links")
    .upsert(rows, { onConflict: "source_id,target_id", ignoreDuplicates: true });
  if (error) throw new Error(`写入关联失败：${error.message}`);
}

export async function listOpenTasks(
  supabase: SupabaseClient,
  userId: string,
  limit = 60,
): Promise<Entry[]> {
  const { data, error } = await supabase
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("user_id", requireId(userId))
    .eq("kind", "task")
    .in("status", ["inbox", "active"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`读取待办失败：${error.message}`);
  return hydrateAll(data);
}

export interface Stats {
  total: number;
  inbox: number;
  openTasks: number;
  done: number;
  last7: number;
  last30: number;
}

export async function getStats(supabase: SupabaseClient, userId: string): Promise<Stats> {
  const uid = requireId(userId);
  const since = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const countQuery = () =>
    supabase.from("entries").select("id", { count: "exact", head: true }).eq("user_id", uid);

  const [total, inbox, openTasks, done, last7, last30] = await Promise.all([
    countQuery(),
    countQuery().eq("status", "inbox"),
    countQuery().eq("kind", "task").in("status", ["inbox", "active"]),
    countQuery().eq("status", "done"),
    countQuery().gte("created_at", since(7)),
    countQuery().gte("created_at", since(30)),
  ]);

  return {
    total: total.count ?? 0,
    inbox: inbox.count ?? 0,
    openTasks: openTasks.count ?? 0,
    done: done.count ?? 0,
    last7: last7.count ?? 0,
    last30: last30.count ?? 0,
  };
}

export async function listReviews(
  supabase: SupabaseClient,
  userId: string,
  limit = 12,
): Promise<Review[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("user_id", requireId(userId))
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`读取总结失败：${error.message}`);
  return (data ?? []).map((row) => ({
    ...(row as unknown as Review),
    themes: Array.isArray(row.themes) ? row.themes : [],
    actions: Array.isArray(row.actions) ? row.actions : [],
  }));
}

export async function getEntryCountSince(
  supabase: SupabaseClient,
  since: Date,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", requireId(userId))
    .gte("created_at", since.toISOString());
  if (error) return 0;
  return count ?? 0;
}
