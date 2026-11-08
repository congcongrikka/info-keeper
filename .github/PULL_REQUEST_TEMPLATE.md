## 这个 PR 做了什么

<!-- 一句话说清改动，以及它解决什么问题。一次 PR 只做一件事。 -->

关联 Issue：<!-- 例如 Closes #12；没有就写「无」 -->

## 改动类型

- [ ] Bug 修复
- [ ] 新功能
- [ ] 文档 / 开源治理
- [ ] 重构（不改行为）
- [ ] 其他：

## 自检

- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过（如因环境问题未跑，请在下面说明）
- [ ] 没有把真实密钥、真实邮箱、真实用户数据写进仓库
- [ ] 没有引入受第三方版权保护的素材
- [ ] 新的公开路由已加进 `src/proxy.ts` 的 `PUBLIC_PREFIXES`
- [ ] 新增 / 修改的数据库查询都带 `userId` 过滤，新表已开 RLS
- [ ] 用户输入走 zod，模型输出走 normalize
- [ ] 改动不影响邀请码 fail-closed 与 `CRON_SECRET` fail-closed 行为
- [ ] 中文文档仍为中文，通用文件（LICENSE / SECURITY / CoC 等）仍为英文

## 需要 reviewer 特别注意

<!-- 有没有改接口、改 schema、改环境变量？有没有需要人工验证的场景？ -->
