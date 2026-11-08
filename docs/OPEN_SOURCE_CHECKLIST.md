# 开源上线前人工检查清单

> 本文件记录**必须在 GitHub 网页上由人完成**的设置。仓库内的文件已经准备好，但下面这些开关无法通过提交代码代替。

## 一、占位符（已处理）

| 项 | 结果 |
| --- | --- |
| 仓库地址 | 已统一为 `congcongrikka/info-keeper`（badge、`package.json`、Issue 模板、CHANGELOG 链接） |
| 联系邮箱 | **不公开**。安全漏洞走 GitHub 私有漏洞报告；行为准则举报通过维护者 GitHub 主页私下联系 |
| 署名 | 保持 `Copyright (c) 2026 congcongrikka` |
| 示例域名 | 保持 `your-deployment.example.com`（RFC 保留示例地址，不指向任何真实实例） |

> 若你 fork 了本仓库，请按自己的情况重新检查以上四项。

## 二、GitHub 网页设置

| # | 位置 | 操作 |
| --- | --- | --- |
| 1 | 新建仓库 / Settings → General | 确认可见性为 **Public**；建议先建 Private，全部检查完再切 Public |
| 2 | Settings → Code security | 打开 **Secret scanning** 与 **Push protection** |
| 3 | Settings → Code security | 打开 **Dependabot alerts**（可选再开 Dependabot security updates） |
| 4 | Settings → Actions → General | 首次授权 Actions 运行；把 Workflow permissions 设为 **Read repository contents**（本仓库 CI 不需要写权限） |
| 5 | Settings → Branches | 给 `main` 加分支保护：要求 PR、要求 `CI` 检查通过、禁止 force push |
| 6 | Settings → Secrets and variables → Actions | 本仓库 CI 用假值即可跑通，**通常不需要配任何 Secret**；若你改了 CI 让 build 连真实 Supabase，才在这里加 |
| 7 | Settings → General → Features | 建议开启 Issues、Discussions；关闭不需要的 Wiki/Projects |
| 8 | Security → Report a vulnerability | 确认**私有漏洞报告**已启用（`SECURITY.md` 指向它） |

## 三、推送前最后自查

```bash
git status --short                  # 确认没有 .env.local / .vercel-token / *.log
git ls-files | grep -Ei '\.env$|secret|token|\.log$'   # 只应出现 .env.example 这类样例
npm run typecheck
```

- 只推送 `main`（干净的新历史）。**不要** `git push --all` / `git push --mirror`——本地 `master` 分支仍保留旧的私有快照。
- 首次 PR 用来验证 `CI`：`npm ci` → `npm run typecheck` → `npm run build`。若 build 因环境依赖失败，按 `.github/workflows/ci.yml` 里的注释跳过 build，不要塞真实密钥进 CI。

## 四、发布后

- 在 Release 页面用 `docs/RELEASE_NOTES_v1.7.0.md` 的内容发布 `v1.7.0`。
- 若 `INVITE_CODE` 曾用过 `.env.example` 里的旧示例值，先在部署平台轮换。
- 把 `LICENSE` / `SECURITY.md` / `CONTRIBUTING.md` 的链接在 README 里点一遍，确认跳转正常。
