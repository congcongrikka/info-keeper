/**
 * OpenAI 兼容协议的最小客户端。
 * 兼容 DeepSeek / Kimi(Moonshot) / 通义百炼 / OpenAI / 任何自建 vLLM 网关。
 *
 * 关键约束：本文件只在服务端被 import。API Key 从 process.env 读取，
 * Next.js 不会把非 NEXT_PUBLIC_ 前缀的变量打进浏览器 bundle。
 */

export type ChatRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: ChatRole;
  content: string;
}

export class AiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = "ai_error") {
    super(message);
    this.name = "AiError";
    this.status = status;
    this.code = code;
  }
}

interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";

export function isAiEnabled(): boolean {
  if (process.env.AI_DISABLED === "true") return false;
  return Boolean((process.env.AI_API_KEY ?? "").trim());
}

export function getAiConfig(): AiConfig | null {
  if (!isAiEnabled()) return null;

  const rawBase = (process.env.AI_BASE_URL ?? DEFAULT_BASE_URL).trim();
  const timeout = Number.parseInt(process.env.AI_TIMEOUT_MS ?? "45000", 10);
  const temperature = Number.parseFloat(process.env.AI_TEMPERATURE ?? "0.4");

  return {
    baseUrl: rawBase.replace(/\/+$/, ""),
    apiKey: (process.env.AI_API_KEY ?? "").trim(),
    model: (process.env.AI_MODEL ?? DEFAULT_MODEL).trim(),
    temperature: Number.isFinite(temperature) ? Math.min(Math.max(temperature, 0), 2) : 0.4,
    timeoutMs: Number.isFinite(timeout) ? Math.min(Math.max(timeout, 5000), 120000) : 45000,
  };
}

/**
 * 部分推理模型（Qwen3 系列）默认会先输出一大段思考过程，实测同一条请求
 * 关闭思考后从 3.4s 降到 0.9s。但「下周三」这类相对日期换算会算错，
 * 所以要按调用场景控制：抽取类关掉，分析/问答类保持开启。
 * AI_DISABLE_THINKING=true 可全局关掉（应急用）。
 */
function thinkingParams(explicit?: boolean): Record<string, unknown> {
  const globalOff = process.env.AI_DISABLE_THINKING === "true";
  const enabled = explicit ?? !globalOff;
  return enabled ? {} : { enable_thinking: false };
}

function endpoint(config: AiConfig, path: string) {
  return `${config.baseUrl}${path}`;
}

function authHeaders(config: AiConfig) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };
}

/** 上游错误体可能是 HTML / JSON / 纯文本，尽量抽出人能看懂的一句话 */
function describeUpstreamError(status: number, body: string): string {
  let detail = body.slice(0, 600);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "string") detail = parsed.error;
    else if (parsed.error?.message) detail = parsed.error.message;
    else if (parsed.message) detail = parsed.message;
  } catch {
    /* 保持原文 */
  }

  if (status === 401) return `大模型鉴权失败（401）：请检查 AI_API_KEY 是否正确、是否过期。${detail}`;
  if (status === 402) return `大模型账户余额不足（402）：${detail}`;
  if (status === 429) return `大模型请求过于频繁或额度用尽（429）：${detail}`;
  if (status === 404) return `大模型接口不存在（404）：请检查 AI_BASE_URL 是否需要以 /v1 结尾。${detail}`;
  return `大模型返回 ${status}：${detail}`;
}

/** 把非 AI 错误（网络层：DNS / 连接重置 / TLS）压成一句可读的原因 */
function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
    const parts = [error.name, error.message, cause?.code ?? cause?.message ?? ""];
    return parts.filter(Boolean).join(" / ").slice(0, 300);
  }
  return String(error).slice(0, 300);
}

interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
  /** 覆盖默认超时；报告类长文本可以给更宽的时间 */
  timeoutMs?: number;
  /**
   * 是否让推理模型先输出思考过程。默认开。
   * 纯抽取/分类关掉可省 3~4 倍时间；涉及日期换算、优先级判断的调用要保持开启。
   */
  thinking?: boolean;
}

/**
 * 非流式补全。返回纯文本（JSON 模式下由调用方解析）。
 * 带一次自动重试：只对 429 / 5xx 这类瞬时错误重试，避免重复计费。
 */
export async function complete(
  messages: AiMessage[],
  options: CompletionOptions = {},
): Promise<{ text: string; model: string }> {
  const config = getAiConfig();
  if (!config) throw new AiError("尚未配置大模型 API Key", 503, "ai_not_configured");

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: options.temperature ?? config.temperature,
    stream: false,
    ...thinkingParams(options.thinking),
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (options.json) body.response_format = { type: "json_object" };

  const timeoutMs = Math.min(options.timeoutMs ?? config.timeoutMs, 120000);
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint(config, "/chat/completions"), {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify(body),
        signal,
        cache: "no-store",
      });

      if (!response.ok) {
        const text = await response.text();
        // 部分厂商不支持 response_format，降级再试一次（不算重试次数）
        if (options.json && response.status === 400 && /response_format|json_object/i.test(text)) {
          delete body.response_format;
          throw new AiError(describeUpstreamError(response.status, text), response.status, "retry_without_json_mode");
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new AiError(describeUpstreamError(response.status, text), response.status, "upstream");
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
            continue;
          }
        }
        throw new AiError(describeUpstreamError(response.status, text), response.status, "upstream");
      }

      const payload = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = payload.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) throw new AiError("大模型返回了空内容", 502, "empty_completion");
      return { text, model: payload.model ?? config.model };
    } catch (error) {
      if (error instanceof AiError && error.code === "retry_without_json_mode") {
        try {
          return await complete(messages, { ...options, json: false, signal: options.signal });
        } catch (fallbackError) {
          throw fallbackError instanceof AiError
            ? fallbackError
            : new AiError(`大模型调用失败：${describeUnknownError(fallbackError)}`, 502, "upstream");
        }
      }
      if (error instanceof AiError) {
        lastError = error;
        if (attempt < 2 && (error.status === 429 || error.status >= 500)) {
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
          continue;
        }
        throw error;
      }
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new AiError("大模型响应超时，请稍后重试", 504, "timeout");
      }
      // 网络层异常（DNS / 连接重置 / TLS）：重试，最后把具体原因带出去，便于排查
      lastError = error;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastError instanceof AiError
    ? lastError
    : new AiError(`大模型调用失败：${describeUnknownError(lastError)}`, 502, "upstream");
}

/** 从可能带 ```json 包裹的文本里抠出 JSON 对象 */
export function extractJson<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new AiError("大模型返回的不是合法 JSON", 502, "invalid_json");
  }
}

/**
 * 流式补全：直接把上游 SSE 字节流转发出去（route handler 里再用 TransformStream 注入来源信息）。
 * 返回前会先确认 HTTP 状态，避免把错误当数据流写进响应。
 */
export async function openStream(
  messages: AiMessage[],
  options: { signal?: AbortSignal; maxTokens?: number; temperature?: number; thinking?: boolean } = {},
): Promise<ReadableStream<Uint8Array>> {
  const config = getAiConfig();
  if (!config) throw new AiError("尚未配置大模型 API Key", 503, "ai_not_configured");

  // 流式没有「总时长」概念，给宽一点；真正的中断由客户端 signal 触发
  const timeout = AbortSignal.timeout(Math.max(config.timeoutMs, 120000));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const response = await fetch(endpoint(config, "/chat/completions"), {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: options.temperature ?? config.temperature,
      max_tokens: options.maxTokens ?? 1600,
      stream: true,
      stream_options: { include_usage: false },
      ...thinkingParams(options.thinking),
    }),
    signal,
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new AiError(describeUpstreamError(response.status, text), response.status, "upstream");
  }

  return response.body;
}
