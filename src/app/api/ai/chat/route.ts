import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, rateLimit, requireUser } from "@/lib/api";
import { listEntries, listOpenTasks } from "@/lib/db";
import { hydrateEntry, toSource } from "@/lib/ai/normalize";
import { buildChatMessages } from "@/lib/ai/prompts";
import { isAiEnabled, openStream } from "@/lib/ai/provider";
import { extractTerms } from "@/lib/search";
import type { Entry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  question: z.string().trim().min(1, "问题不能为空").max(2000, "问题太长了"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(6000),
      }),
    )
    .max(12)
    .optional(),
});

/** 粗略的上下文字符预算，避免长记录把 token 打爆 */
const CONTEXT_BUDGET = 20000;

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    rateLimit(`ai:chat:${user.id}`, 30, 60_000);

    if (!isAiEnabled()) {
      throw new HttpError("尚未配置大模型 API Key，无法问答。请先在服务端环境变量里配置 AI_API_KEY。", 503, "ai_not_configured");
    }

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message ?? "请求参数不正确", 422, "invalid_input");
    }
    const { question, history = [] } = parsed.data;

    // ---- 检索：待办 + 关键词命中 + 最近记录，去重后按预算裁剪 ----
    const terms = extractTerms(question);
    const matched: Entry[] = [];

    if (terms.length) {
      const { data } = await supabase.rpc("search_entries", {
        terms,
        max_rows: 14,
        exclude_id: null,
      });
      if (Array.isArray(data)) {
        // 函数内部已按 auth.uid() 过滤，这里再核一遍 user_id，避免函数被改坏时越权
        for (const row of data) {
          const entry = hydrateEntry(row as Record<string, unknown>);
          if (entry.user_id === user.id) matched.push(entry);
        }
      }
    }

    const [recent, openTasks] = await Promise.all([
      listEntries(supabase, { userId: user.id, limit: 24 }),
      listOpenTasks(supabase, user.id, 10),
    ]);

    const selected: Entry[] = [];
    const seen = new Set<string>();
    for (const group of [openTasks, matched, recent]) {
      for (const entry of group) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        selected.push(entry);
        if (selected.length >= 26) break;
      }
      if (selected.length >= 26) break;
    }

    const budgeted: Entry[] = [];
    let used = 0;
    for (const entry of selected) {
      const cost = Math.min(entry.content.length, 900) + 200;
      if (used + cost > CONTEXT_BUDGET && budgeted.length >= 8) break;
      used += cost;
      budgeted.push(entry);
    }

    const messages = buildChatMessages({
      question,
      history,
      entries: budgeted,
    });

    const upstream = await openStream(messages, { signal: request.signal, maxTokens: 1500 });
    const sources = budgeted.map((entry) => toSource(entry));

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // 客户端断开（点「停止」或关页面）后 controller 会失效，
        // 所有写入都做成可失败的，避免在服务端抛 unhandled rejection。
        let closed = false;
        const push = (chunk: string | Uint8Array) => {
          if (closed) return;
          try {
            controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
          } catch {
            closed = true;
          }
        };
        const finish = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            /* 已关闭 */
          }
        };

        // 先把来源推给前端，回答过程中就能显示「参考了哪几条」
        push(`data: ${JSON.stringify({ type: "sources", sources })}\n\n`);

        const reader = upstream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            push(value);

            // 顺带记录是否已经收到 [DONE]，用于兜底补一个结束事件
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 8000) buffer = buffer.slice(-8000);
          }
        } catch (error) {
          console.error("[chat] 流中断", error);
          push(`data: ${JSON.stringify({ type: "error", message: "回答中断了，请重试" })}\n\n`);
        } finally {
          if (!buffer.includes("[DONE]")) push("data: [DONE]\n\n");
          finish();
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
