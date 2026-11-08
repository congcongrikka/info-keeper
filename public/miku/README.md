# 可选主题素材目录

**这个目录默认是空的，仓库不附带任何角色插画。**

「初音未来」（Hatsune Miku）及相关角色形象是 Crypton Future Media, Inc. 的商标与受版权保护的作品；通过 piapro 提供的角色素材受其角色授权条款（含非商业限制）约束。出于这个原因，本仓库**不分发、不镜像、也不提供任何下载链接**给这类素材，项目主协议（MIT，见根目录 `LICENSE`）也**不适用于**它们。详见根目录 `NOTICE`。

如果你希望恢复带角色图的视觉效果，需要**自行取得并确认你有权使用的素材**，然后放到下面的路径：

```text
public/miku/
├─ miku-avatar.jpg              问答界面的头像（近方形，组件会整幅缩放）
└─ art/
   ├─ miku-login.webp          登录页大图（自带 alpha）
   ├─ miku-empty.webp          空态页插图（自带 alpha）
   ├─ miku-corner.webp         侧栏 / 卡片角落水印（自带 alpha）
   └─ miku-avatar.webp         备用头像（可选）
```

准备好同样结构的源目录后，可用仓库自带的安装脚本复制进去（脚本不联网、不内置任何素材地址）：

```bash
npm run theme-art -- --source /path/to/your/art
npm run theme-art -- --check        # 只列出当前缺哪些文件
```

源目录里只要有同名文件即可，扩展名不匹配会被跳过。`scripts/build-miku-art.mjs` 仍可用于把自备的黑底原图离线抠成带 alpha 的 WebP。

**没有这些文件时应用不会报错**：登录页、空态、侧栏与头像会自动显示中性的内置占位（`src/components/miku-art.tsx` 的资源加载兜底），记录、检索、问答、早报等所有功能都正常可用。

> 请自行判断并承担素材使用的合规责任：本仓库没有、也不声称持有任何第三方插画的授权文件或来源凭证。
