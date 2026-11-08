"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, Sparkles } from "lucide-react";
import { ENTRY_KINDS, KIND_META, type EntryKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";

interface CaptureBoxProps {
  onSubmit: (input: { content: string; kind: EntryKind | null }) => Promise<void>;
  aiEnabled: boolean;
}

const PLACEHOLDERS = [
  "随手写点什么：一个念头、一件要做的事、看到的一段话…",
  "把脑子里悬着的事倒出来，剩下的交给我。",
  "粘贴一段文字或链接，我会读完之后整理好。",
  "想到什么就写什么，不用分类。",
];

export function CaptureBox({ onSubmit, aiEnabled }: CaptureBoxProps) {
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<EntryKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placeholder, setPlaceholder] = useState(PLACEHOLDERS[0]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    setPlaceholder(PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)] ?? PLACEHOLDERS[0]);
  }, []);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 260)}px`;
  }, [content]);

  const submit = async () => {
    const text = content.trim();
    if (!text || submitting) return;

    setSubmitting(true);
    try {
      await onSubmit({ content: text, kind });
      setContent("");
      setKind(null);
      toast(
        aiEnabled ? "已收好，正在读它…" : "已收好",
        "success",
      );
      textareaRef.current?.focus();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <section className="glass-strong relative overflow-hidden rounded-3xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-miku/60 to-transparent" />

      <div className="flex items-center justify-between px-4 pt-3.5 sm:px-5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-faint">
          <span className="neon-soft size-1.5 rounded-full bg-miku" />
          快速记录
        </span>
        <span className="hidden text-[11px] text-faint sm:block">
          <kbd className="rounded border border-miku/25 bg-white/5 px-1.5 py-0.5 font-sans text-[10px]">⌘</kbd>
          <span className="mx-0.5">+</span>
          <kbd className="rounded border border-miku/25 bg-white/5 px-1.5 py-0.5 font-sans text-[10px]">Enter</kbd>
          <span className="ml-1.5">保存</span>
        </span>
      </div>

      <textarea
        ref={textareaRef}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={placeholder}
        className="mt-2 block max-h-[260px] w-full resize-none bg-transparent px-4 py-1 text-[15px] leading-[1.75] text-bright outline-none placeholder:text-faint/70 sm:px-5 sm:text-base"
        aria-label="记录内容"
      />

      <div className="mt-1 flex items-center justify-between gap-3 border-t border-miku/15 px-3 py-2.5 sm:px-4">
        <div className="no-scrollbar -mx-1 flex flex-1 items-center gap-1 overflow-x-auto px-1 [mask-image:linear-gradient(to_right,#000_86%,transparent)] sm:[mask-image:none]">
          <button
            type="button"
            onClick={() => setKind(null)}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11.5px] transition sm:text-[12px]",
              kind === null
                ? "neon-soft bg-miku text-night"
                : "text-faint hover:bg-white/5 hover:text-bright",
            )}
          >
            自动识别
          </button>
          {ENTRY_KINDS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setKind(item)}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[11.5px] transition sm:text-[12px]",
                kind === item
                  ? "neon-soft bg-miku text-night"
                  : "text-faint hover:bg-white/5 hover:text-bright",
              )}
            >
              {KIND_META[item].label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!content.trim() || submitting}
          className="neon-soft inline-flex shrink-0 items-center gap-1.5 rounded-full bg-miku px-3 py-2 text-[12.5px] font-medium text-night transition hover:neon hover:bg-miku-3 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-faint sm:px-3.5 sm:text-[13px]"
        >
          {submitting ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : aiEnabled ? (
            <Sparkles className="size-3.5" />
          ) : (
            <ArrowUpRight className="size-3.5" />
          )}
          {submitting ? "收好中" : "记下来"}
        </button>
      </div>
    </section>
  );
}
