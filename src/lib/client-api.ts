"use client";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * 统一的客户端请求封装：
 * - 自动携带 cookie
 * - 401 时跳登录（保留回跳地址）
 * - 把后端的 { error } 转成可直接展示的中文提示
 */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (response.status === 401) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
    throw new ApiError("登录状态已过期", 401, "unauthorized");
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json().catch(() => null)) as { error?: string; code?: string } | null)
    : null;

  if (!response.ok) {
    throw new ApiError(payload?.error ?? `请求失败（${response.status}）`, response.status, payload?.code ?? "error");
  }

  return payload as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) {
    if (error.name === "AbortError") return "已取消";
    return error.message;
  }
  return "出了点问题，请重试";
}
