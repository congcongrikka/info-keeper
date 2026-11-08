# 开发规范

> 目标：让这个项目在你半年后回来、或者另一个开发者接手时，**不需要重新理解一遍**。
> 最后更新：2026-11-03

---

## 目录

1. [核心原则](#1-核心原则)
2. [目录划分逻辑](#2-目录划分逻辑)
3. [命名约定](#3-命名约定)
4. [组件编写规范](#4-组件编写规范)
5. [服务端代码规范](#5-服务端代码规范)
6. [样式规范](#6-样式规范)
7. [Git 提交规范](#7-git-提交规范)
8. [代码审查清单](#8-代码审查清单)
9. [本地开发流程](#9-本地开发流程)

---

## 1. 核心原则

### 1.1 一条数据流，一个入口

```
页面（Server Component） → 读库（lib/db.ts）
页面（Client Component） → fetch → Route Handler → lib/services → lib/db.ts
```

**不允许**从 Client Component 直接 import `lib/db.ts`。浏览器端只有 `lib/supabase/client.ts` 和 `lib/client-api.ts` 可用。

### 1.2 密钥只在服务端

任何 `process.env.<SECRET>` 都只能在：

- `src/lib/**`（被 Route Handler import）
- `src/app/api/**/route.ts`

**绝不能**出现在：

- `src/components/**`（大部分是 Client Component）
- 任何带 `"use client"` 的文件

判断标准：**文件顶部有 `"use client"`，就不能 import 读密钥的模块。**

### 1.3 失败不能让主流程挂掉

这条在 `createEntry()` 里体现得最清楚（`src/lib/services/entries.ts:41`）：

```ts
// 先落库
const entry = await insertEntry(...);
// 再做 AI 增强，失败只记录，不影响记录本身
const ai = await analyzeSafely(entry);
return { entry, ai };
```

**AI、邮件、外部 API 都是「增强」，不是「必需」。**

### 1.4 类型是唯一真相

数据库行 → `Entry` 对象必须经过 `hydrateEntry()`（`src/lib/ai/normalize.ts:158`）。

不要在组件里写 `entry.tags || []` 这种防御，因为 `hydrateEntry` 已经保证了 `Entry` 的每个字段都有正确类型。**如果发现需要防御，说明 hydrate 漏了字段，去补 hydrate。**

---

## 2. 目录划分逻辑

### 决策树：这段代码该放哪？

```
你写的是...
├─ 一个界面 / 局部交互
│   └─ components/*.tsx
│
├─ 一个可复用的通用组件（和业务无关）
│   └─ components/ui/*.tsx
│
├─ 一段纯函数（时间格式化、字符串处理、样式拼接）
│   └─ lib/utils.ts
│
├─ 一次数据库读写
│   └─ lib/db.ts
│
├─ 一段「先做 A 再做 B 再调模型」的业务编排
│   └─ lib/services/*.ts
│
├─ 提示词 / 上下文拼装
│   └─ lib/ai/prompts.ts
│
├─ 模型输出的清洗与归一化
│   └─ lib/ai/normalize.ts
│
├─ 一个 HTTP 接口
│   └─ app/api/<领域>/route.ts
│
└─ 一个页面
    └─ app/(app)/<页面>/page.tsx
```

### 各层职责边界

| 层 | 目录 | 职责 | **不应该做** |
| --- | --- | --- | --- |
| **页面** | `app/(app)/**/page.tsx` | 鉴权守卫、读库、把数据传给组件、页面级 metadata | 写业务逻辑、直接 fetch 外部 API |
| **组件** | `components/*.tsx` | 渲染、局部状态、用户交互 | 直接读库、读密钥、写复杂业务分支 |
| **通用组件** | `components/ui/*.tsx` | 纯 UI，不认识「记录」「待办」这些概念 | 引入业务类型 |
| **接口** | `app/api/**/route.ts` | 鉴权、校验、限流、调服务、返回 | 写 SQL、拼提示词 |
| **服务** | `lib/services/*.ts` | 业务编排（先落库再增强） | 处理 HTTP 状态码 |
| **数据访问** | `lib/db.ts` | 所有 Supabase 查询，**强制带 `userId`** | 做业务判断 |
| **AI 层** | `lib/ai/*` | 提示词、调用、归一化 | 直接操作数据库（除 `services` 传进来的 client） |

### 一个具体例子：`POST /api/entries` 的完整链路

```
app/api/entries/route.ts:44
  ├─ requireUser()               → lib/api.ts:37
  ├─ rateLimit(...)              → lib/api.ts:53
  ├─ createSchema.safeParse()    → zod，就地定义
  └─ createEntry(supabase, ...)  → lib/services/entries.ts:41
       ├─ insertEntry()          → lib/db.ts（落库）
       ├─ analyzeEntry()         → lib/services/entries.ts:89
       │    ├─ buildAnalysisMessages() → lib/ai/prompts.ts:46
       │    ├─ complete()              → lib/ai/provider.ts
       │    ├─ normalizeAnalysis()     → lib/ai/normalize.ts:58
       │    └─ saveLinks()             → lib/db.ts:130
       └─ 返回 { entry, ai }
```

**每一层只关心自己那一层的事**：route 不管 SQL，service 不管 HTTP，db 不管提示词。

---

## 3. 命名约定

### 文件

| 类型 | 规则 | 例子 |
| --- | --- | --- |
| 组件文件 | `kebab-case.tsx` | `entry-card.tsx`、`chat-panel.tsx` |
| 页面 | 固定 | `page.tsx`、`layout.tsx`、`loading.tsx`、`error.tsx` |
| 接口 | 固定 | `route.ts` |
| 工具模块 | `kebab-case.ts` | `client-api.ts`、`kind-icon.tsx` |
| 脚本 | `kebab-case.mjs` / `.mts` | `build-miku-art.mjs`、`test-ai.mts` |

### 组件

- **React 组件一律 PascalCase**：`EntryCard`、`ChatPanel`
- **导出的名字要和文件名对应**：`entry-card.tsx` → `EntryCard`
- **一个文件一个主组件**，次要的小组件可以放同文件但不要 export

### 变量与函数

| 类型 | 规则 | 例子 |
| --- | --- | --- |
| 函数 / 变量 | `camelCase` | `createEntry`、`listOpenTasks` |
| 常量 | `UPPER_SNAKE_CASE` | `ENTRY_COLUMNS`、`CONTEXT_BUDGET` |
| 类型 / 接口 | `PascalCase` | `Entry`、`CreateEntryResult` |
| 数据库字段 | `snake_case`（跟 Postgres 一致） | `user_id`、`created_at` |
| React props | `camelCase` | `onSubmit`、`entryId` |

### 布尔值命名

统一用肯定式前缀：`is` / `has` / `should` / `can`

```ts
isAiEnabled()      // ✅
hasSupabaseEnv()   // ✅
notDisabled        // ❌ 双重否定
```

### 错误码

`code` 字段统一 `snake_case`，语义化，不带前缀：

```ts
"invalid_input"       // ✅
"invalid_url"         // ✅
"ai_not_configured"   // ✅
"ERR_422_ENTRY"       // ❌
```

---

## 4. 组件编写规范

### 4.1 Client Component 的门槛

**默认写 Server Component。** 只有这几种情况才加 `"use client"`：

- 用 `useState` / `useEffect` / `useRef`
- 绑定事件（`onClick`、`onChange`）
- 用浏览器 API（`window`、`navigator`、`localStorage`）

**加在文件最顶部**，作为第一行。

### 4.2 组件签名

Props 用内联类型或单独的 interface，**不要用 `any`**：

```tsx
// ✅ 简单组件用内联
export function KindIcon({ kind }: { kind: EntryKind }) { ... }

// ✅ 复杂组件用 interface
interface EntryCardProps {
  entry: Entry;
  onDelete?: (id: string) => void;
}
export function EntryCard({ entry, onDelete }: EntryCardProps) { ... }
```

### 4.3 className 拼接

**统一用 `cn()`**（`src/lib/utils.ts:3`）：

```tsx
className={cn("base-class", condition && "conditional-class", className)}
```

⚠️ **`cn()` 是 `filter(Boolean).join(" ")`，不做 tailwind-merge 去重。**

这意味着：

```tsx
cn("text-sm", "text-lg")    // → "text-sm text-lg"
// 最终哪个生效取决于 CSS 生成顺序，不是字符串顺序
```

**所以互斥类必须用条件判断，不能靠「后写的赢」**：

```tsx
// ✅ 正确：显式互斥
cn("miku-scene", art.fade && !melt && "miku-fade", melt && "miku-melt")

// ❌ 错误：依赖覆盖
cn("miku-fade", melt && "miku-melt")
```

### 4.4 图片

- 一律用 `next/image` 的 `<Image>`，不要用裸 `<img>`
- 必须给 `width` / `height`（或用 `fill`）
- 移动端小图给 `sizes`（如 `sizes="40px"`），避免下载大图
- 装饰性图片 `alt=""` + `aria-hidden`

### 4.5 无障碍

- 交互元素用语义标签（`<button>` 而不是 `<div onClick>`）
- 图标按钮加 `aria-label`
- 表单控件必须有 `<label>` 或 `aria-label`
- 纯装饰元素加 `aria-hidden`

### 4.6 移动端优先

所有布局先写移动端样式，再用 `sm:` / `md:` / `lg:` 增强：

```tsx
<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
```

---

## 5. 服务端代码规范

### 5.1 Route Handler 模板

```ts
import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, jsonOk, rateLimit, requireUser } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // ...
});

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    rateLimit(`xxx:${user.id}`, 20, 60_000);

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message ?? "请求参数不正确", 422, "invalid_input");
    }

    const result = await someService(supabase, user.id, parsed.data);
    return jsonOk(result);
  } catch (error) {
    return errorResponse(error);
  }
}
```

**固定套路**，不要自创风格。

### 5.2 数据库查询必须带 userId

`lib/db.ts` 里每个函数都**强制接收 `userId` 并拼进 where**：

```ts
// ✅ 正确
export async function getEntry(supabase: SupabaseClient, id: string, userId: string) {
  const { data } = await supabase
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)     // ← 不能少
    .maybeSingle();
  return data ? hydrateEntry(data) : null;
}

// ❌ 错误：依赖 RLS 单点防护
export async function getEntry(supabase: SupabaseClient, id: string) {
  const { data } = await supabase.from("entries").select("*").eq("id", id).single();
  // 哪天有人用 service_role 建了 client，这里就变成越权
}
```

### 5.3 错误抛出

用 `HttpError`，带用户可读的中文消息和机器可读的 code：

```ts
throw new HttpError("条目不存在或无权访问", 404, "not_found");
```

**不要**：

```ts
throw new Error("not found");          // ❌ 会变成 500
return NextResponse.json(..., { status: 404 });   // ❌ 绕过统一错误处理
```

### 5.4 AI 调用

统一走 `lib/ai/provider.ts` 的 `complete()` / `openStream()`：

```ts
const { text, model } = await complete(messages, {
  json: true,          // 结构化任务
  temperature: 0.4,
  maxTokens: 1500,
  timeoutMs: 45000,
  thinking: false,     // 纯抽取任务关掉思考
});
```

**模型输出必须经过 normalize**：

```ts
const payload = normalizeAnalysis(extractJson(text));
```

**不要**直接 `JSON.parse(text)` —— 模型可能返回带 ```json 围栏的文本。

### 5.5 注释

只在「为什么」不明显时写注释。**不要写「做了什么」**：

```ts
// ✅ 好的注释：解释了非显然的决策
// 长度不同时也要走完一次比较，避免提前返回泄露长度信息
const matched = timingSafeEqual(expectedDigest, providedDigest) && provided.length === expected.length;

// ❌ 无意义注释
// 比较摘要
const matched = timingSafeEqual(...);
```

中文注释，简洁，不写废话。

---

## 6. 样式规范

### 6.1 一切从令牌来

颜色、圆角、阴影**全部用 `@theme` 里定义的令牌**（`src/app/globals.css:7`）：

```tsx
// ✅
className="bg-panel text-muted border-edge"

// ❌
className="bg-[#2a2d42] text-[#b6bed2]"
```

唯一例外：**一次性微调**（如 `text-[9px]`）和 `.miku-*` 样式块内部。

### 6.2 新样式往哪写

| 类型 | 位置 |
| --- | --- |
| 通用工具类组合 | 直接写在 `className` 里 |
| 多组件复用的样式 | `globals.css` 的 `@layer components` |
| **需要压过 Tailwind utilities 的** | `globals.css` **末尾、`@layer` 之外** |
| 动画 keyframes | `globals.css` |
| 初音相关 | `globals.css` 末尾的「初音融合样式」区块 |

⚠️ **`@layer` 之外的优先级最高**，因为 Tailwind utilities 在后面的层里。所以 `.miku-*` 全放在文件末尾。

### 6.3 响应式断点

Tailwind v4 默认断点：

| 前缀 | 最小宽度 |
| --- | --- |
| `sm:` | 640px |
| `md:` | 768px |
| `lg:` | 1024px |
| `xl:` | 1280px |

本项目移动端优先，桌面端用 `md:` / `lg:` 增强。**不要用 `max-*` 反向断点**（可读性差）。

### 6.4 iOS 特别注意事项

- **禁止 `user-scalable=no`**（无障碍问题，且 iOS 会忽略）
- 表单控件字号兜底 16px（`globals.css` 末尾），否则聚焦会放大页面
- 用 `env(safe-area-inset-*)` 处理刘海/home indicator
- `-webkit-mask-image` 和 `mask-image` 都要写

---

## 7. Git 提交规范

### 7.1 提交信息格式

```
<type>: <简短描述>

[可选的正文，说明为什么这么改]
```

**type 取值**：

| type | 用途 | 例子 |
| --- | --- | --- |
| `feat` | 新功能 | `feat: 邀请码注册 + 多用户隔离` |
| `fix` | 修 bug | `fix: iOS 输入框聚焦导致页面放大` |
| `docs` | 只改文档 | `docs: 补 UI 交接文档` |
| `style` | 只改样式/格式（不影响逻辑） | `style: 统一卡片圆角` |
| `refactor` | 重构（不改行为） | `refactor: 抽出 entry 查询到 db.ts` |
| `perf` | 性能优化 | `perf: 问答上下文按预算裁剪` |
| `test` | 测试相关 | `test: 补 AI 层假服务联调` |
| `chore` | 构建/依赖/杂项 | `chore: 升级 Next 16.4.3` |
| `revert` | 回滚 | `revert: 撤销 xxx（原因）` |

### 7.2 描述部分的要求

- **中文**，动词开头
- **不超过 50 字**
- 说清「改了什么」，不说「改了文件」

```bash
git commit -m "feat: 初音图片融合 + 移动端 UI 重构"
git commit -m "fix: 排行榜页码越界导致空白"
```

### 7.3 一次提交只做一件事

**不要**把「加功能」和「修格式」混在一个提交里。如果改了两个不相干的东西，分两次提交。

例外：**跨层联动改动**（如加字段要同时改 schema / types / db / normalize）必须放同一个提交，否则中间状态不可用。

### 7.4 提交前检查

```bash
npm run typecheck      # 必须过
npm run build          # 必须过（会跑类型检查）
git status             # 确认没有 .env.local / 临时文件
```

### 7.5 分支策略

个人项目，简化为两条线：

- `main` —— 可部署状态
- `feat/<名字>` 或 `fix/<名字>` —— 开发中的改动

合并前：`git checkout main && git merge --no-ff feat/xxx`

开源后请先从 `main` 切出功能分支，再通过 PR 合并；不要在 `main` 上直接提交大改动。

---

## 8. 代码审查清单

提交前过一遍：

### 安全

- [ ] 没有在 Client Component 里读 `process.env` 的密钥
- [ ] 新的公开路由已加进 `src/proxy.ts` 的 `PUBLIC_PREFIXES`
- [ ] 每个数据库查询都带 `user_id` 过滤
- [ ] 新表开了 RLS + 四条策略
- [ ] 用户输入走了 zod 校验

### 正确性

- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] 模型输出走了 normalize
- [ ] AI 失败不影响主流程

### 体验

- [ ] 移动端（390px）布局正常
- [ ] 空态有引导文案
- [ ] 错误有用户能懂的中文提示
- [ ] 加载中有骨架屏或 loading 状态

### 可维护性

- [ ] 没有 `any`
- [ ] 没有 `console.log` 残留（`console.error` / `console.warn` 可以留）
- [ ] 复杂逻辑有「为什么」的注释
- [ ] 新组件有默认导出且有明确的文件归属

---

## 9. 本地开发流程

### 启动

```bash
npm install
cp .env.example .env.local     # 填 Supabase / 邀请码 / 可选 AI
npm run dev                    # http://localhost:3000
```

### 改完 UI 后的验证

```bash
# 1. 类型检查
npm run typecheck

# 2. 生产构建
npm run build

# 3. 起生产包
npm run start                  # 3000 端口

# 4. 截图比对（需要无头浏览器）
node scripts/ui-shot.mjs login --base=http://127.0.0.1:3000 --out=./shots
```

### 提交

```bash
git add -A
git commit -m "feat: xxx"
```

### 部署

```bash
npx vercel deploy --prod --yes
```

详细步骤见 [MAINTENANCE.md § 3](MAINTENANCE.md#3-部署与回滚)。

---

## 附：常见反模式

| 反模式 | 问题 | 正确做法 |
| --- | --- | --- |
| 在组件里 `fetch('/api/...')` 后自己 setState | 重复实现 client-api 的错误处理 | 用 `lib/client-api.ts` |
| `as any` | 逃逸类型检查 | 补类型定义或 `as unknown as T`（带注释） |
| 在 `page.tsx` 里写业务分支 | 页面变成上帝对象 | 抽到 `lib/services` |
| 直接 `JSON.parse(modelOutput)` | 模型返回带围栏的文本会炸 | `extractJson()` + normalize |
| `cn("a", cond && "b", cond2 && "c")` 期望后者覆盖 | `cn` 不去重 | 显式条件互斥 |
| 在 `globals.css` 的 `@layer` 里放覆盖样式 | 压不过 utilities | 放文件末尾 |
| 新表忘了 `enable row level security` | 所有人能读所有人的数据 | 建表同一次 SQL 里开 RLS |
| 忘了把新公开路由加白名单 | 被 proxy 拦到登录页 | 改 `src/proxy.ts:4` |

---

*规范是为了减少决策成本，不是为了增加仪式感。遇到规范没覆盖的情况，选「半年后的自己能看懂」的那个方案。*
