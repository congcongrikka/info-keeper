# 参与贡献

感谢你愿意花时间在信息管家上。这是一个以中文文档为主的个人项目，v1.7.0 起公开协作。

## 开始前

- 中文或英文交流都可以。
- 请先读一遍 [README.md](README.md) 了解整体设计，再看 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) 里的目录划分、命名与 Git 提交规范。
- 参与即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
- **安全漏洞不要公开提 Issue**，请走 [SECURITY.md](SECURITY.md) 的私有报告渠道。

## 提 Issue

- Bug 请用 [Bug 模板](.github/ISSUE_TEMPLATE/bug_report.yml)，尽量给出版本、复现步骤、期望与实际行为、相关日志（**贴日志前先删掉邮箱、密钥、域名**）。
- 功能建议请用 [功能建议模板](.github/ISSUE_TEMPLATE/feature_request.yml)，说明它解决什么问题，以及是否会影响多用户隔离。
- 提之前先搜一下已有 Issue，重复问题会被合并。

## 发 PR

1. 从 `main` 切出 `feat/<名字>` 或 `fix/<名字>` 分支。
2. 一次 PR 只做一件事；跨层联动改动（schema / types / db / normalize）放同一个提交。
3. 提交信息用 `<type>: <简短中文描述>`，type 取值见 [docs/CONTRIBUTING.md § 7](docs/CONTRIBUTING.md)。
4. 本地先跑：

   ```bash
   npm ci
   cp .env.example .env.local
   npm run typecheck
   npm run build
   ```

   `build` 不需要真实的 Supabase 连接（所有页面与接口都是 `force-dynamic`），用 `.env.example` 的占位值即可；但**请把真实值写在 `.env.local` 里，它不会被提交**。
5. PR 描述按 [模板](.github/PULL_REQUEST_TEMPLATE.md) 填写，CI 会在 PR 上自动跑 `npm ci` → `typecheck` → `build`。

## 几条硬规矩

- **密钥只在服务端**：任何 `process.env.<SECRET>` 只能出现在 `src/lib/**` 或 `src/app/api/**/route.ts`，不能进带 `"use client"` 的文件，也不能加 `NEXT_PUBLIC_` 前缀。
- **每个数据库查询都要带 `userId`**：RLS 是最后一道墙，不是唯一一道。
- **新的公开路由**要加进 `src/proxy.ts` 的 `PUBLIC_PREFIXES`。
- **新表必须开 RLS**，用户输入走 zod，模型输出走 normalize。
- 不要在 PR 里放真实邮箱、真实用户数据、密钥，或受第三方版权保护的插画素材。

## 主题素材

角色插画因版权原因不随仓库分发，`public/miku/` 默认只有说明文件。想恢复带插画的视觉效果，请自行准备并确认使用权的素材，再按 [public/miku/README.md](public/miku/README.md) 安装；未安装时界面会自动显示中性占位，功能不受影响。授权边界见 [NOTICE](NOTICE)。

## 发布前的人工设置

如果你是维护者本人，仓库可见性、分支保护、Secret scanning、Dependabot、Actions 授权这些**只能在 GitHub 网页做**，清单在 [docs/OPEN_SOURCE_CHECKLIST.md](docs/OPEN_SOURCE_CHECKLIST.md)。

---

规范是为了减少决策成本，不是为了增加仪式感。遇到规范没覆盖的情况，选「半年后的自己能看懂」的那个方案。
