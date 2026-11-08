"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Check,
  ChevronRight,
  ListTodo,
  LoaderCircle,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { Entry } from "@/lib/types";
import type { TaskPlan } from "@/lib/ai/normalize";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { cn, formatDue } from "@/lib/utils";
import { MikuArt } from "@/components/miku-art";
import { useToast } from "@/components/ui/toast";

interface TasksViewProps {
  initialTasks: Entry[];
  aiEnabled: boolean;
}

export function TasksView({ initialTasks, aiEnabled }: TasksViewProps) {
  const [tasks, setTasks] = useState(initialTasks);
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const planTasks = async () => {
    if (planning) return;
    setPlanning(true);
    try {
      const data = await apiFetch<{ plan: TaskPlan; task_count: number }>("/api/ai/tasks", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setPlan(data.plan);
      if (data.task_count === 0) toast(data.plan.note, "info");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setPlanning(false);
    }
  };

  const complete = async (task: Entry) => {
    setBusyIds((prev) => new Set(prev).add(task.id));
    try {
      await apiFetch(`/api/entries/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "done" }),
      });
      setTasks((prev) => prev.filter((item) => item.id !== task.id));
      toast("完成一件", "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-tight text-bright sm:text-[30px]">
            待办 <span className="text-miku">♪</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-faint">
            {tasks.length > 0 ? `${tasks.length} 件事还没做完` : "暂时没有未完成的事"}
          </p>
        </div>

        <button
          type="button"
          onClick={planTasks}
          disabled={planning || !aiEnabled || tasks.length === 0}
          className="glass inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] text-muted transition hover:border-miku/50 hover:text-miku disabled:cursor-not-allowed disabled:opacity-50"
        >
          {planning ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {planning ? "整理中" : "帮我排一下"}
        </button>
      </header>

      {!aiEnabled && (
        <p className="flex items-start gap-1.5 rounded-2xl bg-amber/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          没有配置大模型，只能手动勾选。配置后可以让它替你排出「今天做什么」。
        </p>
      )}

      {plan && (
        <section className="animate-rise space-y-3">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <PlanCard title="今天" tone="miku" items={plan.today} emptyHint="今天没有必须做的事" />
            <PlanCard title="本周" tone="glass" items={plan.this_week} emptyHint="本周没有排期" />
          </div>

          {(plan.later.length > 0 || plan.blocked.length > 0 || plan.drop_candidates.length > 0) && (
            <div className="grid gap-2.5 sm:grid-cols-2">
              <PlanCard title="以后再说" tone="glass" items={plan.later} emptyHint="没有积压" />
              <PlanCard title="卡住了" tone="glass" items={plan.blocked} emptyHint="没有卡点" />
            </div>
          )}

          {plan.drop_candidates.length > 0 && (
            <div className="glass-card rounded-2xl p-3.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">可以考虑删掉</p>
              <ul className="mt-1.5 space-y-1">
                {plan.drop_candidates.map((item, index) => (
                  <li key={index} className="text-[12.5px] leading-relaxed text-faint line-through decoration-faint/40">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.note && (
            <p className="glass-card rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted">
              <span className="mr-1 text-miku">提示 ·</span>
              {plan.note}
            </p>
          )}
        </section>
      )}

      {tasks.length === 0 ? (
        <div className="glass rounded-3xl border-dashed px-6 py-12 text-center">
          {/* 边缘径向融化 + 背后光晕，消除「贴纸感」；移动端克制在 120px */}
          <MikuArt name="empty" halo melt className="mx-auto w-[120px]" />
          <p className="mt-5 text-[17px] font-semibold text-bright">太棒了！任务全部完成</p>
          <p className="mt-1 text-[13px] leading-relaxed text-miku">初音为你点赞 ♪</p>
          <p className="mx-auto mt-3 max-w-xs text-[13px] leading-relaxed text-faint">
            在收件箱里记一条带动作的话（比如「周三前把合同发给老王」），它会自动变成待办。
          </p>
          <Link
            href="/"
            className="glass mt-4 inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12.5px] text-muted transition hover:border-miku/40 hover:text-bright"
          >
            去记一条
            <ChevronRight className="size-3.5" />
          </Link>
        </div>
      ) : (
        <section className="space-y-2">
          <h2 className="pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
            全部待办
          </h2>
          <div className="stagger space-y-2">
            {tasks.map((task) => {
              const due = formatDue(task.due_at);
              const busy = busyIds.has(task.id);
              return (
                <article
                  key={task.id}
                  className="glass-card card-hover group relative flex items-start gap-3 rounded-2xl p-3.5"
                >
                  <button
                    type="button"
                    onClick={() => complete(task)}
                    disabled={busy}
                    aria-label="标记完成"
                    className="relative z-10 mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border border-miku/40 text-transparent transition hover:border-miku hover:bg-miku/15 hover:text-miku"
                  >
                    {busy ? <LoaderCircle className="size-3 animate-spin text-faint" /> : <Check className="size-3" strokeWidth={3} />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-[14px] font-medium leading-6 text-bright">
                      <Link href={`/entry/${task.id}`} className="after:absolute after:inset-0 after:content-['']">
                        {task.title || task.content.slice(0, 28)}
                      </Link>
                    </h3>
                    {task.summary && (
                      <p className="mt-0.5 line-clamp-1 text-[12.5px] text-faint">{task.summary}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
                      {task.priority === 3 && (
                        <span className="neon-pink font-medium text-sakura">重要</span>
                      )}
                      {due && (
                        <span
                          className={cn(
                            "tabular-nums",
                            (due.tone === "overdue" || due.tone === "today") && "font-medium text-sakura",
                            due.tone === "soon" && "text-amber",
                          )}
                        >
                          {due.text}
                        </span>
                      )}
                      {task.tags.slice(0, 2).map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                  </div>

                  <ListTodo className="mt-1 size-4 shrink-0 text-faint/40" />
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function PlanCard({
  title,
  items,
  tone,
  emptyHint,
}: {
  title: string;
  items: string[];
  tone: "miku" | "glass";
  emptyHint: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3.5",
        tone === "miku"
          ? "border-miku/35 bg-miku/10"
          : "glass-card",
      )}
    >
      <h3
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em]",
          tone === "miku" ? "text-miku" : "text-faint",
        )}
      >
        {tone === "miku" && <span className="neon-soft size-1.5 rounded-full bg-miku" />}
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-[12px] text-faint/70">{emptyHint}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2 text-[13px] leading-relaxed text-muted">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-miku/70" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
