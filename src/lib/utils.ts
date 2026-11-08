import type { EntryKind } from "@/lib/types";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

const DAY = 86400000;

function startOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(iso: string): string {
  const date = parseDate(iso);
  if (!date) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 列表里的相对时间：刚刚 / 12 分钟前 / 今天 14:20 / 昨天 / 10月24日 */
export function formatRelative(iso: string): string {
  const date = parseDate(iso);
  if (!date) return "";

  const diff = Date.now() - date.getTime();
  if (diff >= 0 && diff < 60_000) return "刚刚";
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;

  const today = startOfDay(new Date());
  const target = startOfDay(date);
  if (target === today) return `今天 ${formatTime(iso)}`;
  if (target === today - DAY) return `昨天 ${formatTime(iso)}`;

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function formatFull(iso: string): string {
  const date = parseDate(iso);
  if (!date) return "";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function dayLabel(iso: string): string {
  const date = parseDate(iso);
  if (!date) return "";
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  if (target === today) return "今天";
  if (target === today - DAY) return "昨天";
  if (target === today - 2 * DAY) return "前天";
  return date.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export function formatDue(iso: string | null): { text: string; tone: "overdue" | "today" | "soon" | "normal" } | null {
  const date = parseDate(iso);
  if (!date) return null;

  const now = Date.now();
  const target = startOfDay(date);
  const today = startOfDay(new Date());
  const days = Math.round((target - today) / DAY);

  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  let text: string;
  if (days < 0) text = `逾期 ${Math.abs(days)} 天`;
  else if (days === 0) text = `今天 ${time}`;
  else if (days === 1) text = `明天 ${time}`;
  else if (days <= 7) text = `${days} 天后`;
  else
    text = date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });

  const tone: "overdue" | "today" | "soon" | "normal" =
    date.getTime() < now && days <= 0 ? "overdue" : days <= 0 ? "today" : days <= 3 ? "soon" : "normal";

  return { text, tone };
}

export interface DayGroup {
  key: string;
  label: string;
  entries: import("@/lib/types").Entry[];
}

export function groupByDay(entries: import("@/lib/types").Entry[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const entry of entries) {
    const date = parseDate(entry.created_at);
    const key = date ? String(startOfDay(date)) : "unknown";
    let group = groups.get(key);
    if (!group) {
      group = { key, label: dayLabel(entry.created_at), entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}

export const KIND_STYLES: Record<EntryKind, { dot: string; badge: string; text: string }> = {
  idea: {
    dot: "bg-amber",
    badge: "bg-amber/15 text-amber",
    text: "text-amber",
  },
  note: {
    dot: "bg-neon-blue",
    badge: "bg-neon-blue/15 text-neon-blue",
    text: "text-neon-blue",
  },
  task: {
    dot: "bg-miku",
    badge: "bg-miku/15 text-miku",
    text: "text-miku",
  },
  link: {
    dot: "bg-violet",
    badge: "bg-violet/15 text-violet",
    text: "text-violet",
  },
  reference: {
    dot: "bg-sakura",
    badge: "bg-sakura/15 text-sakura",
    text: "text-sakura",
  },
};

export function truncate(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
