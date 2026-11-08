# 维护与防坑指南

> 写给未来的自己。所有条目都来自这个项目真实踩过的坑，不是通用建议。
> 最后更新：2026-11-03

---

## 目录

1. [如何更换大模型](#1-如何更换大模型)
2. [如何更换 UI 主题](#2-如何更换-ui-主题)
3. [部署与回滚](#3-部署与回滚)
4. [数据库变更流程](#4-数据库变更流程)
5. [初音图维护](#5-初音图维护)
6. [已知坑位清单](#6-已知坑位清单)

---

## 1. 如何更换大模型

### 结论先行

**只改环境变量，一行代码都不用动。** 全部模型调用都收敛在 `src/lib/ai/provider.ts`，走 OpenAI 兼容协议。

### 操作步骤

改 `.env.local`（本地）或 Vercel 环境变量（线上）的三行：

```env
AI_BASE_URL=<新服务的 /v1 地址>
AI_API_KEY=sk-...
AI_MODEL=<新模型名>
```

然后**重启 dev server** 或 **Vercel 重新部署**。

### 常见服务的对应值

| 服务 | `AI_BASE_URL` | `AI_MODEL` 示例 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Kimi / Moonshot | `https://api.moonshot.cn/v1` | `kimi-k2-0905-preview` |
| 通义 / DashScope | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

### 环境变量细节

读取位置：`src/lib/ai/provider.ts:47-54`

```ts
const rawBase = (process.env.AI_BASE_URL ?? DEFAULT_BASE_URL).trim();
const timeout = Number.parseInt(process.env.AI_TIMEOUT_MS ?? "45000", 10);
const temperature = Number.parseFloat(process.env.AI_TEMPERATURE ?? "0.4");
// ...
apiKey: (process.env.AI_API_KEY ?? "").trim(),
model: (process.env.AI_MODEL ?? DEFAULT_MODEL).trim(),
```

### 换模型后的验证清单

1. `curl https://<你的域名>/api/health` → `{"ok":true,"ai":"enabled"}`
2. 记一条新记录 → 看是否自动生成标题和摘要（走 `/api/entries` POST）
3. 问一个关于已有记录的问题 → 看是否流式返回并带 `[1]` 出处（走 `/api/ai/chat`）
4. 点「生成总结」→ 看是否返回结构化 themes/actions（走 `/api/ai/review`）

### 坑位

- **`AI_BASE_URL` 必须带 `/v1`**（大多数服务），否则 404。`provider.ts:98` 有专门的错误提示。
- **不同模型对 JSON mode 的支持不一样**。本项目所有结构化任务都用 `json: true`，如果新模型不支持，返回的可能是带 ```json 围栏的文本——`extractJson()` 会兜底剥离，但极端情况仍可能解析失败。
- **推理模型的思考过程**：Qwen3 系等会输出思考内容，占用 token 且拖慢响应。设 `AI_DISABLE_THINKING=true` 可全局关闭（`provider.ts:67`）。默认策略是按场景控制：智能理解/问答/总结保持开启，纯抽取关闭。
- **`AI_TEMPERATURE` 别调太高**。整理类任务建议 ≤ 0.5，否则标签和类型会飘。
- **答案质量下降**不一定是模型问题，先看 `AI_TIMEOUT_MS`——默认 45 秒，总结任务在 `ai/review/route.ts` 里单独设了 52 秒；如果新模型更慢，需要同步调大（注意 Vercel 免费版单函数上限 60 秒）。

---

## 2. 如何更换 UI 主题

### 结论先行

**主色改 `src/app/globals.css` 的 `@theme` 块，图片融合样式也全在同一个文件末尾。** 理论上不碰任何组件。

### 2.1 改配色令牌

位置：`src/app/globals.css:7-76`（`@theme` 块）

核心色板：

```css
@theme {
  /* 背景与面板 */
  --color-night: #1e1e2e;      /* 主背景 */
  --color-night-2: #181826;    /* 深背景 */
  --color-panel: #2a2d42;      /* 面板 */
  --color-panel-2: #343852;    /* 面板悬浮 */

  /* 文字 */
  --color-bright: #f6f8fc;
  --color-muted: #b6bed2;
  --color-faint: #7d859c;

  /* 主色（初音葱绿）—— 换主题时主要改这三行 */
  --color-miku: #39c5bb;
  --color-miku-2: #2aa39b;
  --color-miku-3: #7fe3dc;

  /* 强调色 */
  --color-sakura: #f472b6;     /* 霓虹粉 */
  --color-neon-blue: #60a5fa;
  --color-violet: #8b5cf6;
  --color-amber: #fbbf24;

  /* 边框 */
  --color-edge: rgba(57, 197, 187, 0.28);
  --color-edge-soft: rgba(148, 163, 184, 0.16);
}
```

**Tailwind v4 的约定**：`--color-miku` 自动生成 `bg-miku` / `text-miku` / `border-miku` / `from-miku` 等全部工具类。所以改令牌值 = 全站换色，组件代码不用动。

### 2.2 换主题时必须同步改的地方（重要）

这些地方**硬编码了 rgba 数值**，不走令牌，改色时会漏：

| 位置 | 内容 | 说明 |
| --- | --- | --- |
| `globals.css:465-478` | `.miku-halo::before` 的 `radial-gradient` | 三层 rgba，在 473-474 行 |
| `globals.css:480` | `.miku-halo .miku-art` 的 `drop-shadow` | `rgba(57, 197, 187, 0.28)` |
| `globals.css:510-513` | `.miku-avatar-ring` 的 border + box-shadow | 三处 rgba |
| `globals.css:520-535` | `@keyframes avatar-breathe` | 两帧共 4 处 rgba（525-532 行） |
| `globals.css:538-542` | `.chat-input-shell:focus-within` | 四处 rgba |
| `globals.css:546-559` | `.miku-easter-egg` | `rgba(57, 197, 187, 0.18)`（553 行） |
| `app-shell.tsx:36` | Brand 头像 hover 阴影 | 内联 `rgba(57,197,187,0.5)` |

**改进建议**：如果以后频繁换主题，把 `rgba(57, 197, 187, x)` 抽成 `--miku-rgb: 57 197 187` 变量，写成 `rgb(var(--miku-rgb) / 0.22)`，这样只改一处。

### 2.3 图片融合的 mask-image 在哪几个组件

这是初音 UI 返工的核心，三处遮罩分别解决不同问题：

| 类名 | 定义位置 | 使用位置 | 作用 |
| --- | --- | --- | --- |
| `.miku-melt .miku-art` | `globals.css:484-488` | `insights-view.tsx:121`、`tasks-view.tsx:138`（`<MikuArt halo melt />`） | `radial-gradient(circle at 50% 46%, #000 42%, transparent 74%)` 融化矩形边界，用于空态大图 |
| `.miku-watermark` | `globals.css:490-507` | `entry-card.tsx:34`（`<span className="miku-watermark">`） | `linear-gradient(to top left, #000 30%, transparent 78%)` 让角落水印朝左上方渐隐，不压文字 |
| `.miku-halo::before` | `globals.css:465-478` | 任何 `<MikuArt halo />` | 不是 mask，是垫在背后的径向渐变光晕 + `blur(10px)`，解决「贴纸感」 |

组件层封装：`src/components/miku-art.tsx:48`

```tsx
<MikuArt
  name="empty"        // login | empty | corner
  halo                // 垫光晕 + drop-shadow
  melt                // 融化边缘
  float               // animate-float 浮动
  className="w-[120px]"
/>
```

### 2.4 不用初音了怎么办

三步走：

1. **换图**：把 `public/miku/art/*.webp` 替换成新素材（保持透明通道、同比例），或直接改 `miku-art.tsx` 里的 `ART` 配置指向新路径。
2. **清样式**：可以保留 `.miku-halo` / `.miku-melt` / `.miku-watermark` —— 它们只是通用的图片融合工具，跟初音无关。只改 `@theme` 里的颜色即可。
3. **改文案**：搜「初音」二字，主要出现在 `insights-view.tsx`、`tasks-view.tsx`、`chat-panel.tsx`、`login-form.tsx` 的空态文案里。

### 2.5 坑位

- **`.miku-*` 样式必须放在 `globals.css` 末尾、`@layer` 之外**。放进去会被 Tailwind utilities 压过（因为 utilities 层后加载）。
- **`cn()` 不做 tailwind-merge 去重**（`utils.ts:3` 是 `filter(Boolean).join(" ")`）。同一个属性传两个类，**后面的不一定赢**——取决于 CSS 生成顺序，不是 class 字符串顺序。所以 `MikuArt` 里对互斥类做了显式判断（`art.fade && !melt && "miku-fade"`）。
- **alpha 透明图必须用 `drop-shadow`，不能用 `box-shadow`**。后者会沿着元素盒子画一圈矩形阴影。
- **iOS Safari 的 `mask-image` 需要 `-webkit-` 前缀**，本项目两处都写了，改动时别删。

---

## 3. 部署与回滚

### 3.1 部署（Vercel）

**方式 A：CLI 部署**（本项目实际用的）

```bash
cd /d/forge/info-keeper
npx vercel deploy --prod --yes
```

典型输出：

```
Build Completed in /vercel/output [13s]
Production  https://your-project.vercel.app
Aliased     https://your-deployment.example.com
✓ Ready in 31s
```

**方式 B：Git 集成**（本项目当前未接 remote，如要接需先 `git remote add`）

### 3.2 环境变量修改后必须 Redeploy

这是**最容易忘**的一条。

| 变量类型 | 生效时机 |
| --- | --- |
| `NEXT_PUBLIC_*` | **构建时**写进产物 → 必须 Redeploy |
| `AI_*` / `INVITE_CODE` / `SUPABASE_SERVICE_ROLE_KEY` | **运行时**读取 → 理论上改完下一次请求就生效，但 Vercel 上**仍然建议 Redeploy**，避免旧实例缓存 |

**改完后一定要做**：

```bash
node node_modules/vercel/dist/index.js deploy --prod --yes
```

> ⚠️ 只改 Dashboard 里的环境变量、不重新部署，线上行为不会变。

### 3.3 修改 Secret 类型变量的正确姿势

Vercel 的 Secret 类型变量**不能原地修改**（`env add` 会报 `already exists`）。必须两步：

```bash
# 1. 删除
node node_modules/vercel/dist/index.js env rm INVITE_CODE production --yes

# 2. 重新添加（从 stdin 读值）
echo "新值" | node node_modules/vercel/dist/index.js env add INVITE_CODE production --yes
```

> 换邀请码时踩过这个坑：直接 `env add` 报 `A variable with the name INVITE_CODE already exists for the target production`。

### 3.4 回滚

**方式 A：Dashboard**（最快）

Vercel → 项目 → Deployments → 找到上一个正常的部署 → 右侧 `⋯` → **Promote to Production**。

**方式 B：CLI 重新部署指定版本**

```bash
node node_modules/vercel/dist/index.js redeploy <deployment-url> --prod
```

**方式 C：代码回滚**

```bash
git log --oneline          # 找到目标提交
git revert <commit>        # 生成反向提交（比 reset 安全）
# 然后重新部署
```

### 3.5 部署后验证清单

```bash
curl -s -o /dev/null -w "%{http_code}" https://your-deployment.example.com/login   # 期望 200
curl -s -o /dev/null -w "%{http_code}" https://your-deployment.example.com/        # 期望 307（未登录跳转）
curl -s https://your-deployment.example.com/api/health                             # 期望 {"ok":true,...}
```

### 3.6 坑位

- **区域必须选 `sin1`（新加坡）**，`vercel.json` 已锁定。选默认 `iad1`（美东）会让 Supabase 查询慢 200ms+。
- **`www` 子域 308 跳根域**，在 Vercel Domains 里配置。
- **Supabase 免费项目 7 天无请求会休眠**，去控制台 Restore 即可；休眠期间所有请求都会报「被踢回登录页」。
- **改完 `.env.local` 必须重启 dev server**，Next 不会热重载环境变量。
- **构建失败先看是不是类型错误**：`npm run typecheck` 本地跑一遍比等 Vercel 快。
- **`next start` 的端口**：本项目 `npm run start` 默认 3000，改过端口的话注意和 Supabase Redirect URLs 对齐。

---

## 4. 数据库变更流程

### 4.1 铁律

> **每次变更都要能回滚，且 RLS 必须在同一次变更里配好。**
> 一张开了 RLS 但没写策略的表 = 谁都读不到（包括你自己）。
> 一张忘了开 RLS 的表 = 所有人能读到所有人的数据。

### 4.2 加字段（最常见）

```sql
-- supabase/schema.sql 同步追加（保持幂等）
alter table public.entries
  add column if not exists mood text;

-- 如果需要索引
create index if not exists entries_user_mood_idx
  on public.entries (user_id, mood);
```

然后在 Supabase SQL Editor 执行。**新字段不影响现有 RLS**（策略是行级，不是列级）。

对应的 TypeScript 类型要同步改 `src/lib/types.ts`：

```ts
export interface Entry {
  // ...
  mood: string | null;
}
```

以及 `src/lib/db.ts:21` 的 `ENTRY_COLUMNS`（显式列清单，加字段必须同步，否则查不出来）：

```ts
export const ENTRY_COLUMNS = "id,user_id,kind,title,content,...,mood";
```

以及 `src/lib/ai/normalize.ts:158` 的 `hydrateEntry()`（数据库行 → `Entry` 对象的映射）。

**这四处要一起改，漏一处就会出现「字段在库里但界面看不到」或类型报错。**

### 4.3 加表

```sql
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);

create index if not exists attachments_user_idx on public.attachments (user_id);

-- 必须：开 RLS
alter table public.attachments enable row level security;

-- 必须：四条基本策略
create policy "attachments read own"   on public.attachments for select using (auth.uid() = user_id);
create policy "attachments insert own" on public.attachments for insert with check (auth.uid() = user_id);
create policy "attachments update own" on public.attachments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "attachments delete own" on public.attachments for delete using (auth.uid() = user_id);
```

**如果这张表有跨表引用**，insert 策略还要额外校验被引用行也属于自己——参考 `supabase/schema.sql:179-184` 里 `entry_links` 的写法：

```sql
create policy "links insert own" on public.entry_links for insert with check (
  auth.uid() = user_id
  and exists (select 1 from public.entries e where e.id = source_id and e.user_id = auth.uid())
  and exists (select 1 from public.entries e where e.id = target_id and e.user_id = auth.uid())
);
```

### 4.4 改已有表的 RLS 策略

```sql
-- 先删旧策略（必须知道确切名字）
drop policy if exists "entries read own" on public.entries;

-- 再建新策略
create policy "entries read own" on public.entries
  for select using (auth.uid() = user_id);
```

> ⚠️ **不要用 `alter policy`**，Postgres 对它的支持有限，用「删除 + 重建」最稳。

### 4.5 改完必须验收

```sql
-- supabase/verify-multiuser.sql 里的 6 组查询，核心是这两条：

-- 1. 确认所有表都开了 RLS
select tablename, rowsecurity
from pg_tables
where schemaname = 'public';
-- 期望：entries / entry_links / reviews / profiles 全部 true

-- 2. 确认每张表都有完整策略
select tablename, cmd, policyname
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
-- 期望：每张表至少有 select / insert / update / delete 四条（profiles 无 delete）
```

**真机 B 测试**（最可靠）：

1. A 账号记 3 条 → 登出
2. B 账号登录 → 收件箱应为 0 条
3. B 猜一个 A 的 `/entry/<uuid>` → 应为 404（不泄露「是否存在」）

### 4.6 迁移脚本的存放约定

目前没有迁移框架，全部靠 `schema.sql` 幂等执行。约定：

- **建表/加列一律用 `if not exists`**，保证整份脚本可重复跑。
- **破坏性变更**（删列、改类型）不要直接改 `schema.sql`，而是在 `docs/` 下留一份 `migration-YYYYMMDD.sql`，手工执行并记录。
- 改完 `schema.sql` 要同步更新本文档的「数据库」章节。

### 4.7 坑位

- **`profiles` 无 delete 策略**是有意的：账号删除应通过 Supabase Auth 的级联（`on delete cascade`）走，而不是让客户端直接删。
- **`search_entries` 函数内部已经用 `auth.uid()` 过滤**，但 `api/ai/chat/route.ts:61` 仍然二次核对 `entry.user_id === user.id`——这是防御性编程，别当成冗余删掉。
- **`pg_trgm` 扩展**：`schema.sql` 开头有 `create extension if not exists pg_trgm`，如果 Supabase 提示权限不足，去 Database → Extensions 手动开。
- **大量数据时 `search_entries` 会慢**：`trgm` 索引对中文短词有效，但 `content` 很长时 GIN 索引也大。如果记录超过几千条，考虑加 `where status <> 'archived'` 缩小范围。

---

## 5. 初音图维护

### 素材链路

```
public/miku/*.png        原始黑底图（源素材，不直接引用）
      ↓ scripts/build-miku-art.mjs（四边 flood fill，BLACK=14）
public/miku/art/*.webp   带 alpha 的成品（组件实际引用）
```

### 重新抠图

```bash
node scripts/build-miku-art.mjs
```

脚本从图片四边向内 flood fill，把接近纯黑的连通区域变透明。**如果新图背景不是纯黑**（比如渐变、白底），需要改脚本里的 `BLACK` 阈值或换方案。

### 尺寸约束

| 图 | 尺寸 | 用途 |
| --- | --- | --- |
| `miku-login.webp` | 768×1058 | 登录页主图 |
| `miku-empty.webp` | 640×882 | 空态大图（insights / tasks） |
| `miku-corner.webp` | 384×384 | 移动端右下角常驻 |
| `miku-avatar.webp` | 200×200 | 已弃用（改用原图 `miku-avatar.jpg` 整幅缩放） |

**移动端图片宽度不超过 `max-w-[120px]`**（空态），角图 `w-28`（112px），头像 `size-9` / `size-10`。

### 头像的特殊处理

`MikuAvatar` **不用抠图版**，直接用原图 `public/miku/miku-avatar.jpg`（1438×1422 近方形）：

```tsx
<Image
  src="/miku/miku-avatar.jpg"
  width={200} height={200}
  sizes="40px"
  className="size-full object-cover object-top"
/>
```

原因：用户明确要求「头像的图缩放就行了，裁剪效果差」。`object-cover` 在近方形图上只裁掉 16px 边，视觉上等于整幅缩放。

---

## 6. 已知坑位清单

### 环境

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| 端口被占 | 打开是一段英文 401 JSON | 说明访问到了别的服务；确认 dev 实际监听端口，或用 `-p` 换一个空闲端口 |
| node 不在 PATH | `node: command not found` | 把 Node.js 的 `bin` 目录加进 PATH，或用 Node 的绝对路径 |
| npm 不可用 | `npm: command not found` | `node node_modules/next/dist/bin/next ...` |
| 改 `.env.local` 不生效 | 变量还是旧值 | 重启 dev server |

### 构建

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| SW 更新不生效 | 改了 `sw.js` 但浏览器还用旧的 | `next.config.ts` 已设 `max-age=0, must-revalidate`；确认没开 DevTools 的 disable cache 反选 |
| 类型错误 | Vercel 构建失败 | 本地 `npm run typecheck` 先跑 |
| `tsconfig.tsbuildinfo` 被提交 | 无意义的大文件 | `.gitignore` 已包含 `*.tsbuildinfo` 与 `.vercel-token` |

### 鉴权

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| 邀请码大小写 | iOS 键盘首字母大写 | `invite.ts:18` 已 `toLowerCase()`，不用管 |
| `INVITE_CODE` 未配置 | 注册返回 503 `invite_not_configured` | fail-closed 设计，去配变量 |
| 换账号还看到旧数据 | 从客户端缓存回退的页面壳 | 确认走 `/api/auth/signout`，刷新一次 |
| PKCE 确认失败 | `/login?error=callback&reason=pkce` | 必须在发起注册的同一设备同一浏览器点邮件；最省事配 `SUPABASE_SERVICE_ROLE_KEY` |
| iOS 主屏应用登录态独立 | 在 App 里登出不影响 Safari | WebKit 设计（Bug 181849），不是 bug |

### AI

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| 401 | 鉴权失败 | 检查 `AI_API_KEY` 是否过期 |
| 404 | 接口不存在 | `AI_BASE_URL` 是否以 `/v1` 结尾 |
| 503 | `ai_not_configured` | `AI_API_KEY` 没配；Vercel 改了要重新部署 |
| JSON 解析失败 | 结构化任务报错 | `extractJson()` 会剥离 ```json 围栏；仍失败则该模型可能不支持 JSON mode |
| 总结超时 | 10–30 秒正常 | Vercel 免费版单函数上限 60 秒，记录太多时要缩小时间范围 |

### UI

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| 图看起来像贴纸 | 角色图和背景无过渡 | 用 `<MikuArt halo />` 垫光晕 + `drop-shadow` |
| 图片有矩形边界 | alpha 图边缘生硬 | 用 `<MikuArt melt />` 或 `.miku-watermark` 加 `mask-image` |
| `box-shadow` 画出矩形 | 透明图周围一圈方框 | 必须用 `filter: drop-shadow()` |
| `cn()` 不去重 | 传两个 `text-*` 类，效果不可控 | 用条件判断保证互斥，别依赖类名顺序 |
| iOS 输入框聚焦放大 | 页面被撑开 | `globals.css` 末尾对所有表单控件兜底 `font-size: 16px` |
| 移动端图太大 | 撑破布局 | 空态 `w-[120px]`、角图 `w-28`、头像 `size-9` |

---

## 附：本地验证工作流

改完 UI 后的标准验证流程（本项目实测可用）：

```bash
# 1. 类型检查
node node_modules/typescript/bin/tsc --noEmit

# 2. 生产构建
node node_modules/next/dist/bin/next build

# 3. 起生产 server
node node_modules/next/dist/bin/next start -p 3457 > .prod.log 2>&1 &

# 4. 起无头 Edge（CDP 9333）
#    ... 等 7 秒

# 5. 截图
node scripts/ui-shot.mjs login --base=http://127.0.0.1:3457 --out=./shots
node scripts/ui-shot.mjs app --base=http://127.0.0.1:3457 --out=./shots <email> <password>
```

产物默认在 `C:/Users/<用户名>/AppData/Local/Temp/mikushot/`。

---

*本文档随项目演进更新。遇到新坑请回来补一条。*
