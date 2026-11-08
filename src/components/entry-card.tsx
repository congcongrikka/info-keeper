"use client";

import Link from "next/link";
import Image from "next/image";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import type { Entry } from "@/lib/types";
import { KIND_META } from "@/lib/types";
import { KIND_STYLES, cn, formatDue, formatRelative } from "@/lib/utils";
import { KindIcon } from "@/components/kind-icon";

interface EntryCardProps {
  entry: Entry;
  pending?: boolean;
  onToggleTask?: (entry: Entry) => void;
  busy?: boolean;
}

export function EntryCard({ entry, pending = false, onToggleTask, busy = false }: EntryCardProps) {
  const style = KIND_STYLES[entry.kind];
  const due = formatDue(entry.due_at);
  const isTask = entry.kind === "task";
  const done = entry.status === "done";
  const preview = entry.summary || entry.content.replace(/\s+/g, " ").trim();

  return (
    <article
      className={cn(
        "glass-card card-hover group relative overflow-hidden rounded-2xl p-3.5 sm:p-4",
        pending && "opacity-70",
        done && "opacity-60",
      )}
    >
      {/* 右下角初音水印：底层 z-0，渐隐不抢戏 */}
      <span aria-hidden className="miku-watermark">
        <Image src="/miku/art/miku-corner.webp" alt="" width={120} height={120} />
      </span>

      <div className="relative z-10 flex items-start gap-3">
        {isTask ? (
          <button
            type="button"
            onClick={() => onToggleTask?.(entry)}
            disabled={busy || pending}
            aria-label={done ? "标记为未完成" : "标记为完成"}
            className={cn(
              "relative z-10 mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border transition",
              done
                ? "border-miku bg-miku text-night neon-soft"
                : "border-miku/40 bg-white/5 text-transparent hover:border-miku hover:text-miku/50",
            )}
          >
            {busy ? (
              <LoaderCircle className="size-3 animate-spin text-faint" />
            ) : (
              <Check className="size-3" strokeWidth={3} />
            )}
          </button>
        ) : (
          <span
            className={cn(
              "mt-0.5 flex size-[26px] shrink-0 items-center justify-center rounded-[9px]",
              style.badge,
            )}
          >
            <KindIcon kind={entry.kind} className="size-[15px]" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {entry.priority === 3 && !done && (
              <span className="neon-pink size-1.5 shrink-0 rounded-full bg-sakura" aria-label="高优先级" />
            )}
            <h3
              className={cn(
                "truncate text-[15px] font-medium leading-6 text-bright",
                done && "line-through decoration-faint/50",
              )}
            >
              {pending ? (
                <span>{entry.title || preview.slice(0, 28) || "未命名记录"}</span>
              ) : (
                <Link href={`/entry/${entry.id}`} className="after:absolute after:inset-0 after:content-['']">
                  {entry.title || preview.slice(0, 28) || "未命名记录"}
                </Link>
              )}
            </h3>
            {entry.ai_analyzed_at && !pending && (
              <Sparkles className="size-3 shrink-0 text-miku/70" aria-label="已智能整理" />
            )}
          </div>

          {preview && (
            <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-muted">{preview}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
            <span
              className={cn(
                "rounded-full px-1.5 py-[1px] text-[10px] font-medium tracking-wide",
                style.badge,
              )}
            >
              {KIND_META[entry.kind].label}
            </span>
            <span className="tabular-nums">{formatRelative(entry.created_at)}</span>

            {due && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 tabular-nums",
                  due.tone === "overdue" && "font-medium text-sakura",
                  due.tone === "today" && "font-medium text-sakura",
                  due.tone === "soon" && "text-amber",
                )}
              >
                · {due.text}
              </span>
            )}

            {entry.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-faint/80">
                #{tag}
              </span>
            ))}
            {entry.tags.length > 3 && <span className="text-faint/60">+{entry.tags.length - 3}</span>}

            {pending && <span className="animate-pulse text-miku/80">正在理解…</span>}
          </div>
        </div>
      </div>
    </article>
  );
}
