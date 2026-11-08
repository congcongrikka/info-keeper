# Info Keeper v1.7.0 — 首个公开版本

## Highlights

- 把「随手记」变成可检索知识库：一次写入触发 AI 结构化整理（类型、标题、摘要、标签、重点、下一步、优先级、截止时间），结果落到数据库列上而不是一段自由文本。
- RAG 检索增强问答：`pg_trgm` 中文三元组召回 → 三路合并去重 → 字符预算裁剪 → 流式回答，句末 `[1][2]` 标注出处并可跳回原文。
- 条目自动串联（`related` / `duplicate` / `follow_up` / `contradicts`），详情页双向可见。
- 多用户隔离双保险：数据库 RLS（`auth.uid() = user_id`）+ 应用层每个查询强制带 `userId`。
- 邀请码注册：服务端 `sha256` + `timingSafeEqual`、按 IP 限流、未配置即关闭注册（fail-closed）。
- 每日早报双通道：Vercel Cron 触发，Web Push 按设备投递并自动清理 404/410 订阅；SMTP 邮件作为安卓国行设备收不到 FCM 时的兜底。
- PWA 与 iOS 主屏适配；JSON 一键导出全部数据。
- **v1.7.0 起以 MIT 协议开源**，补齐了社区与工程化文件。

## Breaking Changes

None. 本次发布只新增开源治理文件与文档，未改动业务逻辑、数据库结构或对外接口。

> 一处行为变化需要留意：主题角色插画因版权原因不再随仓库分发，未安装时界面显示中性占位；功能不受影响。开发服务器改用 Next.js 默认端口 3000，可用 `npm run dev -- -p <端口>` 自定义。

## Security

- 密钥分层：`AI_API_KEY` / `INVITE_CODE` / `SUPABASE_SERVICE_ROLE_KEY` / `VAPID_PRIVATE_KEY` / `CRON_SECRET` / `SMTP_PASS` 只在服务端读取，不带 `NEXT_PUBLIC_` 前缀。
- 注册与定时接口 fail-closed；`service_role` 收口在 `src/lib/supabase/admin.ts`，跨用户聚合函数只授权给 `service_role`。
- zod 输入校验 + 模型输出 normalize；`next.config.ts` 统一配置安全响应头；SW 导航请求 network-only，避免跨账号页面缓存。
- 公开前完成：`.env.example` 全占位化、内部交接文档与含真实邮箱的审计截图不纳入公开仓库、以干净的全新初始提交发布。
- 漏洞报告渠道、支持版本与密钥轮换建议见 [SECURITY.md](../SECURITY.md)。

## Docs

- 部署、维护、API、iOS 注册与推送指南保持中文并去除私人域名 / 本机路径 / 真实账号数据。
- 新增：[CONTRIBUTING.md](../CONTRIBUTING.md)、[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)、[CHANGELOG.md](../CHANGELOG.md)、[NOTICE](../NOTICE)、[docs/OPEN_SOURCE_CHECKLIST.md](OPEN_SOURCE_CHECKLIST.md)、Issue / PR 模板与 CI workflow。
- 第三方依赖与素材授权边界见 [NOTICE](../NOTICE) 与 [public/miku/README.md](../public/miku/README.md)。

## Thanks

这是项目的第一个公开版本。欢迎提 Issue、报 bug、分享自部署经验或发 PR —— 尤其欢迎关于中文检索效果与移动端体验的反馈。

> 仓库地址、署名与联系方式已在发布前处理完毕；`your-deployment.example.com` 是保留示例地址，不指向任何真实实例。上线前仍需完成的网页设置见 [docs/OPEN_SOURCE_CHECKLIST.md](OPEN_SOURCE_CHECKLIST.md)。
