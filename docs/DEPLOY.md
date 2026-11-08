# 部署指南：从零到手机上能用

全程免费额度即可，大约 30 分钟。按顺序做，不需要改代码。

---

## 0. 先准备四样东西

| 需要 | 用途 | 花费 |
| --- | --- | --- |
| GitHub 账号 | 存放代码，供 Vercel 拉取 | 免费 |
| Supabase 账号 | 数据库 + 登录（可用 GitHub 直接登录） | 免费额度 |
| Vercel 账号 | 托管 Next.js（用 GitHub 登录） | 免费额度 |
| 大模型 API Key | 自动分类 / 问答 / 总结 | 按量，个人每月通常几元 |

模型可选：DeepSeek（`https://api.deepseek.com/v1`）、Kimi（`https://api.moonshot.cn/v1`）、通义百炼、OpenAI。**没有 Key 也能部署**，只是没有智能整理。

---

## 1. 建 Supabase 项目

1. 打开 [supabase.com](https://supabase.com) → **New project**
2. 填写：
   - **Name**：`info-keeper`
   - **Database Password**：生成一个强密码并**存到密码管理器**（以后直连数据库要用）
   - **Region**：展开下拉，选 **Specific region → Southeast Asia (Singapore) `ap-southeast-1`**

   > **别选 Auto，也别选 General region。**
   > Auto 按你当前网络的出口位置挑，走代理时很容易落到美西/欧洲；General region（APAC）则是 Supabase
   > 在亚太范围内按容量挑一个可用区，可能不是新加坡。
   > **区域建好之后不能改**，只能新建项目迁移，所以这里要一次选对。
   > 人在华北/华东的话，**Tokyo `ap-northeast-1`** 也可能快 20–40ms；新加坡是更稳的通用选择。

   - **安全**（三个勾，别乱选）：
     - ✅ **启用数据 API** —— 必须勾。supabase-js 全靠它，关掉应用直接不可用
     - ⬜ **自动暴露新表** —— 取消勾选。Supabase 自己也建议关，权限手动控制更清楚；
       我们的 SQL 第 11 段已经把该给的权限显式授给登录用户了
     - ✅ **启用自动 RLS** —— 勾上。给以后新建的表兜底，和已有策略不冲突

   - **GitHub（可选）**：**留空，跳过**。它是给「把 schema 写成 `supabase/migrations/` 再自动部署」的
     工作流准备的；我们这个项目只跑一次 SQL 建表，连上反而多一层不确定。

3. 点 **Create new project**，等 1–2 分钟初始化完成。

---

## 2. 建表（一条 SQL 搞定）

1. 左侧 **SQL Editor** → **New query**
2. 打开项目里的 `supabase/schema.sql`，**整段复制**粘贴进去
3. 点 **Run**（或 `Ctrl/Cmd + Enter`）

脚本最后一段（第 11 段）会显式 `grant` / `revoke`，所以上一步即使取消了「自动暴露新表」也能正常读写。

跑完后验证：

- **Table Editor** 里出现 `entries`、`entry_links`、`reviews`、`profiles` 四张表
- **Database → Functions** 里有 `search_entries`
- **Authentication → Policies** 里每张表都有 4 条左右的策略

> 如果报 `permission denied to create extension "pg_trgm"`：去 **Database → Extensions** 搜索 `pg_trgm` 手动启用，再重跑 SQL。

这个脚本是幂等的，改坏了可以整段重跑。

---

## 3. 配置登录方式

### 3.1 打开邮箱登录

**Authentication → Sign In / Providers → Email**

- **Enable Email provider**：保持开启
- **Confirm email**：建议**开启**（注册后要收一封确认邮件，多一层保护）
- **Minimum password length**：8

> 如果不想折腾邮件，可以关掉 Confirm email；或者干脆关闭注册，用下面的「手动建号」。

### 3.2 配置回跳地址

**Authentication → URL Configuration**

本地开发阶段先填：

| 字段 | 值 |
| --- | --- |
| Site URL | `http://localhost:3000` |
| Redirect URLs | `http://localhost:3000/auth/callback` |

部署完（第 8 步）再补上 Vercel 域名，两条都保留。

### 3.3 建你自己的账号

两种方式，选一个：

**A. 用界面注册（推荐）**

本地跑起来后，在 `/login` 页面切到「注册」，填邮箱密码。如果开了邮箱确认，去邮箱点链接即可。

**B. 在控制台直接建（不需要邮箱确认）**

**Authentication → Users → Add user → Create new user**，填邮箱和密码，勾选 **Auto Confirm User**。

---

## 4. 拿到两个公开密钥

**Project Settings → API**（新版叫 **Project Settings → API Keys**）：

| 名称 | 长什么样 | 用途 |
| --- | --- | --- |
| Project URL | `https://xxxx.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL` |
| 可公开密钥 / publishable key | `sb_publishable_...`（新版界面）或 `eyJhbGciOi...`（旧版 anon public） | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

> `service_role` / `secret key` **绝对不要用**，它会绕过 RLS，一旦进浏览器就等于把数据库交出去。
>
> 唯一的例外是服务端的 `SUPABASE_SERVICE_ROLE_KEY`：它**只在 Route Handler 里**用于 Admin API 建号，
> 绝不能加 `NEXT_PUBLIC_` 前缀。详见 [README 的「邀请朋友进来」](../README.md#邀请朋友进来)。

---

## 5. 本地跑通

在项目根目录：

```bash
cp .env.example .env.local      # Windows PowerShell: copy .env.example .env.local
```

编辑 `.env.local`：

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...

# 邀请制注册（必填：不配就没人能注册）
INVITE_CODE=你定的口令

# 推荐：配了才能用 Admin API 建号、并关掉 Supabase 公开注册
# supabase → Project Settings → API Keys → Secret keys → sb_secret_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...

AI_BASE_URL=https://api.deepseek.com/v1
AI_API_KEY=sk-...
AI_MODEL=deepseek-chat
```

然后：

```bash
npm install
npm run dev
```

打开 http://localhost:3000（默认端口；若被其它服务占用，可用 `npm run dev -- -p 4001` 指定端口，并同步更新下面的 Redirect URLs）：

1. 用第 3 步的账号登录
2. 在输入框写一条，比如「下周三前把合同发给老王，付款节点要确认」
3. 几秒后它应该自动变成「待办」，带摘要、标签和截止时间
4. 点进详情 → 「重新理解」→ 看是否生成关联

到这里功能就通了。如果页面显示「还差最后一步配置」，说明 `.env.local` 没被读到——改完要**重启 dev**。

> **注册要先有邀请码。** 注册页的邀请码框必须填成和 `INVITE_CODE` 一样的值（大小写不敏感）。
> 没配 `INVITE_CODE` 时注册接口直接返回 503，这是故意的 fail-closed 设计。
>
> 想让朋友注册时不用点邮件确认：配上 `SUPABASE_SERVICE_ROLE_KEY`（并把 `INVITE_AUTO_CONFIRM`
> 留空或设成 `true`），服务端会用 Admin API 建号并直接确认邮箱。

---

## 6. 推到 GitHub

```bash
cd info-keeper
git init
git add .
git commit -m "feat: info keeper"
```

在 GitHub 新建仓库（建议 **Private**），然后：

```bash
git branch -M main
git remote add origin https://github.com/<你的用户名>/info-keeper.git
git push -u origin main
```

`.gitignore` 已经排除了 `.env*.local`，密钥不会被提交。

---

## 7. 部署到 Vercel

1. [vercel.com](https://vercel.com) → **Add New… → Project**
2. **Import Git Repository** → 选 `info-keeper`（第一次需要授权 GitHub）
3. **Framework Preset** 会自动识别为 Next.js，构建命令保持默认（`next build`）
4. 展开 **Environment Variables**，逐条添加：

| Key | Value | 环境 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 你的 Project URL | Production / Preview / Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 你的 anon key | 同上 |
| `AI_BASE_URL` | `https://api.deepseek.com/v1` | 同上 |
| `AI_API_KEY` | `sk-...` | 同上 |
| `AI_MODEL` | `deepseek-chat` | 同上 |

> **一次勾选三个环境**，否则 Preview 部署会缺变量。
> `NEXT_PUBLIC_*` 是**构建时**写进产物的：以后改这几个值，必须 **Redeploy** 才生效；`AI_*` 是运行时读取，改完重新部署同样最稳。

5. 点 **Deploy**，等 1–2 分钟，拿到 `https://info-keeper-xxx.vercel.app`。

   > **部署完马上做一件事（很重要）**：**Settings → Functions → Function Region**，
   > 取消默认的 `Washington, D.C. (iad1)`，改选 **Singapore (sin1)**，然后 **Redeploy**。
   > Hobby 只允许一个区域，两个都勾会直接部署失败。
   > 这一步让函数和数据库同城（每次查询省掉跨太平洋的往返）；留在默认 iad1，会让每个页面多花 200ms 以上。

---

## 8. 把域名回填给 Supabase

回到 **Authentication → URL Configuration**：

| 字段 | 值 |
| --- | --- |
| Site URL | `https://info-keeper-xxx.vercel.app` |
| Redirect URLs | 保留 `http://localhost:3000/auth/callback`，再加 `https://info-keeper-xxx.vercel.app/auth/callback` |

保存。然后去线上站点登录一次，确认能进、能记录。

> 没做这步的典型症状：点邮件里的确认链接后跳回 localhost，或者登录后被立刻踢回登录页。

---

## 9. 关掉公开注册（重要）

应用有邀请码闸门，但 Supabase 自己的 `signUp` 接口默认仍对全网开放——浏览器可以绕过界面直接
调它。要做到「没有邀请码绝对进不来」，必须关掉这个开关。

**前提**：已经配好 `SUPABASE_SERVICE_ROLE_KEY`（第 5 步）。因为关掉之后，注册改由服务端
Admin API 建号，不再依赖这个开关。**顺序反了会谁都注册不了。**

**Authentication → Sign In / Providers → 关闭 `Allow new users to sign up`**

（不同版本可能叫 **Authentication → Settings → User Signups**，找带 *sign up* 的开关即可。）

关掉后：

- 走界面注册 → 服务端校验邀请码 → Admin API 建号 → 成功
- 浏览器直接 POST 到 `https://xxx.supabase.co/auth/v1/signup` → 被 Supabase 拒绝
- 已有账号登录完全不受影响

> 没配 `SUPABASE_SERVICE_ROLE_KEY` 而关掉了这个开关 → 邀请码填对了也建不了号。
> 这种情况下把开关重新打开，并在 README 里接受「邀请码只能挡住走界面的人」这个残留风险。

**验证**：`curl https://你的域名/api/auth/register` 应返回 `{"signup_open":true}`。
若返回 `false`，说明 `INVITE_CODE` 没配。

---

## 10. 装到手机 / 平板

**iPhone / iPad（必须 Safari）**
打开网址 → 底部「分享」→ 下滑选 **添加到主屏幕** → 添加。

**Android（Chrome / Edge）**
打开网址 → 右上角 `⋮` → **安装 / 添加到主屏幕**。

> **安卓上别用国产浏览器**（小米 / 华为 / OPPO / vivo / UC / QQ / 夸克），
> 也别用微信、QQ 的内置浏览器：它们都是裁剪过的网页控件，系统不开放 Push API
> （MDN 兼容表里 `webview_android` 明确是 false），每日早报在那边永远开不了。
>
> **换成 Chrome / Edge 安卓版能拿到 Push 权限，但不一定能收到推送。** 安卓上的网页推送
> 投递最终都要经过 Google 的 FCM 通道 —— 包括 Firefox 安卓版（见 Mozilla 源码文档
> [Push for Android](https://firefox-source-docs.mozilla.org/dom/push/index.html)：
> `Firebase Cloud Messaging → onNewToken → AbstractFirebasePushService`）。
> 国行手机通常没有 Google 服务，所以换浏览器解决不了这个问题。
> **想稳定收到每日早报，用桌面 Edge。**

**桌面 Chrome / Edge**
地址栏右侧出现安装图标，点一下即可；也可以在设置页点「立即安装」。

装好后从主屏图标打开，没有地址栏，和原生 App 一样。断网时会打开离线页。

> **iOS 注意**：iOS 17.2 起，添加到主屏幕时会把 Safari 的 cookie（含登录态）复制过去一次；
> 之后两边完全独立——在 App 里登出不影响 Safari，反之亦然。这是 WebKit 的设计，不是 bug。
> 换了账号记得两边分别登出。

---

## 11. 验收清单

- [ ] 邮箱密码能登录，刷新不掉线
- [ ] **不填邀请码 / 填错邀请码 → 注册被拒（403）**
- [ ] 填对邀请码 → 注册成功并直接进入主页（配了 service_role 时无需邮件）
- [ ] 退出登录 → 回到登录页，刷新仍是未登录
- [ ] 记一条 → 自动生成标题 / 摘要 / 标签
- [ ] 详情页「重新理解」能生成关联记录
- [ ] 问答能流式输出，回答里有 `[1][2]`，下方出处可点
- [ ] 「洞察」能生成阶段总结并保存历史
- [ ] 「待办」能勾选完成，AI 能排期
- [ ] 设置页导出 JSON，条数与实际一致
- [ ] 手机端布局正常，能添加到主屏
- [ ] 换一台设备登录，看到同一条记录
- [ ] （可选）配了 VAPID + CRON_SECRET 后，设置页能开启「每日早报」，手动 Run 一次 cron 能收到通知
- [ ] **两个账号互相看不到对方的数据（跑 `supabase/verify-multiuser.sql` 或手工 A/B 测）**

---

## 11.5 开启每日早报推送（可选）

每天早上 8:00（北京时间）给有待办的人推一条通知。**不配也能用，只是没有提醒。**

### 1) 生成 VAPID 密钥（只做一次）

```bash
npx web-push generate-vapid-keys
```

输出两个串：`Public Key` 和 `Private Key`。

> **生成一次就固定用**。换密钥 = 所有已订阅设备的订阅失效，
> 得让每个人重新点一次「开启每日早报提醒」。

### 2) 配环境变量

**本地**（`.env.local`）：

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<Public Key>
VAPID_PRIVATE_KEY=<Private Key>
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=<openssl rand -hex 32 生成的随机串>
```

**线上**：Vercel → Settings → Environment Variables，同样四个。
`CRON_SECRET` 必须配 —— Vercel 会自动把它拼成 `Authorization: Bearer <值>` 带在 cron 请求里。

然后**重新部署**（环境变量改了不会热更）。

### 3) cron 已经在 vercel.json 里了

```json
{
  "crons": [{ "path": "/api/cron/daily-reminder", "schedule": "0 0 * * *" }]
}
```

- Vercel cron 用 **UTC**：北京时间 8:00 = UTC 0:00 → `0 0 * * *`
- 部署后在 Vercel → Settings → Cron Jobs 能看到这条任务，可以点 **Run** 手动触发一次
- **Hobby 计划注意**：cron 触发会在目标小时内的某个时刻（最晚可能晚约 1 小时），
  所以「8:00 分秒不差」在免费档做不到，实际可能是 8:00–9:00 之间。
  要准点得升 Pro 或换外部调度器。

### 4) 在手机上开启

设置页 → 「每日早报」→ **开启每日早报提醒** → 浏览器弹权限询问 → 允许。
开启成功后旁边会多出一个 **「发一条测试通知」** 按钮，点它能立刻验证整条链路通不通，
不用等到第二天早上 8:00。

**iOS 是硬门槛**：必须先「添加到主屏幕」，再从主屏图标打开本页，才有推送。
在 Safari 标签页里点按钮只会看到「请先添加到主屏幕」。

完整的四步（朋友发过去照着做即可）：

1. 用 **Safari** 打开 `https://你的域名`（别的浏览器不行，微信里点开也不行）
2. 点底部「分享」按钮 **↑** → 下滑选 **「添加到主屏幕」** → 添加
3. **关掉 Safari**，从主屏幕上的新图标重新打开
4. 重新登录一次（主屏版和 Safari 的登录态是分开的）→ 设置页开启

> **iOS 这条路是通的**（和安卓不一样）：苹果的 Web Push 走 `web.push.apple.com`，
> 不经过 Google，国内网络也能连（2026-11-07 实测 TLS 1.3、1.05 秒）。
> 硬性要求只有两条：**iOS 16.4 或更新** + **已添加到主屏幕**。
> 低于 16.4 的旧 iPhone 只能走下面的邮件早报。

> **国内网络特别注意浏览器选型**：Chrome / Opera 的网页推送走 Google 的 FCM，
> 在国内网络下经常整个连不通（`pushManager.subscribe()` 既不报错也不返回，表现就是一直转圈）。
> 桌面端**改用 Microsoft Edge**（走 Windows 自带的 WNS 通道）即可，应用会识别这种情况直接提示换 Edge。
> 桌面 Firefox 走 Mozilla 自己的 Autopush（不经 FCM），也能用；**iPhone 用 Safari 即可**；
> 但**安卓 Firefox 例外**，见下。

> **安卓的硬限制（2026-11-07 实测 + Mozilla 源码文档确认）**：
> 安卓上**所有**主流浏览器（Chrome / Edge / Firefox / 三星 / UC…）的 Web Push 投递最终都要过
> Google 的 FCM 通道 —— Firefox 安卓版也一样（[Mozilla 源码文档](https://firefox-source-docs.mozilla.org/dom/push/index.html)
> 里 Android 那条路是 `AbstractFirebasePushService.kt` → FCM → Autopush bridge）。
> 国行手机没有 Google 服务，`subscribe()` 会**静默返回 null**（不报错），换任何浏览器都绕不过去。
> 所以**安卓手机请用下面的邮件早报**，别在 Web Push 上耗时间。
> **iPhone 不受这条限制**，按上面的四步装到主屏就能直接用 Web Push。

### 5) 验收

- [ ] 设置页「每日早报」卡片显示「开启每日早报提醒」，点击后变成「关闭每日早报」
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" https://你的域名/api/cron/daily-reminder`
      返回 `{"usersWithTasks":1,"sent":1,...}`，手机上收到通知
- [ ] 点通知 → 打开应用并停在「待办」页
- [ ] 待办全部清空后再触发 → `usersWithTasks: 0`，不发通知
- [ ] 不带 `Authorization` 头请求同一个地址 → `401`

> 通知没到？先查 Vercel 的 Cron 日志。410/404 的订阅会被自动删掉（用户卸载了 PWA 就会这样），
> 让对方重新点一次「开启」即可。

---

## 11.6 开启邮件早报（安卓用户请配这个）

前面的 Web Push 在**安卓上基本用不了**（投递要过 Google FCM，国行没 Google 服务）。
**iPhone 不受此限制**（苹果走 `web.push.apple.com`），但有 iOS 16.4 + 装到主屏两条硬门槛。
两边都不想折腾、或者朋友用的是安卓机，就配这个：邮件走普通 SMTP，不依赖任何浏览器推送通道 ——
手机上只要装了邮箱 App，通知照样会弹。

### 1) 拿一个 SMTP 授权码

以 QQ 邮箱为例：

1. 网页版 QQ 邮箱 → **设置 → 账号**
2. 找到「POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV 服务」，点**开启**
3. 按提示验证后拿到一串 **16 位授权码**（只显示一次，抄下来）

> ⚠️ `SMTP_PASS` 填的是这串**授权码**，不是你登录 QQ 的密码。填错会报
> `Invalid login: 535 Authentication failed`。

其他邮箱：163 是 `smtp.163.com`，Gmail 是 `smtp.gmail.com`（需要「应用专用密码」）。

### 2) 配环境变量

**本地**（`.env.local`）和 **Vercel**（Settings → Environment Variables）都配这几条：

```
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=你的账号@qq.com
SMTP_PASS=上面拿到的授权码
```

可选：`MAIL_FROM`（发件地址，默认等于 `SMTP_USER`）、`MAIL_FROM_NAME`（默认「信息管家」）、
`NEXT_PUBLIC_SITE_URL`（邮件里「查看全部」按钮指向哪，不配则用 Vercel 生产域名）。

- `SMTP_PORT=465` 配 `SMTP_SECURE=true`（隐式 SSL）；`587` 配 `false`（STARTTLS）。
  **这两个搞反的典型症状是「连上了但等不到欢迎语」后超时。**
- 改完环境变量要**重新部署**。

### 3) 数据库补一条

`schema.sql` 里新增了 `profiles.digest_enabled` 列和 `public.digest_recipients()` 函数。
**把整个 `supabase/schema.sql` 再跑一遍**即可（全脚本幂等，`alter table ... add column if not exists`）。

### 4) 验收

- [ ] `curl https://你的域名/api/health` → `"push":"configured"` 或至少 `"cron":"configured"`
- [ ] 设置页出现「邮件早报」卡片，点 **开启邮件早报** → 变成「关闭邮件早报」
- [ ] 点 **发一封测试邮件** → 收件箱里收到（没收到先翻垃圾邮件箱）
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" https://你的域名/api/cron/daily-reminder`
      → 响应里有 `"emailRecipients":1,"emailSent":1`

> 没有待办的人**不会**收到邮件（`emailRecipients` 只统计今天有待办的人），
> 所以验收时请先记一条 `kind=task` 且状态是 inbox/active 的待办。

---

## 关于「在 Supabase 里配置环境变量」

这里容易误会，说明白：

**Supabase 不托管这个 Next.js 应用的运行环境。** 应用的环境变量只有两个地方：

1. **本地**：项目根目录 `.env.local`
2. **线上**：Vercel → Project → Settings → Environment Variables

在 Supabase 控制台要配的是**认证相关的地址**（Site URL / Redirect URLs），不是环境变量。只有当你以后用到 Supabase Edge Functions 时，才需要在 Supabase 里配 `supabase secrets set`，那是另一套东西。

---

## 费用说明

| 项目 | 免费额度 | 个人 + 几个朋友够不够 |
| --- | --- | --- |
| Supabase Free | 500 MB 数据库、5 万月活、**7 天无请求会暂停** | 够。5 个人各记 50 条/天，一年也就几十 MB |
| Vercel Hobby | 100 GB 带宽；本项目单次函数上限设为 60 秒 | 够。个人流量远低于额度，AI 任务通常 10–30 秒 |
| 大模型 | 无免费额度（部分厂商有试用） | DeepSeek 约 ¥1–2/百万 token；每天记 10 条 + 每周一次总结，每月几块钱 |

> Supabase 免费项目**连续 7 天没有任何请求会被暂停**，表现为整站报错或登录失败。去控制台点 **Restore project** 即可恢复，数据不丢。经常用就不会触发。

---

## 更新代码 / 回滚

- 改完代码 `git push`，Vercel 自动构建部署
- 出问题去 **Deployments** → 找到上一个正常版本 → **⋯ → Promote to Production**
- 改了 `NEXT_PUBLIC_*` 环境变量：**Deployments → Redeploy**（不要勾选 use existing build cache）

---

## 故障排查

| 症状 | 最可能的原因 | 处理 |
| --- | --- | --- |
| 页面提示「还差最后一步配置」 | 没读到 `NEXT_PUBLIC_*` | 本地改完重启 dev；Vercel 改完重新部署 |
| 登录报 `Invalid login credentials` | 密码错 / 账号没建 | 用 Users → Add user 手动建一个 |
| 忘记密码 | — | Supabase → Authentication → Users → 对应用户 → ⋯ → Reset password / Send recovery |
| 点邮件链接跳回 localhost | Site URL 还是本地地址 | 第 8 步回填线上域名 |
| 登录成功但立刻被踢回 | Redirect URLs 缺 `/auth/callback` | 补上并保存 |
| 记录能存，但没有摘要 | `AI_API_KEY` 没读到 / 余额不足 | 看 Vercel → Logs，或本地终端报错 |
| AI 报 401 | Key 错或过期 | 重新生成 Key |
| AI 报 404 | `AI_BASE_URL` 少了 `/v1` | 补成 `https://api.deepseek.com/v1` |
| 生成总结 504 | 记录太多，超过 60 秒 | 缩短时间范围（先看 7 天） |
| 表格不存在 / `relation does not exist` | 没跑 SQL 或跑错项目 | 重跑 `supabase/schema.sql` |
| 本地打开返回一段英文 401 JSON | 访问到了被其它服务占用的端口 | 确认 dev 实际监听的端口，或用 `-p` 指定一个空闲端口 |
| 手机上没有安装提示 | 不是 HTTPS，或用的不是 Safari/Chrome | 用 Vercel 域名，iOS 走「添加到主屏幕」 |
| 换设备看不到数据 | 登录了不同账号 | RLS 按账号隔离，确认邮箱一致 |
| **安卓手机上提示「不支持网页推送」** | 用的是小米 / 华为 / OPPO / vivo / UC / QQ / 夸克等国产浏览器，或微信内置浏览器 —— 都是 WebView 壳，系统不开放 Push API | 换 Chrome / Edge 安卓版能拿到权限；但**投递仍要过 Google 的 FCM 通道**，国行手机通常没有 Google 服务。想稳定收到就用桌面 Edge |
| 安卓上换了 Firefox 还是开不起来（报 `can't access property "toJSON", e is null` 或「没拿到推送地址」） | Firefox 安卓版的推送同样依赖 FCM（[Mozilla 源码文档](https://firefox-source-docs.mozilla.org/dom/push/index.html)），没有 Google 服务时 `subscribe()` 会静默返回 null | 换浏览器绕不过去；**手机端改用「邮件早报」（见 11.6）**，桌面用 Edge |
| 手机端想要通知但 Web Push 死活不通 | 安卓的 Web Push 投递必经 Google FCM | 用「邮件早报」：配 SMTP → 设置页开启 → 点「发一封测试邮件」 |
| 邮件早报按钮置灰 / 提示没配发信账号 | 缺 `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | 配好三条并重新部署（见 11.6） |
| 点「发一封测试邮件」报 `Invalid login: 535 Authentication failed` | `SMTP_PASS` 填成了登录密码 | 填的是**授权码**（QQ 邮箱在设置→账号里开 SMTP 后获取） |
| 测试邮件发送超时 / 「连上了但等不到欢迎语」 | `SMTP_PORT` 与 `SMTP_SECURE` 配反了 | 465 配 `true`（隐式 SSL）；587 配 `false`（STARTTLS） |
| 邮件发出去了但没收到 | 进了垃圾邮件箱 | 把发件地址加进白名单；可配 `MAIL_FROM` 用自己域名 |
| cron 响应里 `emailRecipients: 0` | 没人开邮件早报，或开了的人今天没待办 | 只给「开了开关 + 有待办」的人发，属正常 |
| 点「开启每日早报」提示「请先添加到主屏幕」 | iOS 在 Safari 标签页里，没装到主屏 | 「添加到主屏幕」→ 从主屏图标打开再点 |
| 点按钮没反应 / 一直「处理中」 | 服务端没配 VAPID，按钮被禁用 | 配 `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` 后重新部署 |
| 点了「处理中…」等 20 秒后提示连不上推送服务 | 浏览器到推送服务不通（Chrome 走 FCM，国内常被墙） | **换 Microsoft Edge 打开同一页面再开**；或用「发一条测试通知」定位 |
| 按钮能点，但浏览器不弹权限框 | 之前点过「拒绝」 | 地址栏左侧站点设置 → 通知 → 允许 |
| 开启了但点测试通知也没反应 | 打开的是 `192.168.x.x` 这类 HTTP 地址 | 网页推送只支持 https 或 localhost |
| cron 返回 503 `cron_disabled` | 没配 `CRON_SECRET`（本地手动跑也要） | 配一个随机串；本地可在 `.env.local` 里设 |
| cron 返回 503 `push_disabled` | VAPID 和 SMTP **两条通道都没配**（只配一条就能跑） | 至少配一条：VAPID 或 SMTP |
| cron 返回 500 `db_error`，日志里是 `permission denied for table <表名>`（`42501`） | 建库时漏了给 `service_role` 授表权限。日志的 `hint` 那行会直接写出该跑的 GRANT | 跑 `supabase/fix-service-role-grant.sql`（一次补齐三张表）；只想贴单条就照 `hint` 抄，例如 `grant select on table public.entries to service_role;` |
| 邮件收到了，但正文只有数字没有待办标题 | 同上，`service_role` 缺 `entries` 的 SELECT 权限（这一条不会让邮件失败，只是少了标题） | 跑 `supabase/fix-service-role-grant.sql` |
| cron 返回 200 但没人收到通知 | 订阅被 410 清掉了 / 用户没开提醒 | 看响应里的 `pruned`；让对方重新开启 |
| 早报时间不准（8:00 变成 8:40） | Hobby 计划的 cron 会在目标小时内偏移 | 免费档正常现象，要准点需 Pro 或外部调度 |

---

## 可选：绑定自己的域名

Vercel → Project → **Settings → Domains** → 添加域名 → 按提示在域名商处加 CNAME。

绑定后别忘了回 Supabase 把 **Site URL** 和 **Redirect URLs** 改成新域名。
