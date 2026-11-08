import type { SVGProps } from "react";

/**
 * 初音未来主题自定义图标
 * - LeekIcon：大葱（ negi ），白色葱身 + 葱绿叶片
 * - MikuSilhouette：双马尾剪影，单色 currentColor
 */

const MIKU_GREEN = "#39c5bb";
const MIKU_LIGHT = "#7fe3dc";

export function LeekIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      role="presentation"
      {...props}
    >
      {/* 白色葱身 */}
      <path
        d="M10.3 11.2h3.4l-.45 7.9c-.08 1.2-.85 2.1-1.9 2.1h-.1c-1.05 0-1.82-.9-1.9-2.1l-.45-7.9z"
        fill="currentColor"
        opacity="0.92"
      />
      {/* 根须 */}
      <path
        d="M10.9 21.1c-.5.4-.6.9-.3 1.4M13.1 21.1c.5.4.6.9.3 1.4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      {/* 左侧叶片 */}
      <path
        d="M11.2 11.6C9.8 8.2 8.4 5.2 6.6 2.6c2.9.5 4.5 3.2 5 7.2l-.4 1.8z"
        fill={MIKU_GREEN}
      />
      {/* 右侧叶片 */}
      <path
        d="M12.8 11.6c1.4-3.4 2.8-6.4 4.6-9c-2.9.5-4.5 3.2-5 7.2l.4 1.8z"
        fill={MIKU_GREEN}
      />
      {/* 中间叶片 */}
      <path
        d="M12 11.4c.2-3.6.3-6.8.2-9.8 1.2 2.6 1.4 6 .6 9.8z"
        fill={MIKU_LIGHT}
      />
    </svg>
  );
}

export function MikuSilhouette({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      role="presentation"
      {...props}
    >
      {/* 头部 */}
      <circle cx="12" cy="8.4" r="4.3" />
      {/* 左侧双马尾 */}
      <path d="M8.3 7.6c-2.7.8-4.5 3-5 6-.4 2.5.1 4.8 1.1 6.8.3.6 1.1.5 1.3-.1.7-2.4 2-4.2 3.7-5.4l1.5-1-1.3-2.2c-.5-.9-1.1-1.6-1.8-1.9z" />
      {/* 右侧双马尾 */}
      <path d="M15.7 7.6c2.7.8 4.5 3 5 6 .4 2.5-.1 4.8-1.1 6.8-.3.6-1.1.5-1.3-.1-.7-2.4-2-4.2-3.7-5.4l-1.5-1 1.3-2.2c.5-.9 1.1-1.6 1.8-1.9z" />
      {/* 接合处补缝，避免头部与马尾之间出现细缝 */}
      <circle cx="7.6" cy="9.9" r="1.3" />
      <circle cx="16.4" cy="9.9" r="1.3" />
      {/* 初音发色发饰 */}
      <rect x="7.1" y="7.4" width="1.7" height="1.5" rx="0.45" fill={MIKU_GREEN} />
      <rect x="15.2" y="7.4" width="1.7" height="1.5" rx="0.45" fill={MIKU_GREEN} />
    </svg>
  );
}
