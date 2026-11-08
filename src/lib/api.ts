import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { AiError } from "@/lib/ai/provider";

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "bad_request") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof AiError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error("[api] unhandled error", error);
  return NextResponse.json(
    { error: "服务器内部错误，请稍后重试", code: "internal_error" },
    { status: 500 },
  );
}

/** 每个需要登录的接口都先过这一层；未登录直接 401，前端统一跳登录 */
export async function requireUser(): Promise<{ supabase: SupabaseClient; user: User }> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new HttpError("登录状态已过期，请重新登录", 401, "unauthorized");
  }
  return { supabase, user };
}

/** 简单内存限流：同一用户同一接口 60 秒内最多 N 次，防手滑连点烧 token */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 12, windowMs = 60_000): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    const seconds = Math.ceil((bucket.resetAt - now) / 1000);
    throw new HttpError(`操作太频繁了，请 ${seconds} 秒后再试`, 429, "rate_limited");
  }
  bucket.count += 1;

  if (buckets.size > 2000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
}
