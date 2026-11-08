export const ENTRY_KINDS = ["idea", "note", "task", "link", "reference"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const ENTRY_STATUSES = ["inbox", "active", "done", "archived"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export interface Entry {
  id: string;
  user_id: string;
  kind: EntryKind;
  title: string | null;
  content: string;
  source_url: string | null;
  summary: string | null;
  key_points: string[];
  next_actions: string[];
  tags: string[];
  ai_model: string | null;
  ai_analyzed_at: string | null;
  status: EntryStatus;
  priority: number;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntryLink {
  id: string;
  source_id: string;
  target_id: string;
  relation: "related" | "duplicate" | "follow_up" | "contradicts";
  score: number;
  reason: string | null;
}

export interface RelatedEntry extends Entry {
  relation: EntryLink["relation"];
  score: number;
  relation_reason: string | null;
}

export interface ReviewTheme {
  name: string;
  insight: string;
}

export interface ReviewAction {
  action: string;
  why: string;
  priority: number;
}

export interface Review {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  entry_count: number;
  title: string | null;
  summary: string;
  themes: ReviewTheme[];
  actions: ReviewAction[];
  open_loops?: string[];
  model: string | null;
  created_at: string;
}

/** 大模型返回的结构化理解结果（只存在于服务端 → 数据库） */
export interface Analysis {
  title: string;
  kind: EntryKind;
  summary: string;
  tags: string[];
  key_points: string[];
  next_actions: string[];
  priority: number;
  due_at: string | null;
  related_ids: string[];
  relation_reason: string | null;
}

export interface ChatSource {
  id: string;
  title: string;
  kind: EntryKind;
  snippet: string;
  created_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
}

export const KIND_META: Record<EntryKind, { label: string; hint: string }> = {
  idea: { label: "想法", hint: "灵感、构思、待验证的念头" },
  note: { label: "笔记", hint: "事实、摘录、随手记下的一段话" },
  task: { label: "待办", hint: "有明确动作要做的事" },
  link: { label: "链接", hint: "以收藏为主的网页/资源" },
  reference: { label: "资料", hint: "长文、文档、可复用的参考" },
};

export const STATUS_META: Record<EntryStatus, { label: string }> = {
  inbox: { label: "待整理" },
  active: { label: "进行中" },
  done: { label: "已完成" },
  archived: { label: "已归档" },
};

export function isEntryKind(value: unknown): value is EntryKind {
  return typeof value === "string" && (ENTRY_KINDS as readonly string[]).includes(value);
}
