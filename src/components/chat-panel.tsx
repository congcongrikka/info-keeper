"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Music, Square } from "lucide-react";
import type { ChatMessage, ChatSource } from "@/lib/types";
import { KIND_META } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MikuAvatar } from "@/components/miku-art";
import { useToast } from "@/components/ui/toast";

const SUGGESTIONS = [
  "我最近都在忙什么？",
  "有哪些事一直没做完？",
  "把我关于项目的想法汇总一下",
  "这周有什么值得注意的变化？",
];

interface ChatPanelProps {
  entryCount: number;
  aiEnabled: boolean;
  email: string;
}

export function ChatPanel({ entryCount, aiEnabled, email }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    window.setTimeout(() => scrollRef.current?.scrollIntoView({ behavior, block: "end" }), 40);
  };

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || streaming) return;
    if (!aiEnabled) {
      toast("还没有配置大模型 API Key，去设置里看看怎么配", "info");
      return;
    }

    const history = messages.slice(-8).map((message) => ({ role: message.role, content: message.content }));
    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "", sources: [] }]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setStreaming(true);
    scrollToBottom();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `请求失败（${response.status}）`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let sources: ChatSource[] = [];
      let lastFlush = 0;

      const flush = () => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, content: answer, sources };
          }
          return next;
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          let event: {
            type?: string;
            sources?: ChatSource[];
            message?: string;
            choices?: Array<{ delta?: { content?: string } }>;
          };
          try {
            event = JSON.parse(payload);
          } catch {
            continue; // 半截事件，等下一个 chunk 补齐
          }

          if (event.type === "sources" && event.sources) {
            sources = event.sources;
          } else if (event.type === "error") {
            throw new Error(event.message ?? "回答中断");
          } else {
            const delta = event.choices?.[0]?.delta?.content;
            if (delta) {
              answer += delta;
              const now = Date.now();
              if (now - lastFlush > 60) {
                lastFlush = now;
                flush();
              }
            }
          }
        }
      }

      if (!answer.trim()) {
        answer = "我这边没拿到回答，要不再问一次？";
      }
      flush();
      scrollToBottom();
    } catch (error) {
      if (controller.signal.aborted) {
        scrollToBottom();
      } else {
        const message = error instanceof Error ? error.message : "回答失败了，请重试";
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && !last.content) {
            next.pop();
          }
          return next;
        });
        toast(message, "error");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      textareaRef.current?.focus();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  };

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-tight sm:text-[30px]">
          问我
          <span className="text-miku neon-text">♪</span>
        </h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
          我读过你的 {entryCount} 条记录。回答只基于你自己写下过的东西。
        </p>
      </header>

      {messages.length === 0 ? (
        <div className="animate-fade flex flex-1 flex-col justify-center pb-10">
          <div className="glass-strong rounded-3xl p-6">
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <MikuAvatar className="size-8 rounded-lg" />
              <span>你可以这样问</span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="glass-card group flex items-center justify-between gap-2 rounded-2xl px-3.5 py-3 text-left text-[13px] text-muted transition hover:-translate-y-0.5 hover:border-miku/50 hover:text-bright"
                >
                  {suggestion}
                  <span className="text-miku transition group-hover:translate-x-0.5">♪</span>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-6 text-center text-[11.5px] leading-relaxed text-faint/80">
            回答里的 [1] [2] 是记录编号，下面会列出出处，点一下就能跳过去。
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-5 pb-4">
          {messages.map((message, index) => (
            <div key={index} className="animate-rise">
              {message.role === "user" ? (
                <div className="flex justify-end">
                  <p className="neon-soft max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-miku to-miku-2 px-4 py-2.5 text-[13.5px] font-medium leading-relaxed text-night">
                    {message.content}
                  </p>
                </div>
              ) : (
                <div className="flex max-w-full items-start gap-2.5">
                  <MikuAvatar className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="mb-1.5 text-[11px] text-faint">管家</p>

                    <div className="glass-strong rounded-2xl rounded-tl-md border-miku/30 px-4 py-3">
                      {message.content ? (
                        <RichText text={message.content} />
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-faint">
                          <span className="inline-flex items-center gap-0.5 text-miku">
                            <span className="animate-note">♪</span>
                            <span className="animate-note" style={{ animationDelay: "0.18s" }}>
                              ♫
                            </span>
                            <span className="animate-note" style={{ animationDelay: "0.36s" }}>
                              ♪
                            </span>
                          </span>
                          在翻你的记录…
                        </span>
                      )}
                      {streaming && index === messages.length - 1 && message.content && (
                        <span className="animate-caret ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] bg-miku" />
                      )}
                    </div>

                    {message.sources && message.sources.length > 0 && (
                      <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-1">
                        {message.sources.slice(0, 6).map((source, sourceIndex) => (
                          <Link
                            key={`${source.id}-${sourceIndex}`}
                            href={`/entry/${source.id}`}
                            className="glass-card group flex max-w-[190px] shrink-0 items-start gap-1.5 rounded-xl px-2.5 py-1.5 transition hover:border-miku/50"
                          >
                            <span className="mt-[1px] font-mono text-[10px] text-miku">{sourceIndex + 1}</span>
                            <span className="min-w-0">
                              <span className="block truncate text-[11.5px] text-muted">{source.title}</span>
                              <span className="block text-[10px] text-faint">{KIND_META[source.kind].label}</span>
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={scrollRef} />
        </div>
      )}

      <div className="sticky bottom-[76px] z-20 mt-auto pt-2 md:bottom-3">
        <div className="chat-input-shell glass-strong rounded-3xl p-2 transition">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                const element = event.target;
                element.style.height = "auto";
                element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
              }}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={aiEnabled ? "问点什么，比如「上次那个方案我想到哪了」" : "配置 AI 后才能提问"}
              disabled={!aiEnabled}
              className="max-h-[132px] flex-1 resize-none bg-transparent px-3 py-2 text-[14px] leading-relaxed text-bright outline-none placeholder:text-faint/80 disabled:cursor-not-allowed"
              aria-label="输入问题"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                className="glass mb-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sakura transition hover:neon-pink"
                aria-label="停止生成"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={!input.trim() || !aiEnabled}
                className="neon-soft mb-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-miku text-night transition hover:neon disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-faint"
                aria-label="发送"
              >
                <Music className="size-4" />
              </button>
            )}
          </div>
        </div>
        <p className="mt-1.5 px-2 text-center text-[10.5px] text-faint/70">
          Enter 发送 · Shift + Enter 换行 · 回答由 {email.split("@")[0] || "你"} 的记录生成
        </p>
      </div>
    </div>
  );
}

/** 轻量 Markdown：只处理段落、无序/有序列表和 **加粗**，避免引入额外依赖 */
function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="my-1.5 space-y-1">
        {list.map((item, index) => (
          <li key={index} className="flex gap-2 text-[13.5px] leading-[1.8] text-muted">
            <span className="mt-[9px] size-1 shrink-0 rounded-full bg-miku neon-soft" />
            <span>{inline(item)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*·]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1] ?? "");
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    blocks.push(
      <p key={`p-${blocks.length}`} className="my-1 text-[13.5px] leading-[1.85] text-muted">
        {inline(line)}
      </p>,
    );
  }
  flushList();

  return <div className="prose-chat">{blocks}</div>;
}

function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className="font-semibold text-bright">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}
