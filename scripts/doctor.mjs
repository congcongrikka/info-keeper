/**
 * 启动前自检：npm run doctor
 * 只读取 .env.local，不打印任何完整密钥；不会写入数据库。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, ".env.local");

const ok = (label, detail = "") => console.log(`  ✓ ${label}${detail ? `  ${detail}` : ""}`);
const warn = (label, detail = "") => console.log(`  ! ${label}${detail ? `  ${detail}` : ""}`);
const bad = (label, detail = "") => console.log(`  ✗ ${label}${detail ? `  ${detail}` : ""}`);

if (!existsSync(FILE)) {
  console.log("没有找到 .env.local。先执行：cp .env.example .env.local");
  process.exit(1);
}

const env = {};
for (const line of readFileSync(FILE, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!match) continue;
  env[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
}

console.log("\n环境变量");
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const aiKey = env.AI_API_KEY ?? "";

let urlProblem = false;

if (!url) {
  bad("NEXT_PUBLIC_SUPABASE_URL", "为空");
  urlProblem = true;
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
  urlProblem = true;
  if (/\/rest\/v1/.test(url)) {
    bad(
      "NEXT_PUBLIC_SUPABASE_URL",
      `填的是 REST 端点，去掉 /rest/v1/ 只留域名：${url.replace(/\/rest\/v1\/?$/, "")}`,
    );
  } else {
    bad("NEXT_PUBLIC_SUPABASE_URL", `格式不对，应为 https://<项目ref>.supabase.co，当前：${url}`);
  }
} else {
  ok("NEXT_PUBLIC_SUPABASE_URL", url);
}

if (!key) bad("NEXT_PUBLIC_SUPABASE_ANON_KEY", "为空");
else if (key.startsWith("sb_secret_")) bad("NEXT_PUBLIC_SUPABASE_ANON_KEY", "这是 secret key，会绕过 RLS，必须换成可公开密钥");
else if (key.startsWith("sb_publishable_")) ok("NEXT_PUBLIC_SUPABASE_ANON_KEY", `publishable，长度 ${key.length}`);
else if (key.startsWith("eyJ")) ok("NEXT_PUBLIC_SUPABASE_ANON_KEY", `JWT anon，长度 ${key.length}`);
else warn("NEXT_PUBLIC_SUPABASE_ANON_KEY", `无法识别的格式，长度 ${key.length}`);

if (!aiKey) warn("AI_API_KEY", "未填 —— 仍可记录/检索/导出，只是没有自动整理");
else ok("AI_API_KEY", `已配置，长度 ${aiKey.length}`);
ok("AI_MODEL", env.AI_MODEL || "(默认 deepseek-chat)");
ok("AI_BASE_URL", env.AI_BASE_URL || "(默认 https://api.deepseek.com/v1)");

console.log("\n连通性");
if (url && key) {
  try {
    const health = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/health`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(15000),
    });
    const body = await health.text();
    if (health.ok) ok("可以连上 Supabase Auth", body.slice(0, 60));
    else bad("Supabase Auth 返回异常", `${health.status} ${body.slice(0, 120)}`);
  } catch (error) {
    bad("连不上 Supabase", error instanceof Error ? error.message : String(error));
  }

  try {
    const rest = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/entries?select=id&limit=1`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(15000),
    });
    const body = await rest.text();
    if (rest.ok) {
      ok("数据表可访问", `返回 ${body.trim() || "[]"}（未登录状态下空结果是正常的）`);
    } else if (/permission denied/i.test(body)) {
      ok("数据表存在，且 anon 已被正确拒绝", "这正是我们想要的状态");
    } else if (/relation .* does not exist|schema cache/i.test(body)) {
      bad("找不到 entries 表", "schema.sql 没跑，或跑到了别的项目");
    } else if (/invalid api key|jwt/i.test(body)) {
      bad("密钥无效", body.slice(0, 120));
    } else {
      warn("数据表请求返回异常", `${rest.status} ${body.slice(0, 120)}`);
    }
  } catch (error) {
    bad("连不上 PostgREST", error instanceof Error ? error.message : String(error));
  }
}

if (aiKey && process.argv.includes("--ai")) {
  console.log("\n模型连通性（会消耗几个 token）");
  const base = (env.AI_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = env.AI_MODEL || "deepseek-chat";
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "只回复两个字：可以" }],
        max_tokens: 12,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    if (response.ok) {
      const payload = JSON.parse(text);
      const reply = payload.choices?.[0]?.message?.content ?? "";
      ok(`模型可用（${model}）`, `回复：${String(reply).slice(0, 20)}`);
    } else if (response.status === 401 || response.status === 403) {
      bad("模型鉴权失败", `AI_API_KEY 可能不对或没有该模型权限（${response.status}）`);
    } else if (response.status === 404) {
      bad("模型接口不存在", "检查 AI_BASE_URL 是否以 /v1 结尾、AI_MODEL 是否拼对");
    } else {
      bad(`模型返回 ${response.status}`, text.slice(0, 160));
    }
  } catch (error) {
    bad("连不上模型", error instanceof Error ? error.message : String(error));
  }
}

console.log("\n结论");
if (!url || !key || urlProblem) {
  console.log("  先把 Supabase 的两个值补齐/改对，再跑 npm run dev。");
  process.exit(1);
}
if (key.startsWith("sb_secret_")) {
  console.log("  去 Supabase → Project Settings → API 换成「可公开密钥 / publishable key」。");
  process.exit(1);
}
console.log("  配置看起来没问题，可以 npm run dev 了。");
