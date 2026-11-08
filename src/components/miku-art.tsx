"use client";

import { useState, type CSSProperties } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * 主题插画组件（素材可选）
 *
 * 素材原图都是「纯黑背景、无 alpha」的画。直接用 mix-blend-mode: screen
 * 只在扁平深色底上成立，放进 .glass 卡片就会露出黑色矩形；mask 羽化又会
 * 切掉角色伸出去的胳膊和头发。
 *
 * 最终做法：先用 scripts/build-miku-art.mjs 从四边 flood fill 抠掉连通到
 * 边缘的黑色，输出自带 alpha 的 WebP 到 public/miku/art/。组件只负责排版
 * 和动效，不再依赖任何混合模式。
 *
 * 融合手段（都在 globals.css 末尾，见 .miku-halo / .miku-melt / .miku-watermark）：
 * - halo：角色背后垫一层主题绿径向光晕 + drop-shadow 轮廓光；
 * - melt：radial-gradient mask 让边缘融化进背景，消除抠图的矩形感；
 * - watermark：收件箱卡片的角落水印，linear-gradient 渐隐，不压文字。
 *
 * ⚠️ 插画素材出于版权原因**不随仓库分发**，见 public/miku/README.md 与
 * 根目录 NOTICE。素材缺失或加载失败时渲染中性占位，不改变任何业务逻辑。
 */

const PLACEHOLDER_STYLE: CSSProperties = {
  display: "block",
  position: "absolute",
  inset: 0,
  borderRadius: "1rem",
  border: "1px solid rgba(57, 197, 187, 0.18)",
  background:
    "radial-gradient(circle at 50% 38%, rgba(57,197,187,0.22), rgba(57,197,187,0.05) 62%, transparent 78%)",
};

const AVATAR_PLACEHOLDER_STYLE: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  borderRadius: "inherit",
  background:
    "radial-gradient(circle at 50% 40%, rgba(57,197,187,0.35), rgba(57,197,187,0.08) 70%, transparent)",
};

/** 主题素材缺失时的中性占位：不显示破图、不抛错、不影响布局比例 */
function ArtPlaceholder({ avatar = false }: { avatar?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-theme-art-placeholder=""
      style={avatar ? AVATAR_PLACEHOLDER_STYLE : PLACEHOLDER_STYLE}
    />
  );
}

const ART = {
  login: {
    src: "/miku/art/miku-login.webp",
    alt: "主题插画",
    ratio: "768 / 1058",
    sizes: "(min-width: 1024px) 256px, 192px",
    /* 原画在画布底边/左缘被硬切，需要渐变收边 */
    fade: true,
  },
  empty: {
    src: "/miku/art/miku-empty.webp",
    alt: "主题插画",
    ratio: "640 / 882",
    sizes: "160px",
    fade: true,
  },
  corner: {
    src: "/miku/art/miku-corner.webp",
    alt: "主题插画",
    ratio: "1 / 1",
    sizes: "96px",
    fade: false,
  },
} as const;

export type MikuArtName = keyof typeof ART;

export function MikuArt({
  name,
  className,
  priority = false,
  float = true,
  halo = false,
  melt = false,
}: {
  name: MikuArtName;
  /** 只管宽度，比例由组件内置的 aspectRatio 保证 */
  className?: string;
  priority?: boolean;
  float?: boolean;
  /** 背后垫主题绿径向光晕 + 轮廓光（登录页/空态推荐开） */
  halo?: boolean;
  /** 边缘径向融化（radial-gradient mask），用于消除卡片里的矩形边界 */
  melt?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const art = ART[name];
  return (
    <div
      className={cn(
        "miku-scene",
        art.fade && !melt && "miku-fade",
        halo && "miku-halo",
        melt && "miku-melt",
        float && "animate-float",
        className,
      )}
      style={{ aspectRatio: art.ratio }}
    >
      {failed ? (
        <ArtPlaceholder />
      ) : (
        <Image
          src={art.src}
          alt={art.alt}
          fill
          sizes={art.sizes}
          priority={priority}
          className="miku-art"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

/**
 * 问答界面 AI 头像：整幅缩放，不裁剪
 *
 * 原图近方形，object-cover 在小方形容器里只裁掉很少的边，比手工裁剪完整。
 * 素材缺失时显示中性径向渐变占位。
 */
export function MikuAvatar({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        "miku-avatar-ring inline-block size-10 shrink-0 overflow-hidden rounded-xl",
        className,
      )}
    >
      {failed ? (
        <ArtPlaceholder avatar />
      ) : (
        <Image
          src="/miku/miku-avatar.jpg"
          alt="管家"
          width={200}
          height={200}
          sizes="40px"
          className="size-full object-cover object-top"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
