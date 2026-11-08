"use client";

import { useState } from "react";
import {
  ArrowRight,
  CircleCheck,
  Clock,
  LoaderCircle,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { Review } from "@/lib/types";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { MikuArt } from "@/components/miku-art";
import { useToast } from "@/components/ui/toast";

const PERIODS = [
  { days: 7, label: "最近 7 天" },
  { days: 30, label: "最近 30 天" },
  { days: 90, label: "最近 90 天" },
  { days: 0, label: "全部" },
] as const;

interface InsightsViewProps {
  initialReviews: Review[];
  aiEnabled: boolean;
  total: number;
}

function formatRange(start: string, end: string): string {
  const formatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });
  return `${formatter.format(new Date(start))} — ${formatter.format(new Date(end))}`;
}

export function InsightsView({ initialReviews, aiEnabled, total }: InsightsViewProps) {
  const [reviews, setReviews] = useState<Review[]>(initialReviews);
  const [current, setCurrent] = useState<Review | null>(initialReviews[0] ?? null);
  const [days, setDays] = useState<(typeof PERIODS)[number]["days"]>(7);
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const data = await apiFetch<{ review: Review }>("/api/ai/review", {
        method: "POST",
        body: JSON.stringify({ days }),
      });
      setReviews((prev) => [data.review, ...prev]);
      setCurrent(data.review);
      toast("总结写好了", "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-tight text-bright sm:text-[30px]">
          洞察 <span className="text-miku">♪</span>
        </h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
          从你写下的 {total} 条记录里，看看这段时间在发生什么。
        </p>
      </header>

      <section className="glass-strong rounded-3xl p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="grid grid-cols-4 gap-1 sm:flex sm:flex-1 sm:flex-wrap">
            {PERIODS.map((period) => (
              <button
                key={period.days}
                type="button"
                onClick={() => setDays(period.days)}
                className={cn(
                  "rounded-full px-2 py-1.5 text-center text-[12px] transition sm:px-3 sm:text-[12.5px]",
                  days === period.days
                    ? "neon-soft bg-miku text-night"
                    : "text-muted hover:bg-white/5 hover:text-bright",
                )}
              >
                {period.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={generating || !aiEnabled || total === 0}
            className="neon-soft inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-miku px-4 py-2 text-[12.5px] font-medium text-night transition hover:neon disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-faint"
          >
            {generating ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {generating ? "正在读…" : "生成总结"}
          </button>
        </div>

        {!aiEnabled && (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-amber/10 px-3 py-2 text-[12px] leading-relaxed text-amber">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            还没有配置大模型 API Key，生成功能不可用。配置后可以自动写阶段总结和行动建议。
          </p>
        )}
        {generating && (
          <p className="mt-3 text-[12px] leading-relaxed text-faint">
            正在通读这段时间的记录，通常需要 10–30 秒，别关页面。
          </p>
        )}
      </section>

      {current ? (
        <ReviewCard review={current} />
      ) : (
        <div className="glass rounded-3xl border-dashed px-6 py-12 text-center">
          {/* 边缘径向融化 + 背后光晕，消除「贴纸感」；移动端克制在 120px */}
          <MikuArt name="empty" halo melt className="mx-auto w-[120px]" />
          <p className="mt-5 text-[17px] font-semibold text-bright">还没有阶段总结</p>
          <p className="mt-1 text-[13px] leading-relaxed text-miku">初音在等你的第一条总结 ♪</p>
          <p className="mx-auto mt-3 max-w-xs text-[13px] leading-relaxed text-faint">
            先记上几天，再回来点「生成总结」。它会告诉你最近的重心、反复出现的主题，以及接下来该做什么。
          </p>
        </div>
      )}

      {reviews.length > 1 && (
        <section className="space-y-2">
          <h2 className="pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">历史总结</h2>
          <div className="space-y-1.5">
            {reviews.map((review) => (
              <button
                key={review.id}
                type="button"
                onClick={() => setCurrent(review)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition",
                  current?.id === review.id
                    ? "glass-card neon-soft"
                    : "border-transparent bg-white/5 hover:bg-white/10",
                )}
              >
                <Clock className="size-3.5 shrink-0 text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-bright">
                    {review.title || "阶段总结"}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-faint">
                    {formatRange(review.period_start, review.period_end)} · {review.entry_count} 条
                  </span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-miku/70" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const paragraphs = review.summary.split(/\n{2,}/).filter((item) => item.trim());

  return (
    <article className="glass-strong animate-rise overflow-hidden rounded-3xl">
      <header className="border-b border-miku/15 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
          <span className="rounded-full bg-miku/15 px-2 py-0.5 tabular-nums text-miku">
            {formatRange(review.period_start, review.period_end)}
          </span>
          <span>{review.entry_count} 条记录</span>
          {review.model && <span className="text-faint/60">· {review.model}</span>}
        </div>
        <h2 className="mt-2 text-[20px] font-semibold leading-snug tracking-tight text-bright sm:text-[22px]">
          {review.title || "阶段总结"}
        </h2>
      </header>

      <div className="space-y-6 px-5 py-5 sm:px-6">
        <div className="space-y-3">
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="text-[14px] leading-[1.9] text-muted">
              {paragraph}
            </p>
          ))}
        </div>

        {review.themes.length > 0 && (
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">反复出现的主题</h3>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              {review.themes.map((theme, index) => (
                <div key={`${theme.name}-${index}`} className="glass-card rounded-2xl p-3">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-bright">
                    <span className="neon-soft size-1.5 rounded-full bg-miku" />
                    {theme.name}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{theme.insight}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {review.actions.length > 0 && (
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">接下来可以做</h3>
            <ol className="mt-2.5 space-y-2">
              {review.actions.map((action, index) => (
                <li key={`${action.action}-${index}`} className="glass-card flex gap-3 rounded-2xl p-3">
                  <span className="neon-soft mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-miku text-[10px] font-medium text-night">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium leading-relaxed text-bright">{action.action}</p>
                    {action.why && <p className="mt-0.5 text-[12px] leading-relaxed text-faint">{action.why}</p>}
                  </div>
                  {action.priority === 3 && (
                    <span className="neon-pink ml-auto shrink-0 self-start rounded-full bg-sakura/15 px-2 py-0.5 text-[10px] font-medium text-sakura">
                      本周
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {review.open_loops && review.open_loops.length > 0 && (
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">还没闭环</h3>
            <ul className="mt-2 space-y-1.5">
              {review.open_loops.map((loop, index) => (
                <li key={`${loop}-${index}`} className="flex items-start gap-2 text-[13px] leading-relaxed text-muted">
                  <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-miku/60" />
                  {loop}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-1.5 border-t border-miku/15 px-5 py-2.5 text-[10.5px] text-faint/70 sm:px-6">
        <Sparkles className="size-3 text-miku" />
        由你的记录生成 · {new Date(review.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
      </footer>
    </article>
  );
}
