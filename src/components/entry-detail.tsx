"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleCheck,
  Clock,
  Copy,
  ExternalLink,
  Layers,
  LoaderCircle,
  Sparkles,
  Trash,
  WandSparkles,
} from "lucide-react";
import type { Entry, RelatedEntry } from "@/lib/types";
import { KIND_META, STATUS_META } from "@/lib/types";
import { KIND_STYLES, cn, domainOf, formatDue, formatFull, formatRelative } from "@/lib/utils";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { KindIcon } from "@/components/kind-icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

interface EntryDetailProps {
  entry: Entry;
  related: RelatedEntry[];
  aiEnabled: boolean;
}

export function EntryDetail({ entry: initialEntry, related: initialRelated, aiEnabled }: EntryDetailProps) {
  const [entry, setEntry] = useState(initialEntry);
  const [related, setRelated] = useState(initialRelated);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(entry.title ?? "");
  const [draftContent, setDraftContent] = useState(entry.content);
  const [draftTags, setDraftTags] = useState(entry.tags.join("，"));
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const due = formatDue(entry.due_at);
  const style = KIND_STYLES[entry.kind];
  const isTask = entry.kind === "task";

  const patch = async (changes: Record<string, unknown>, successMessage?: string) => {
    const data = await apiFetch<{ entry: Entry }>(`/api/entries/${entry.id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    });
    setEntry(data.entry);
    if (successMessage) toast(successMessage, "success");
    return data.entry;
  };

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    try {
      await task();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const saveEdit = () =>
    run("save", async () => {
      const tags = draftTags
        .split(/[,，\s]+/)
        .map((tag) => tag.replace(/^#/, "").trim())
        .filter(Boolean)
        .slice(0, 12);
      await patch({ title: draftTitle.trim() || null, content: draftContent.trim(), tags }, "已保存");
      setEditing(false);
    });

  const toggleStatus = () =>
    run("status", async () => {
      const next = entry.status === "done" ? "active" : "done";
      await patch({ status: next }, next === "done" ? "已标记完成" : "已恢复");
    });

  const archive = () =>
    run("archive", async () => {
      await patch({ status: entry.status === "archived" ? "inbox" : "archived" }, "已更新状态");
    });

  const analyze = () =>
    run("analyze", async () => {
      const data = await apiFetch<{ entry: Entry; analysis: unknown; related?: RelatedEntry[] }>(
        `/api/entries/${entry.id}/analyze`,
        { method: "POST", body: JSON.stringify({ mode: "full" }) },
      );
      setEntry(data.entry);
      if (data.related) setRelated(data.related);
      toast("已重新读过这条记录", "success");
    });

  const extract = () =>
    run("extract", async () => {
      const data = await apiFetch<{ entry: Entry }>(`/api/entries/${entry.id}/analyze`, {
        method: "POST",
        body: JSON.stringify({ mode: "points" }),
      });
      setEntry(data.entry);
      toast("重点已提取", "success");
    });

  const remove = () =>
    run("delete", async () => {
      await apiFetch(`/api/entries/${entry.id}`, { method: "DELETE" });
      toast("已删除", "success");
      setConfirmOpen(false);
      router.push("/");
      router.refresh();
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(entry.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("复制失败，请手动选择文本", "error");
    }
  };

  const hasInsight = Boolean(entry.summary) || entry.key_points.length > 0 || entry.tags.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full px-1.5 py-1 text-[13px] text-faint transition hover:text-bright"
        >
          <ArrowLeft className="size-4" />
          收件箱
        </Link>
        <button
          type="button"
          onClick={copy}
          className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-muted transition hover:border-miku/40"
        >
          {copied ? <Check className="size-3.5 text-miku" /> : <Copy className="size-3.5" />}
          {copied ? "已复制" : "复制正文"}
        </button>
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", style.badge)}>
            <KindIcon kind={entry.kind} className="size-3" />
            {KIND_META[entry.kind].label}
          </span>
          <span className="tabular-nums">{formatFull(entry.created_at)}</span>
          <span className="text-faint/50">·</span>
          <span>{STATUS_META[entry.status].label}</span>
          {due && (
            <span
              className={cn(
                "inline-flex items-center gap-1 tabular-nums",
                (due.tone === "overdue" || due.tone === "today") && "font-medium text-sakura",
              )}
            >
              <Clock className="size-3" />
              {due.text}
            </span>
          )}
        </div>

        {editing ? (
          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            data-keep-font
            className="glass w-full rounded-xl px-3 py-2 text-[22px] font-semibold tracking-tight text-bright outline-none focus:border-miku/60 focus:neon-soft"
            placeholder="标题"
          />
        ) : (
          <h1 className="text-[24px] font-semibold leading-snug tracking-tight text-bright sm:text-[28px]">
            {entry.title || "未命名记录"}
          </h1>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {isTask && (
          <ActionButton onClick={toggleStatus} active={entry.status === "done"} busy={busy === "status"}>
            <Check className="size-3.5" />
            {entry.status === "done" ? "已完成" : "标记完成"}
          </ActionButton>
        )}
        {aiEnabled && (
          <ActionButton onClick={analyze} busy={busy === "analyze"}>
            <Sparkles className="size-3.5" />
            {hasInsight ? "重新理解" : "让 AI 读一遍"}
          </ActionButton>
        )}
        {aiEnabled && (
          <ActionButton onClick={extract} busy={busy === "extract"}>
            <WandSparkles className="size-3.5" />
            提取重点
          </ActionButton>
        )}
        <ActionButton onClick={archive} busy={busy === "archive"}>
          <Layers className="size-3.5" />
          {entry.status === "archived" ? "取消归档" : "归档"}
        </ActionButton>
        <button
          type="button"
          onClick={() => {
            setEditing((value) => !value);
            setDraftTitle(entry.title ?? "");
            setDraftContent(entry.content);
            setDraftTags(entry.tags.join("，"));
          }}
          className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] text-muted transition hover:border-miku/40 hover:text-bright"
        >
          {editing ? "取消编辑" : "编辑"}
        </button>
      </div>

      <article className="glass-strong rounded-3xl p-5 sm:p-6">
        {editing ? (
          <div className="space-y-3">
            <textarea
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              rows={10}
              className="glass w-full resize-y rounded-xl p-3 text-[15px] leading-[1.85] text-bright outline-none focus:border-miku/60"
            />
            <input
              value={draftTags}
              onChange={(event) => setDraftTags(event.target.value)}
              placeholder="标签，用逗号分隔"
              className="glass w-full rounded-xl px-3 py-2 text-[13px] text-bright outline-none focus:border-miku/60"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-full px-3.5 py-1.5 text-[13px] text-faint transition hover:bg-white/5"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={busy === "save" || !draftContent.trim()}
                className="neon-soft inline-flex items-center gap-1.5 rounded-full bg-miku px-4 py-1.5 text-[13px] font-medium text-night transition hover:neon disabled:opacity-50"
              >
                {busy === "save" && <LoaderCircle className="size-3.5 animate-spin" />}
                保存
              </button>
            </div>
          </div>
        ) : (
          <div className="prose-note">{entry.content}</div>
        )}

        {entry.source_url && !editing && (
          <a
            href={entry.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-neon-blue/30 bg-neon-blue/10 px-3 py-1.5 text-[12.5px] text-neon-blue transition hover:border-neon-blue/60"
          >
            <ExternalLink className="size-3.5" />
            {domainOf(entry.source_url) ?? "打开链接"}
            <ArrowUpRight className="size-3" />
          </a>
        )}
      </article>

      <section className="glass-strong overflow-hidden rounded-3xl">
        <div className="flex items-center justify-between border-b border-miku/15 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[13px] font-medium text-muted">
            <Sparkles className="size-4 text-miku" />
            智能理解
          </h2>
          {entry.ai_analyzed_at && (
            <span className="text-[11px] text-faint">{formatRelative(entry.ai_analyzed_at)}整理</span>
          )}
        </div>

        <div className="space-y-5 px-5 py-4">
          {!hasInsight && !aiEnabled && (
            <p className="text-[13px] leading-relaxed text-faint">
              还没有配置大模型，这条记录保持原样保存。配置 API Key 后，可以自动生成摘要、标签和相关联的旧记录。
            </p>
          )}

          {!hasInsight && aiEnabled && (
            <div className="py-2 text-center">
              <p className="text-[13px] text-faint">这条记录还没有被理解过。</p>
              <button
                type="button"
                onClick={analyze}
                disabled={busy === "analyze"}
                className="neon-soft mt-3 inline-flex items-center gap-1.5 rounded-full bg-miku px-4 py-1.5 text-[12.5px] font-medium text-night transition hover:neon disabled:opacity-60"
              >
                {busy === "analyze" ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                让它读一遍
              </button>
            </div>
          )}

          {entry.summary && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">一句话</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-bright">{entry.summary}</p>
            </div>
          )}

          {entry.key_points.length > 0 && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">重点</h3>
              <ul className="mt-2 space-y-1.5">
                {entry.key_points.map((point, index) => (
                  <li key={`${point}-${index}`} className="flex gap-2 text-[13.5px] leading-relaxed text-muted">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-miku neon-soft" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {entry.next_actions.length > 0 && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">下一步</h3>
              <ul className="mt-2 space-y-1.5">
                {entry.next_actions.map((action, index) => (
                  <li key={`${action}-${index}`} className="flex items-start gap-2 text-[13.5px] leading-relaxed text-muted">
                    <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-miku" />
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {entry.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-miku/20 bg-white/5 px-2.5 py-1 text-[11.5px] text-muted"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {entry.ai_model && (
          <p className="border-t border-miku/15 px-5 py-2.5 text-[10.5px] tracking-wide text-faint/70">
            由 {entry.ai_model} 整理
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            <Layers className="size-4 text-faint" />
            相关记录
            {related.length > 0 && <span className="text-faint">（{related.length}）</span>}
          </h2>
        </div>

        {related.length === 0 ? (
          <p className="glass rounded-2xl border-dashed px-4 py-6 text-center text-[12.5px] leading-relaxed text-faint">
            还没有找到相关记录。等你记的多了，或者点一下「重新理解」，我会试着把它和旧内容串起来。
          </p>
        ) : (
          <div className="space-y-2">
            {related.map((item) => (
              <Link
                key={item.id}
                href={`/entry/${item.id}`}
                className="glass-card card-hover group flex items-start gap-3 rounded-2xl p-3.5"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[9px]",
                    KIND_STYLES[item.kind].badge,
                  )}
                >
                  <KindIcon kind={item.kind} className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-bright">{item.title || item.content.slice(0, 24)}</p>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted/80">
                    {item.relation_reason || item.summary || item.content}
                  </p>
                  <p className="mt-1.5 text-[11px] text-faint">
                    {KIND_META[item.kind].label} · {formatRelative(item.created_at)}
                  </p>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-miku/60 transition group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="pt-1 text-center">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-1 text-[11.5px] text-faint/70 transition hover:text-sakura"
        >
          <Trash className="size-3" />
          删除这条记录
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="删除这条记录？"
        description="删除后无法恢复，与它相关的关联也会一起消失。如果是事情做完了，建议用「归档」或「标记完成」。"
        confirmLabel="删除"
        tone="danger"
        loading={busy === "delete"}
        onConfirm={remove}
        onClose={() => setConfirmOpen(false)}
      />

      {entry.status === "done" && (
        <p className="flex items-center justify-center gap-1.5 pt-2 text-[12px] text-miku">
          <CircleCheck className="size-3.5" />
          已完成
        </p>
      )}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition disabled:opacity-60",
        active
          ? "border-miku/40 bg-miku/15 text-miku"
          : "glass text-muted hover:border-miku/40 hover:text-bright",
      )}
    >
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : children}
    </button>
  );
}
