"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import type { Entry, EntryKind } from "@/lib/types";
import { ENTRY_KINDS, KIND_META } from "@/lib/types";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { cn, groupByDay } from "@/lib/utils";
import type { Stats } from "@/lib/db";
import { CaptureBox } from "@/components/capture-box";
import { EntryCard } from "@/components/entry-card";
import { LeekIcon } from "@/components/miku-icons";
import { useToast } from "@/components/ui/toast";

interface InboxViewProps {
  initialEntries: Entry[];
  aiEnabled: boolean;
  stats: Stats;
}

type Filter = "all" | EntryKind;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function makeOptimistic(id: string, content: string, kind: EntryKind | null): Entry {
  const now = new Date().toISOString();
  return {
    id,
    user_id: "",
    kind: kind ?? "note",
    title: content.split(/\r?\n/)[0]?.slice(0, 28) || "新记录",
    content,
    source_url: null,
    summary: null,
    key_points: [],
    next_actions: [],
    tags: [],
    ai_model: null,
    ai_analyzed_at: null,
    status: kind === "task" ? "active" : "inbox",
    priority: 2,
    due_at: null,
    created_at: now,
    updated_at: now,
  };
}

export function InboxView({ initialEntries, aiEnabled, stats }: InboxViewProps) {
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Entry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const requestId = useRef(0);
  const { toast } = useToast();

  // ---- 搜索：防抖 320ms，带竞态保护 ----
  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      setResults(null);
      setSearching(false);
      return;
    }

    const current = ++requestId.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiFetch<{ entries: Entry[] }>(
          `/api/entries?q=${encodeURIComponent(keyword)}&limit=60`,
        );
        if (current === requestId.current) setResults(data.entries);
      } catch (error) {
        if (current === requestId.current) toast(errorMessage(error), "error");
      } finally {
        if (current === requestId.current) setSearching(false);
      }
    }, 320);

    return () => window.clearTimeout(timer);
  }, [query, toast]);

  const handleCreate = async ({ content, kind }: { content: string; kind: EntryKind | null }) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic = makeOptimistic(tempId, content, kind);

    setQuery("");
    setEntries((prev) => [optimistic, ...prev]);
    setPending((prev) => new Set(prev).add(tempId));

    try {
      const data = await apiFetch<{ entry: Entry; ai: { applied: boolean; error?: string } }>("/api/entries", {
        method: "POST",
        body: JSON.stringify({ content, kind }),
      });
      setEntries((prev) => prev.map((item) => (item.id === tempId ? data.entry : item)));
      if (aiEnabled && data.ai.error) {
        toast(`已保存，但智能整理失败了：${data.ai.error}`, "info");
      }
    } catch (error) {
      setEntries((prev) => prev.filter((item) => item.id !== tempId));
      throw error;
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(tempId);
        return next;
      });
    }
  };

  const toggleTask = async (entry: Entry) => {
    const nextStatus = entry.status === "done" ? "active" : "done";
    const snapshot = entry.status;

    setEntries((prev) => prev.map((item) => (item.id === entry.id ? { ...item, status: nextStatus } : item)));
    setBusy((prev) => new Set(prev).add(entry.id));

    try {
      await apiFetch(`/api/entries/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch (error) {
      setEntries((prev) =>
        prev.map((item) => (item.id === entry.id ? { ...item, status: snapshot } : item)),
      );
      toast(errorMessage(error), "error");
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  };

  const source = results ?? entries;
  const visible = useMemo(
    () => (filter === "all" ? source : source.filter((item) => item.kind === filter)),
    [source, filter],
  );

  const groups = useMemo(() => groupByDay(visible), [visible]);
  const isSearchMode = results !== null;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-faint">
            {new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}
          </p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-bright sm:text-[30px]">
            {greeting()}，今天记点什么？
          </h1>
        </div>
      </header>

      <p className="-mt-2 text-[12.5px] text-faint">
        共 {stats.total} 条记录
        {stats.inbox > 0 && <> · {stats.inbox} 条待整理</>}
        {stats.openTasks > 0 && <> · {stats.openTasks} 件待办</>}
      </p>

      <CaptureBox onSubmit={handleCreate} aiEnabled={aiEnabled} />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="no-scrollbar -mx-1 flex flex-1 items-center gap-1 overflow-x-auto px-1">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
              全部
            </FilterChip>
            {ENTRY_KINDS.map((kind) => (
              <FilterChip key={kind} active={filter === kind} onClick={() => setFilter(kind)}>
                {KIND_META[kind].label}
              </FilterChip>
            ))}
          </div>

          <div className="relative w-[132px] shrink-0 sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索记录"
              className="glass h-9 w-full rounded-full pl-8 pr-7 text-[13px] text-bright outline-none transition placeholder:text-faint/80 focus:border-miku/60 focus:neon-soft"
              aria-label="搜索记录"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-faint hover:text-bright"
                aria-label="清空搜索"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>

        {isSearchMode && (
          <p className="text-[12px] text-faint">
            {searching ? "正在找…" : `找到 ${visible.length} 条与「${query.trim()}」相关的记录`}
          </p>
        )}
      </div>

      {searching && !results ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-faint">
          <LoaderCircle className="size-4 animate-spin text-miku" />
          正在翻找…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          searching={isSearchMode}
          filtered={filter !== "all"}
          onReset={() => {
            setFilter("all");
            setQuery("");
          }}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2">
              {!isSearchMode && (
                <h2 className="glass-strong sticky top-14 z-10 -mx-1 rounded-lg px-2 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-miku md:top-0">
                  {group.label}
                </h2>
              )}
              <div className="stagger space-y-2">
                {group.entries.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    pending={pending.has(entry.id)}
                    busy={busy.has(entry.id)}
                    onToggleTask={toggleTask}
                  />
                ))}
              </div>
            </section>
          ))}

          {!isSearchMode && entries.length >= 60 && (
            <p className="pt-2 text-center text-[11.5px] text-faint">
              这里是最近 60 条，用搜索能找到更早的记录
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-[12.5px] transition",
        active
          ? "neon-soft border-miku bg-miku text-night"
          : "glass text-muted hover:border-miku/40 hover:text-bright",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({
  searching,
  filtered,
  onReset,
}: {
  searching: boolean;
  filtered: boolean;
  onReset: () => void;
}) {
  return (
    <div className="animate-fade glass rounded-3xl border-dashed px-6 py-16 text-center">
      <div className="animate-leek mx-auto flex size-14 items-center justify-center text-miku">
        <LeekIcon className="size-full" />
      </div>
      <p className="mt-4 text-[17px] font-semibold text-bright">
        {searching ? "没找到相关记录" : filtered ? "这个分类下还没有内容" : "还没有记录"}
      </p>
      <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-relaxed text-faint">
        {searching
          ? "换个说法试试，或者先把这件事记下来。"
          : filtered
            ? "换个分类看看，或者直接在上面记一条。"
            : "在上面写下第一句。想法不用完整，我会帮你整理、归类、串起来。"}
      </p>
      {(searching || filtered) && (
        <button
          type="button"
          onClick={onReset}
          className="glass mt-4 rounded-full px-3.5 py-1.5 text-[12.5px] text-muted transition hover:border-miku/40 hover:text-bright"
        >
          查看全部
        </button>
      )}
      <p className="mt-6 text-[11px] tracking-wide text-faint/70">
        <span className="text-miku">♪</span> 记录会同步到你的所有设备
      </p>
    </div>
  );
}
