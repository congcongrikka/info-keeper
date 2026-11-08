import type { SupabaseClient } from "@supabase/supabase-js";
import type { Analysis, Entry, EntryKind } from "@/lib/types";
import { ENTRY_COLUMNS, listEntries, saveLinks } from "@/lib/db";
import { hydrateEntry, normalizeAnalysis } from "@/lib/ai/normalize";
import { buildAnalysisMessages, buildExtractionMessages } from "@/lib/ai/prompts";
import { complete, extractJson, isAiEnabled } from "@/lib/ai/provider";
import { extractHashtags, extractTerms } from "@/lib/search";

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/i;

function guessKind(content: string): EntryKind {
  if (URL_PATTERN.test(content) && content.length < 400) return "link";
  if (/^(\s*[-*]\s*\[[ x]\]|待办|要做|记得|别忘了|todo|TODO)/.test(content)) return "task";
  if (content.length > 900) return "reference";
  if (/(想法|灵感|也许可以|如果|设想|idea)/.test(content)) return "idea";
  return "note";
}

function fallbackTitle(content: string): string {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim().length > 0) ?? content;
  return firstLine.replace(/^#+\s*/, "").trim().slice(0, 32);
}

export interface CreateEntryInput {
  content: string;
  kind?: EntryKind | null;
  sourceUrl?: string | null;
  analyze?: boolean;
  title?: string | null;
}

export interface CreateEntryResult {
  entry: Entry;
  ai: { applied: boolean; error?: string };
}

/**
 * 写入一条记录，并（可选）立刻让模型理解它。
 * 设计原则：AI 失败绝不能影响「记录」这件事本身 —— 先落库，再增强。
 */
export async function createEntry(
  supabase: SupabaseClient,
  userId: string,
  input: CreateEntryInput,
): Promise<CreateEntryResult> {
  const content = input.content.trim();
  if (!content) {
    throw new Error("内容不能为空");
  }

  const urlFromContent = content.match(URL_PATTERN)?.[0] ?? null;
  const sourceUrl = input.sourceUrl?.trim() || urlFromContent || null;
  const hashes = extractHashtags(content);
  const kind = input.kind ?? guessKind(content);

  const { data, error } = await supabase
    .from("entries")
    .insert({
      user_id: userId,
      content,
      kind,
      title: input.title?.trim() || fallbackTitle(content),
      source_url: sourceUrl,
      tags: hashes,
      status: kind === "task" ? "active" : "inbox",
    })
    .select(ENTRY_COLUMNS)
    .single();

  if (error || !data) throw new Error(`保存失败：${error?.message ?? "未知错误"}`);

  let entry = hydrateEntry(data as Record<string, unknown>);
  const shouldAnalyze = input.analyze !== false && isAiEnabled();
  if (!shouldAnalyze) {
    return { entry, ai: { applied: false } };
  }

  try {
    const analyzed = await analyzeEntry(supabase, userId, entry, input.kind ?? null);
    entry = analyzed.entry;
    return { entry, ai: { applied: true } };
  } catch (error) {
    console.error("[createEntry] AI 分析失败", error);
    return { entry, ai: { applied: false, error: error instanceof Error ? error.message : "AI 分析失败" } };
  }
}

/** 重新理解一条记录：分类、摘要、标签、重点、关联 */
export async function analyzeEntry(
  supabase: SupabaseClient,
  userId: string,
  entry: Entry,
  lockedKind: EntryKind | null = null,
): Promise<{ entry: Entry; analysis: Analysis }> {
  // 候选集 = 关键词命中（能捞到旧记录）+ 最近记录（保证上下文新鲜）
  const terms = extractTerms(entry.content.slice(0, 600), 10);
  const matched: Entry[] = [];
  if (terms.length) {
    const { data } = await supabase.rpc("search_entries", {
      terms,
      max_rows: 12,
      exclude_id: entry.id,
    });
    if (Array.isArray(data)) {
      for (const row of data) {
        const found = hydrateEntry(row as Record<string, unknown>);
        // 函数内已按 auth.uid() 过滤；这里再核一遍 user_id，双保险
        if (found.user_id === userId) matched.push(found);
      }
    }
  }

  const recent = await listEntries(supabase, { userId, limit: 24 });
  const candidates: Entry[] = [];
  const seen = new Set<string>([entry.id]);
  for (const item of [...matched, ...recent]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    candidates.push(item);
    if (candidates.length >= 30) break;
  }

  const messages = buildAnalysisMessages({
    content: entry.content,
    sourceUrl: entry.source_url,
    candidates,
  });

  // 这条调用要处理「下周三」「月底」这类相对时间换算，思考链不能省（实测关掉会算错日期）
  const { text, model } = await complete(messages, { json: true, temperature: 0.2, thinking: true });
  const analysis = normalizeAnalysis(extractJson(text));

  const patch: Record<string, unknown> = {
    title: analysis.title || entry.title,
    summary: analysis.summary || null,
    tags: analysis.tags.length ? analysis.tags : entry.tags,
    key_points: analysis.key_points,
    next_actions: analysis.next_actions,
    priority: analysis.priority,
    due_at: analysis.due_at,
    ai_model: model,
    ai_analyzed_at: new Date().toISOString(),
  };

  if (!lockedKind && analysis.kind !== entry.kind) {
    patch.kind = analysis.kind;
    if (analysis.kind === "task" && entry.status === "inbox") patch.status = "active";
  }

  const { data, error } = await supabase
    .from("entries")
    .update(patch)
    .eq("id", entry.id)
    .eq("user_id", userId)
    .select(ENTRY_COLUMNS)
    .single();

  if (error || !data) throw new Error(`写入分析结果失败：${error?.message ?? "未知错误"}`);

  // 只接受真实存在于候选集合里的 id，防止模型编造 uuid
  const candidateIds = new Set(candidates.map((item) => item.id));
  const related = analysis.related_ids
    .filter((id) => id !== entry.id && candidateIds.has(id))
    .map((id) => ({ id, score: 0.72 }));

  if (related.length) {
    await saveLinks(supabase, userId, entry.id, related, analysis.relation_reason);
  }

  return { entry: hydrateEntry(data as Record<string, unknown>), analysis };
}

/** 重点信息提取（保留已有摘要，只刷新 key_points） */
export async function extractKeyPoints(
  supabase: SupabaseClient,
  userId: string,
  entry: Entry,
): Promise<{ entry: Entry; points: string[] }> {
  // 纯抽取，没有推理成分，关掉思考省 3~4 倍时间
  const { text, model } = await complete(buildExtractionMessages({ entry }), {
    json: true,
    temperature: 0.1,
    thinking: false,
  });
  const payload = extractJson<{ points?: unknown }>(text);
  const points = Array.isArray(payload.points)
    ? payload.points.filter((p): p is string => typeof p === "string" && p.trim().length > 0).slice(0, 8)
    : [];

  const { data, error } = await supabase
    .from("entries")
    .update({ key_points: points, ai_model: model, ai_analyzed_at: new Date().toISOString() })
    .eq("id", entry.id)
    .eq("user_id", userId)
    .select(ENTRY_COLUMNS)
    .single();

  if (error || !data) throw new Error(`保存重点失败：${error?.message ?? "未知错误"}`);
  return { entry: hydrateEntry(data as Record<string, unknown>), points };
}
