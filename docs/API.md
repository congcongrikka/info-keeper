# API 文档

> 所有接口都遵循同一套约定：**Cookie 会话鉴权 · zod 请求校验 · 统一错误结构 · 用户级限流**。
> 最后更新：2026-11-07 · 对应代码：`src/app/api/**`

---

## 通用约定

### 鉴权

除标记为 **公开** 的接口外，全部走 `requireUser()`（`src/lib/api.ts:37`）：

- 从 Cookie 读取 Supabase 会话
- 无会话或会话过期 → `401 { code: "unauthorized" }`
- 鉴权失败时前端统一跳转 `/login`

**公开接口**：`/api/health`、`/api/auth/register`（GET + POST）、`/api/auth/signout`。

### 错误结构

所有错误响应（`src/lib/api.ts:22`）统一为：

```json
{
  "error": "面向用户的中文提示",
  "code": "机器可读的错误码"
}
```

| 状态码 | 常见 `code` | 含义 |
| --- | --- | --- |
| 400 | `bad_request` / `signup_failed` | 请求本身有问题 |
| 401 | `unauthorized` | 未登录 / 会话过期 |
| 403 | `invalid_invite_code` / `invite_required` | 邀请码校验未通过 |
| 404 | `not_found` | 资源不存在或无权访问 |
| 422 | `invalid_input` / `invalid_id` / `no_entries` | 参数校验失败 / 业务前置条件不满足 |
| 429 | `rate_limited` | 触发限流 |
| 500 | `internal_error` / `query_failed` / `save_failed` / `delete_failed` | 服务端异常 |
| 503 | `ai_not_configured` / `invite_not_configured` / `signup_disabled` | 服务端配置缺失 |

### 限流

内存实现（`src/lib/api.ts:53`），单实例有效；Vercel 多实例下不共享，做为「防手滑」而非「防恶意」：

| 接口 | 维度 | 额度 |
| --- | --- | --- |
| `POST /api/auth/register` | 来源 IP | 8 次 / 分钟 |
| `POST /api/entries` | 用户 | 40 次 / 分钟 |
| `POST /api/entries/:id/analyze` | 用户 | 20 次 / 分钟 |
| `POST /api/ai/chat` | 用户 | 30 次 / 分钟 |
| `POST /api/ai/review` | 用户 | 6 次 / 分钟 |
| `POST /api/ai/tasks` | 用户 | 10 次 / 分钟 |

超限返回 `429 { error: "操作太频繁了，请 N 秒后再试", code: "rate_limited" }`。

### 运行环境

除 `/api/health` 外，所有 Route Handler 都声明：

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

`/api/health` 只声明 `dynamic`（它不碰 Node 专属 API）。

凡是会调模型、耗时可能超过默认上限的接口，再加一行（Vercel 免费版单函数上限 60 秒）：

```ts
export const maxDuration = 60;
```

已加的文件：`api/entries/route.ts:8`、`api/entries/[id]/analyze/route.ts:9`、`api/ai/chat/route.ts:12`、`api/ai/review/route.ts:11`、`api/ai/tasks/route.ts:9`。

---

## 数据结构

### Entry

```ts
interface Entry {
  id: string;                    // uuid
  user_id: string;               // uuid
  kind: "idea" | "note" | "task" | "link" | "reference";
  title: string | null;          // AI 生成或用户填写，≤120 字
  content: string;               // 正文，1–20000 字
  source_url: string | null;     // 来源链接，≤2000 字
  summary: string | null;        // AI 一句话摘要
  key_points: string[];          // AI 提取的重点
  next_actions: string[];        // AI 提取的下一步
  tags: string[];                // AI 打标，每项 ≤24 字、≤12 个
  ai_model: string | null;       // 产出这些字段的模型名
  ai_analyzed_at: string | null; // ISO 时间戳
  status: "inbox" | "active" | "done" | "archived";
  priority: number;              // 1–3
  due_at: string | null;
  created_at: string;
  updated_at: string;
}
```

### EntryLink

```ts
interface EntryLink {
  id: string;
  source_id: string;
  target_id: string;
  relation: "related" | "duplicate" | "follow_up" | "contradicts";
  score: number;
  reason: string | null;
}
```

### Review

```ts
interface Review {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  entry_count: number;
  title: string | null;
  summary: string;
  themes: Array<{ name: string; insight: string }>;
  actions: Array<{ action: string; why: string; priority: number }>;
  open_loops?: string[];
  model: string | null;
  created_at: string;
}
```

---

## 记录（entries）

### `GET /api/entries`

列表 / 检索。**需登录。**

**Query 参数**

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `q` | string | — | 关键词检索（中文三元组匹配） |
| `kind` | enum | — | `idea` / `note` / `task` / `link` / `reference`，非法值忽略 |
| `status` | enum | — | `inbox` / `active` / `done` / `archived`，非法值忽略 |
| `tag` | string | — | 按标签过滤 |
| `limit` | number | `60` | 条数上限 |

**响应** `200`

```json
{ "entries": [ /* Entry[] */ ] }
```

**代码**：`src/app/api/entries/route.ts:19`

---

### `POST /api/entries`

新建记录，并在同一次请求里完成 AI 理解。**需登录 · 限流 40/分钟。**

**请求体**

```json
{
  "content": "周三前把合同发给老王",   // 必填，1–20000 字
  "kind": "task",                      // 可选，"自动识别"时为 null/省略
  "sourceUrl": "https://...",          // 可选，≤2000 字，必须是合法 URL
  "title": "合同事项",                  // 可选，≤120 字
  "analyze": true                      // 可选，默认 true（是否调 AI）
}
```

**响应** `201`

```json
{
  "entry": { /* Entry，含 AI 生成的 title / summary / tags / ... */ },
  "ai": { "applied": true }
}
```

AI 失败时 `ai.applied` 为 `false` 且带 `ai.error`，**但记录本身已经落库**——设计原则是「AI 失败绝不能影响记录这件事」。

**错误**

| 状态 | code | 触发条件 |
| --- | --- | --- |
| 422 | `invalid_input` | `content` 为空或超长 |
| 422 | `invalid_url` | `sourceUrl` 不是合法 URL |
| 429 | `rate_limited` | 超过 40 次/分钟 |
| 503 | `ai_not_configured` | 配了 `analyze: true` 但没 `AI_API_KEY`（记录仍会保存） |

**代码**：`src/app/api/entries/route.ts:44` → 业务编排 `src/lib/services/entries.ts:41`

---

### `PATCH /api/entries/:id`

局部更新。**需登录。**

所有字段可选，但**至少传一个**（空对象返回 422）。

**请求体**（`strict` 模式，未知字段直接报错）

```json
{
  "title": "新标题",              // ≤120 字
  "content": "新正文",            // 1–20000 字
  "kind": "note",
  "status": "done",
  "tags": ["日语N4", "考试"],      // ≤12 个，每个 ≤24 字
  "priority": 2,                  // 1–3
  "due_at": "2026-11-10T12:00:00Z"
}
```

**响应** `200`

```json
{ "entry": { /* Entry */ } }
```

**错误**：`422 invalid_id`（UUID 格式不对）、`422 invalid_input`、`404 not_found`

**代码**：`src/app/api/entries/[id]/route.ts:24`

---

### `DELETE /api/entries/:id`

删除记录，关联一并级联删除。**需登录。**

**响应** `200`

```json
{ "ok": true }
```

**错误**：`422 invalid_id`、`500 delete_failed`

**代码**：`src/app/api/entries/[id]/route.ts:68`

---

### `POST /api/entries/:id/analyze`

重新理解 / 提取重点。**需登录 · 限流 20/分钟。**

**请求体**

```json
{ "mode": "full" }     // full（默认）| points
```

- `mode: "full"` —— 重新生成标题、摘要、标签、重点、下一步、优先级、截止时间，并刷新关联
- `mode: "points"` —— 只抽取重点（关闭思考过程，快 3–4 倍）

**响应** `200`

`mode: "full"`：

```json
{
  "entry": { /* 更新后的 Entry */ },
  "analysis": { /* 模型原始结构化输出 */ },
  "related": [ /* RelatedEntry[] */ ]
}
```

`mode: "points"`：

```json
{
  "entry": { /* Entry */ },
  "points": ["要点 1", "要点 2"]      // ≤8 条
}
```

**错误**：`404 not_found`（条目不存在或不属于你）、`503 ai_not_configured`

**代码**：`src/app/api/entries/[id]/analyze/route.ts:18`

---

## AI

### `POST /api/ai/chat`

流式问答（RAG + SSE）。**需登录 · 限流 30/分钟。**

**请求体**

```json
{
  "question": "我上次那个方案想到哪了？",   // 必填，1–2000 字
  "history": [                             // 可选，≤12 条
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**响应** `200`，`Content-Type: text/event-stream`

事件流格式（`data: <json>\n\n`）：

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `meta` | `{ sources: ChatSource[] }` | 首批下发，出处列表（含 `[1][2]` 编号） |
| `delta` | `{ text: "..." }` | 增量文本块 |
| `done` | `{ ok: true }` | 结束 |
| `error` | `{ error: "...", code: "..." }` | 中途失败 |

```json
// meta 事件里的 ChatSource 结构
{
  "index": 1,
  "id": "uuid",
  "title": "方案初稿",
  "snippet": "前 90 字摘要…",
  "kind": "note",
  "created_at": "2026-11-01T..."
}
```

**检索策略**（`src/app/api/ai/chat/route.ts:47-95`）

1. `extractTerms(question)` 切出检索词
2. `search_entries` RPC 召回 ≤14 条（库内 `auth.uid()` 过滤 + 应用层二次核对）
3. 合并三路：**未完成待办（10） → 关键词命中 → 最近记录（24）**，按此优先级去重
4. 总条数 ≤26，字符预算 20000（单条贡献 `min(len, 900) + 200`，至少保留 8 条）

**错误**：`401`、`422 invalid_input`、`429`、`503 ai_not_configured`

**代码**：`src/app/api/ai/chat/route.ts:31`

---

### `POST /api/ai/review`

生成阶段总结并落库。**需登录 · 限流 6/分钟。**

**请求体**

```json
{ "days": 7 }     // 7 | 30 | 90 | 0（0 = 全部记录，内部按 3650 天算）
```

**响应** `200`

```json
{
  "review": { /* Review */ },
  "open_loops": ["还没回复的邮件", "..."]
}
```

**错误**

| 状态 | code | 触发条件 |
| --- | --- | --- |
| 422 | `invalid_input` | `days` 不在枚举内 |
| 422 | `no_entries` | 该时间段内没有记录 |
| 503 | `ai_not_configured` | 没配 `AI_API_KEY` |
| 500 | `save_failed` | 总结生成成功但入库失败 |

**实现细节**：读取该时间段内最多 120 条记录 + 40 条未完成待办，`temperature: 0.5`、`maxTokens: 2000`、`timeoutMs: 52000`（比默认 45s 长，因为总结任务更重）。

**代码**：`src/app/api/ai/review/route.ts:25`

---

### `POST /api/ai/tasks`

把散落待办整理成结构化计划。**需登录 · 限流 10/分钟。**

**请求体**：无（服务端自己读未完成待办，≤50 条）

**响应** `200`

```json
{
  "plan": {
    "today": [ /* 条目 */ ],
    "this_week": [ /* 条目 */ ],
    "later": [ /* 条目 */ ],
    "stuck": [ /* 条目 */ ],
    "suggest_drop": [ /* 条目 */ ]
  },
  "task_count": 12
}
```

没有待办时直接返回 `{ "plan": EMPTY_PLAN, "task_count": 0 }`，**不调用模型**。

**错误**：`503 ai_not_configured`

**代码**：`src/app/api/ai/tasks/route.ts:21`

---

## 鉴权

### `POST /api/auth/register`

邀请码校验 + 建号。**公开 · 限流 8 次/分钟（按 IP）。**

**请求体**

```json
{
  "email": "user@example.com",          // 必填，合法邮箱，≤200 字
  "password": "至少6位",                 // 必填，6–200 字
  "inviteCode": "abc123",               // 可选（但服务端要求）
  "next": "/entry/xxx"                  // 可选，注册后的回跳路径
}
```

**响应** `201`

```json
{
  "ok": true,
  "status": "signed_in",     // signed_in | pending_confirm
  "user_id": "uuid",
  "redirect_to": "/"
}
```

- `status: "signed_in"` —— 服务端用 Admin API 建号并自动确认邮箱，前端可直接进主页
- `status: "pending_confirm"` —— 走普通 `signUp`，需要用户去邮箱点确认链接

**错误**

| 状态 | code | 触发条件 |
| --- | --- | --- |
| 403 | `invite_required` | 没填邀请码 |
| 403 | `invalid_invite_code` | 邀请码错误 |
| 503 | `invite_not_configured` | 服务端没配 `INVITE_CODE`（fail-closed） |
| 503 | `signup_disabled` | Supabase 关了公开注册，但服务端没配 `SUPABASE_SERVICE_ROLE_KEY` |
| 429 | `rate_limited` | 同 IP 超过 8 次/分钟 |

**邀请码校验逻辑**（`src/lib/invite.ts:45`）：`trim` → `toLowerCase` → 截断 128 字 → `sha256` 摘要 → `timingSafeEqual` → 再比长度。**大小写不敏感**（iOS 键盘会自作主张首字母大写）。

**代码**：`src/app/api/auth/register/route.ts:45`

---

### `GET /api/auth/register`

查询注册通道是否开放。**公开。不泄露邀请码。**

**响应** `200`

```json
{ "signup_open": true }
```

前端用它决定「注册」按钮是否可点。

**代码**：`src/app/api/auth/register/route.ts:169`

---

### `POST /api/auth/signout`

彻底登出。**公开**（会话已失效时也要能用）。

**响应** `303` 重定向到 `/login`，并清掉所有 `sb-*` / `*-auth-token` 分片 Cookie（`maxAge: 0`、`expires: 1970`）。

**为什么不用 Supabase 自带的 `signOut`**：分片 Cookie 的清理不完整，换账号后会看到上一个人的页面壳。

**代码**：`src/app/api/auth/signout/route.ts:23`

> `GET` 同 `POST`（方便点链接直接登出），只重定向不返回敏感信息。

---

## 数据导出

### `GET /api/export`

导出当前用户全部数据。**需登录。**

**响应** `200`，`Content-Disposition: attachment`

```json
{
  "app": "info-keeper",
  "schema_version": 1,
  "exported_at": "2026-11-03T08:00:00.000Z",
  "account": { "id": "uuid", "email": "user@example.com" },
  "counts": { "entries": 42, "entry_links": 17, "reviews": 5 },
  "profile": { /* profiles 单行 */ },
  "entries": [ /* 全部记录 */ ],
  "entry_links": [ /* 全部关联 */ ],
  "reviews": [ /* 全部总结 */ ]
}
```

文件名：`info-keeper-backup-YYYY-MM-DD.json`

**代码**：`src/app/api/export/route.ts:29`

---

## 运维

### `GET /api/health`

健康检查。**公开。**

**响应** `200`

```json
{
  "ok": true,
  "time": "2026-11-03T08:00:00.000Z",
  "supabase": "configured",   // configured | missing
  "ai": "enabled"             // enabled | disabled
}
```

**不查数据库**，只反射环境变量状态，所以不会因为 Supabase 慢而超时。

**代码**：`src/app/api/health/route.ts:7`

---

## 推送订阅

浏览器侧的流程：`Notification.requestPermission()` → `navigator.serviceWorker.ready` →
`pushManager.subscribe({ userVisibleOnly, applicationServerKey })` → 把订阅 POST 上来。
实现在 `src/components/push-toggle.tsx`，设置页「每日早报」卡片。

一条订阅 = 一台设备上的一个浏览器。`endpoint` 是唯一标识，`user_id` 会有多行（手机 + 电脑）。

### `POST /api/push/subscribe`

保存（或刷新）当前设备的订阅。**需登录。**

**请求体**

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": { "p256dh": "BNc...", "auth": "k9..." }
}
```

**响应** `201`

```json
{ "ok": true }
```

**行为**

- 按 `endpoint` upsert：同一台设备重复开启不会重复插入，也不会报唯一约束错
- 顺手记下 `user_agent`，方便排查是哪台设备
- 上限 20 条/账号（`too_many_subscriptions`），防止脚本塞爆表

**错误**

| 状态 | code | 场景 |
| --- | --- | --- |
| 401 | `unauthorized` | 未登录 |
| 422 | `invalid_input` | endpoint/keys 缺失或格式不对 |
| 409 | `too_many_subscriptions` | 该账号已登记 20 台设备 |
| 429 | `rate_limited` | 每分钟超过 20 次 |
| 503 | `push_disabled` | 服务端没配 VAPID 密钥 |

### `DELETE /api/push/subscribe`

关闭提醒。**需登录。** 必须真的删库 —— 只在浏览器里 `unsubscribe()` 的话，
服务端还留着这条，定时任务照发不误。

**请求体**

```json
{ "endpoint": "https://fcm.googleapis.com/fcm/send/..." }
```

**响应** `200` `{ "ok": true }`

**代码**：`src/app/api/push/subscribe/route.ts:44`

### `POST /api/push/test`

给自己名下的设备发一条测试通知，用来验证「订阅 → 推送服务 → 设备」整条链路。
**需登录。** 早报一天只有一次机会，出问题时用户没法自己判断卡在哪一环，所以单独开了这个口子。

只读当前会话用户的订阅（RLS 已锁定范围），**不用 service_role**，所以它没有「给任意人发通知」的能力。

**请求**：无 body。

**响应** `200`

```json
{ "sent": 1, "failed": 0, "detail": null }
```

| 字段 | 含义 |
| --- | --- |
| `sent` | 成功发出的条数 |
| `failed` | 失败条数 |
| `detail` | 给用户看的一句话说明；一切正常时为 `null` |

订阅列表为空时返回 `{"sent":0,"failed":0,"detail":"数据库里没有这台设备的订阅记录……"}`，
说明「开启」那一步没有把订阅写进库。

**错误**

| 状态 | code | 场景 |
| --- | --- | --- |
| 401 | `unauthorized` | 未登录 |
| 429 | `rate_limited` | 每分钟超过 5 次 |
| 503 | `push_disabled` | 服务端没配 VAPID 密钥 |

**代码**：`src/app/api/push/test/route.ts:22`

---

## 邮件早报

安卓手机上的 Web Push 最后都要经过 Google 的 FCM 通道（Chrome / Edge / Firefox 无一例外），
国行手机没有 Google 服务就拿不到推送。邮件走普通 SMTP，不依赖浏览器通道，是手机端的兜底方案。

### `GET /api/push/email`

读当前用户的邮件早报开关。**需登录。**

**响应** `200`

```json
{ "enabled": true, "configured": true, "email": "you@example.com" }
```

| 字段 | 含义 |
| --- | --- |
| `enabled` | 这一位用户在 `profiles.digest_enabled` 里的开关 |
| `configured` | 服务端有没有配 SMTP（没配则前端禁用按钮并说明原因） |
| `email` | 收件地址，就是登录邮箱 —— 不额外收集别的地址 |

**错误**

| 状态 | code | 场景 |
| --- | --- | --- |
| 401 | `unauthorized` | 未登录 |
| 500 | `db_error` | 读 `profiles` 失败 |

### `PUT /api/push/email`

开关邮件早报。**需登录。**

**请求**

```json
{ "enabled": true }
```

写的是 `profiles.digest_enabled`（每用户一行，天然唯一）。用 `upsert` 而非 `update`：
历史上若缺 `profiles` 行，`update` 会静默改 0 行，用户以为开了其实没开。

**响应** `200`：`{ "enabled": true }`

**错误**

| 状态 | code | 场景 |
| --- | --- | --- |
| 400 | `no_email` | 当前账号没有邮箱 |
| 401 | `unauthorized` | 未登录 |
| 422 | `invalid_input` | body 不是 `{enabled: boolean}` |
| 429 | `rate_limited` | 每分钟超过 20 次 |
| 500 | `db_error` | 写库失败 |
| 503 | `email_disabled` | 想开启，但服务端没配 SMTP |

### `POST /api/push/email`

立刻给自己发一封试用邮件。开启只是写库，不会马上发信，用户没法确认配置对不对。**需登录。**

有待办就发真实早报的样子；没有待办也发一封「测试邮件：链路是通的」——
测试通道时不该因为恰好没待办让人以为邮件功能坏了。

**请求**：无 body。

**响应** `200`：`{ "ok": true, "to": "you@example.com" }`

**错误**

| 状态 | code | 场景 |
| --- | --- | --- |
| 400 | `no_email` | 当前账号没有邮箱 |
| 401 | `unauthorized` | 未登录 |
| 429 | `rate_limited` | 每分钟超过 3 次 |
| 500 | `send_failed` | SMTP 投递失败（错误原因在 `error` 里） |
| 503 | `email_disabled` | 服务端没配 SMTP |

投递失败返回 **500 而不是 200 + `ok:false`** —— 前端要能一眼区分「发出去了」和「没发出去」。

**代码**：`src/app/api/push/email/route.ts:38`

---

## 定时任务

### `GET /api/cron/daily-reminder`

每天早上 8:00（北京时间）由 Vercel Cron 调起，给有待办的用户发早报。**公开路径，但需要密钥。**

两条通道，谁配好了走谁，都配好就都走：

- **Web Push** —— 桌面 Edge / 装了 Google 服务的安卓 / iOS 主屏 PWA
- **邮件** —— 走普通 SMTP，不依赖浏览器推送通道，给安卓国行这类收不到 FCM 的设备兜底

> Vercel 的 cron 用 **UTC**。北京时间 8:00 = 前一天 24:00 UTC，所以表达式是 `0 0 * * *`。

**鉴权**：`Authorization: Bearer <CRON_SECRET>`。
Vercel 配了 `CRON_SECRET` 环境变量后会自动带上这个头。
**没配 `CRON_SECRET` 时接口直接返回 503**（fail-closed）—— 宁可早报停一天，也不能让它裸奔。

**流程**

1. `public.pending_task_counts()` 一次拿到「谁有几件待办」（`kind='task' and status in ('inbox','active')`），避免逐用户 N+1
2. 推送：分块按 `user_id` 取 `push_subscriptions`，按人分别组装文案；分批并发发送（每批 20 条，避免一次打开几百个 socket 被推送服务限流）；返回 **404/410** 的订阅当场删库（这些端点已永久失效）
3. 邮件：`public.digest_recipients()` 拿到「开了邮件早报的人 + 邮箱」，**只给有待办的人发**；逐人拉待办标题、组装深色 HTML 邮件、并发投递

**响应** `200`

```json
{
  "usersWithTasks": 3,
  "subscribedUsers": 2,
  "sent": 2,
  "failed": 0,
  "pruned": 1,
  "pruneFailed": 0,
  "skipped": 0,
  "emailRecipients": 1,
  "emailSent": 1,
  "emailFailed": 0,
  "channels": ["push", "email"],
  "durationMs": 812
}
```

| 字段 | 含义 |
| --- | --- |
| `usersWithTasks` | 这一轮有待办的用户数 |
| `subscribedUsers` | 其中有推送订阅的 |
| `sent` | 实际发成功的条数（一个人两台设备算 2） |
| `failed` | 失败但订阅保留（网络/限流/5xx），下次再试 |
| `pruned` | 已失效、这一轮删掉的订阅数 |
| `pruneFailed` | 删除失败数（会在下次日志里再看到） |
| `skipped` | 防御性跳过（订阅的 user 不在待办统计里，正常应为 0） |
| `emailRecipients` | 开了邮件早报且今天有待办的人数 |
| `emailSent` | 邮件投递成功数 |
| `emailFailed` | 邮件投递失败数 |
| `channels` | 这一轮实际用了哪些通道，方便在 Vercel 日志里一眼看出走的是哪条路 |
| `durationMs` | 本轮耗时 |

**错误**

| 状态 | code | 场景 |
| --- | --- | --- |
| 401 | `unauthorized` | 没带或带错 CRON_SECRET |
| 503 | `cron_disabled` | 没配 CRON_SECRET / 缺 `SUPABASE_SERVICE_ROLE_KEY` |
| 503 | `push_disabled` | VAPID 和 SMTP **两条通道都没配** |
| 500 | `db_error` | 聚合或读订阅失败（`42501` 会额外提示去跑 grant） |

**为什么要 service_role**：定时任务没有登录用户，RLS 会把它当匿名，一条数据都查不到。
所以它用 `src/lib/supabase/admin.ts` 的特权客户端 —— 那个客户端**绕过 RLS**，
所以 `pending_task_counts()` / `digest_recipients()` 只授给 `service_role`，普通登录用户调不动。

**邮件挂了不能让整轮失败**：`digest_recipients()` 出错时只记日志、不抛错 ——
推送已经发出去了，抛错只会让 Vercel 把这轮标记成失败、下次还报警。

**代码**：`src/app/api/cron/daily-reminder/route.ts:126`

---

## 路由守卫

`src/proxy.ts` 是 Next 16 的请求守卫（原 middleware），职责：

1. **每次请求刷新 Supabase 会话 Cookie** —— access token 一小时后过期，不刷新会被踢出
2. **未登录拦截** —— 页面 302 到 `/login?next=...`，API 返回 401 JSON

**公开路径白名单**（`src/proxy.ts:4`）：

```
/login  /auth  /offline  /api/health  /api/auth/register  /api/auth/signout  /api/cron
/manifest.webmanifest  /sw.js  /favicon.ico  /icons/  /apple-touch-icon.png
```

加新公开路由时**必须**同步这个数组，否则会被拦在登录页。

`/api/cron` 放行的只是「不需要登录 cookie」，它靠 `CRON_SECRET` 自证身份（见上文）。

---

## 扩展指引

### 新增一个接口

1. 在 `src/app/api/<领域>/route.ts` 建文件
2. 声明 `runtime = "nodejs"` 和 `dynamic = "force-dynamic"`
3. 第一行调 `requireUser()`（需要登录时）
4. 用 zod 定义 `bodySchema`，`safeParse` 后取 `parsed.data`
5. 需要限流就调 `rateLimit(key, limit, windowMs)`
6. 抛 `HttpError(message, status, code)`，由 `errorResponse()` 统一转换
7. 返回 `jsonOk(data, init?)`

### 新增一张表

见 [MAINTENANCE.md § 4](MAINTENANCE.md#4-数据库变更流程)。**四个地方要同步改**：

`supabase/schema.sql` → `src/lib/types.ts` → `src/lib/db.ts`（`ENTRY_COLUMNS` 或新建查询函数）→ `src/lib/ai/normalize.ts`（如需 hydrate）。

另外两条容易忘的：

- **授权段**：新表要在 `schema.sql` 第 11 段补 `revoke all ... from anon` + `grant ... to authenticated`，否则 PostgREST 报权限错误。
- **后台任务的表**（如 `push_subscriptions`）不走 `db.ts`，而是在 cron 路由里用 `src/lib/supabase/admin.ts` 的特权客户端，
  并且每个查询都显式带 `user_id` 或 `id` 条件 —— 那个客户端绕过 RLS，没有第二道锁。
