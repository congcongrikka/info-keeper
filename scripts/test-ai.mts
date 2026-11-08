/**
 * 本地联调脚本：用一个假的 OpenAI 兼容服务验证 AI 层，
 * 不需要真实的 DeepSeek/Kimi Key，也不产生费用。
 *
 * 运行：npx tsx scripts/test-ai.ts
 */
import http from "node:http";
import assert from "node:assert/strict";

process.env.AI_BASE_URL = "http://127.0.0.1:4321/v1";
process.env.AI_API_KEY = "test-key";
process.env.AI_MODEL = "mock-model";
process.env.AI_TIMEOUT_MS = "8000";

const ANALYSIS = {
  title: "把离线优先做进记录流程",
  kind: "idea",
  summary: "考虑用本地队列承接弱网写入，联网后再同步。",
  tags: ["产品", "离线"],
  key_points: ["地铁里没信号时记录会失败"],
  next_actions: ["写一页 IndexedDB 方案对比"],
  priority: 3,
  due_at: null,
  related_ids: ["11111111-1111-4111-8111-111111111111", "not-a-uuid"],
  relation_reason: "同一套存储策略",
};

let callCount = 0;

const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    const payload = JSON.parse(body || "{}") as {
      stream?: boolean;
      response_format?: { type?: string };
    };
    callCount += 1;

    // 第一次调用故意 500，验证自动重试
    if (callCount === 1) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "mock transient failure" } }));
      return;
    }

    if (payload.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const pieces = ["你好", "，我是", "管家", "。"];
      for (const piece of pieces) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      }
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }

    const content = payload.response_format
      ? "```json\n" + JSON.stringify(ANALYSIS) + "\n```"
      : "纯文本回答";

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ model: "mock-model", choices: [{ message: { content } }] }),
    );
  });
});

await new Promise<void>((resolve) => server.listen(4321, "127.0.0.1", resolve));

const { complete, extractJson, openStream, isAiEnabled } = await import("../src/lib/ai/provider");
const { normalizeAnalysis } = await import("../src/lib/ai/normalize");

assert.equal(isAiEnabled(), true, "AI 应该被识别为已启用");

// 1. JSON 模式 + 代码块剥离 + 自动重试
const completion = await complete([{ role: "user", content: "整理这条记录" }], { json: true });
assert.equal(completion.model, "mock-model");
const parsed = extractJson<Record<string, unknown>>(completion.text);
assert.equal(parsed.title, ANALYSIS.title);
console.log("✓ JSON 补全与重试正常");

// 2. 归一化：脏数据要收敛，不能写进数据库
const normalized = normalizeAnalysis({
  title: "  标题  ",
  kind: "unknown-kind",
  tags: ["#产品", "产品", "", "离线"],
  priority: 9,
  due_at: "不是日期",
  related_ids: [],
  key_points: "not-an-array",
});
assert.equal(normalized.kind, "note");
assert.equal(normalized.priority, 3);
assert.equal(normalized.due_at, null);
assert.deepEqual(normalized.tags, ["产品", "离线"]);
assert.deepEqual(normalized.key_points, []);
assert.equal(normalized.title, "标题");
console.log("✓ 模型输出归一化正常");

// 3. 流式输出
const stream = await openStream([{ role: "user", content: "你好" }]);
const reader = stream.getReader();
const decoder = new TextDecoder();
let text = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  text += decoder.decode(value, { stream: true });
}
const deltas = text
  .split("\n\n")
  .filter((line) => line.startsWith("data: {"))
  .map((line) => {
    const payload = JSON.parse(line.slice(6)) as { choices: Array<{ delta: { content?: string } }> };
    return payload.choices[0]?.delta.content ?? "";
  })
  .join("");
assert.equal(deltas, "你好，我是管家。");
assert.ok(text.includes("[DONE]"), "流应该包含结束标记");
console.log("✓ 流式输出正常");

server.close();
console.log("\n全部通过。");
