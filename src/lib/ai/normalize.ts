import type { Analysis, Entry, EntryKind, ChatSource } from "@/lib/types";
import { ENTRY_KINDS } from "@/lib/types";

const MAX_SUMMARY = 120;
const MAX_TAG = 16;
const MAX_TAGS = 6;
const MAX_POINTS = 5;
const MAX_ACTIONS = 4;
const MAX_TEXT = 4000;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown, limit: number, itemLimit = 200): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = asString(item).replace(/^#/, "").slice(0, itemLimit);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function asKind(value: unknown): EntryKind {
  return typeof value === "string" && (ENTRY_KINDS as readonly string[]).includes(value)
    ? (value as EntryKind)
    : "note";
}

function asPriority(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return 2;
  return Math.min(3, Math.max(1, Math.round(n)));
}

function asIsoDate(value: unknown): string | null {
  const text = asString(value);
  if (!text || text.toLowerCase() === "null") return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  // 拒绝明显离谱的时间（模型偶尔会编造 1970 / 3000 年）
  const year = date.getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  if (year < currentYear - 5 || year > currentYear + 5) return null;
  return date.toISOString();
}

/**
 * 模型输出不可信：所有字段都做一次收敛，宁可退化成默认值也不能把脏数据写库。
 */
export function normalizeAnalysis(raw: unknown): Analysis {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const summary = asString(obj.summary).slice(0, MAX_SUMMARY);

  return {
    title: asString(obj.title).replace(/[。.!！?？]+$/, "").slice(0, 48),
    kind: asKind(obj.kind),
    summary,
    tags: asStringArray(obj.tags, MAX_TAGS, MAX_TAG).map((t) => t.slice(0, MAX_TAG)),
    key_points: asStringArray(obj.key_points, MAX_POINTS),
    next_actions: asStringArray(obj.next_actions, MAX_ACTIONS),
    priority: asPriority(obj.priority),
    due_at: asIsoDate(obj.due_at),
    related_ids: asStringArray(obj.related_ids, 4, 64),
    relation_reason: asString(obj.relation_reason).slice(0, 200) || null,
  };
}

export interface ReviewPayload {
  title: string;
  summary: string;
  themes: Array<{ name: string; insight: string }>;
  actions: Array<{ action: string; why: string; priority: number }>;
  open_loops: string[];
}

export function normalizeReview(raw: unknown): ReviewPayload {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const themes = Array.isArray(obj.themes)
    ? obj.themes
        .map((t) => {
          const item = (t ?? {}) as Record<string, unknown>;
          return { name: asString(item.name).slice(0, 30), insight: asString(item.insight).slice(0, 300) };
        })
        .filter((t) => t.name && t.insight)
        .slice(0, 5)
    : [];

  const actions = Array.isArray(obj.actions)
    ? obj.actions
        .map((a) => {
          const item = (a ?? {}) as Record<string, unknown>;
          return {
            action: asString(item.action).slice(0, 200),
            why: asString(item.why).slice(0, 300),
            priority: asPriority(item.priority),
          };
        })
        .filter((a) => a.action)
        .slice(0, 6)
    : [];

  return {
    title: asString(obj.title).slice(0, 48) || "阶段总结",
    summary: asString(obj.summary).slice(0, MAX_TEXT) || "这段时间没有产生新的记录。",
    themes,
    actions,
    open_loops: asStringArray(obj.open_loops, 6),
  };
}

export interface TaskPlan {
  today: string[];
  this_week: string[];
  later: string[];
  blocked: string[];
  drop_candidates: string[];
  note: string;
}

export function normalizeTaskPlan(raw: unknown): TaskPlan {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    today: asStringArray(obj.today, 8),
    this_week: asStringArray(obj.this_week, 10),
    later: asStringArray(obj.later, 10),
    blocked: asStringArray(obj.blocked, 8),
    drop_candidates: asStringArray(obj.drop_candidates, 6),
    note: asString(obj.note).slice(0, 300),
  };
}

export interface Extraction {
  points: string[];
  decisions: string[];
  people: string[];
  dates: string[];
}

export function normalizeExtraction(raw: unknown): Extraction {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    points: asStringArray(obj.points, 8),
    decisions: asStringArray(obj.decisions, 5),
    people: asStringArray(obj.people, 8, 40),
    dates: asStringArray(obj.dates, 6, 60),
  };
}

/** jsonb 字段在 supabase-js 里是 unknown，这里做一次收窄，避免前端到处 as any */
export function hydrateEntry(row: Record<string, unknown>): Entry {
  return {
    ...(row as unknown as Entry),
    key_points: Array.isArray(row.key_points) ? (row.key_points as string[]) : [],
    next_actions: Array.isArray(row.next_actions) ? (row.next_actions as string[]) : [],
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
  };
}

export function toSource(entry: Entry, snippetLength = 90): ChatSource {
  const text = (entry.summary || entry.content).replace(/\s+/g, " ").trim();
  return {
    id: entry.id,
    title: entry.title || text.slice(0, 24) || "未命名记录",
    kind: entry.kind,
    snippet: text.slice(0, snippetLength),
    created_at: entry.created_at,
  };
}
