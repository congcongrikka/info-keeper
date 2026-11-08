"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确定",
  cancelLabel = "取消",
  tone = "default",
  loading = false,
  onConfirm,
  onClose,
}: DialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(() => confirmRef.current?.focus(), 30);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, loading, onClose]);

  if (!open) return null;

  return (
    <div
      className="animate-fade fixed inset-0 z-[80] flex items-end justify-center bg-night-2/70 p-4 backdrop-blur-[3px] sm:items-center"
      onClick={() => !loading && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="glass-strong animate-rise w-full max-w-sm rounded-3xl p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="dialog-title" className="text-[1.0625rem] font-semibold tracking-tight text-bright">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="-m-1 rounded-full p-1 text-faint transition hover:bg-white/5 hover:text-bright disabled:opacity-40"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>

        {description ? <div className="mt-2.5 text-sm leading-relaxed text-muted">{description}</div> : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="glass rounded-full px-4 py-2 text-sm text-muted transition hover:text-bright disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-60",
              tone === "danger"
                ? "neon-pink bg-sakura text-night hover:bg-sakura-2"
                : "neon-soft bg-miku text-night hover:bg-miku-3",
            )}
          >
            {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
