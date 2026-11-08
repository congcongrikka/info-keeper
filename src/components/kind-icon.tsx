"use client";

import { FileText, Lightbulb, Link2, ListTodo, NotebookPen } from "lucide-react";
import type { EntryKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS = {
  idea: Lightbulb,
  note: NotebookPen,
  task: ListTodo,
  link: Link2,
  reference: FileText,
} as const;

export function KindIcon({ kind, className }: { kind: EntryKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon className={cn("size-4", className)} strokeWidth={1.9} aria-hidden />;
}
