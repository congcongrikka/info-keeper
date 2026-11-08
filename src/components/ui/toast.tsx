"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  tone: Tone;
}

interface ToastApi {
  toast: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_STYLE: Record<Tone, string> = {
  success: "border-miku/40 bg-night-2/85 text-miku",
  error: "border-sakura/40 bg-night-2/85 text-sakura",
  info: "border-miku/25 bg-night-2/85 text-muted",
};

const TONE_ICON = {
  success: CircleCheck,
  error: TriangleAlert,
  info: Info,
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: Tone = "info") => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setItems((prev) => [...prev.slice(-2), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), 3800);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4 md:bottom-8">
        {items.map((item) => {
          const Icon = TONE_ICON[item.tone];
          return (
            <div
              key={item.id}
              role="status"
              className={cn(
                "animate-rise pointer-events-auto flex max-w-md items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm backdrop-blur-xl",
                TONE_STYLE[item.tone],
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
              <span className="leading-relaxed">{item.message}</span>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="ml-1 shrink-0 rounded-full p-0.5 opacity-50 transition hover:opacity-100"
                aria-label="关闭提示"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast 必须在 ToastProvider 内使用");
  return context;
}
