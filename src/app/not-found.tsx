import Link from "next/link";

export default function NotFound() {
  return (
    <div className="glass flex min-h-dvh flex-col items-center justify-center rounded-none px-6 text-center">
      <p className="neon-text text-[64px] leading-none text-miku">404</p>
      <p className="mt-4 text-[19px] font-semibold text-bright">这里没有东西</p>
      <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-faint">
        记录可能被删掉了，或者链接不太对。
      </p>
      <Link
        href="/"
        className="neon-soft mt-6 rounded-full bg-miku px-4 py-2 text-[12.5px] font-medium text-night transition hover:neon"
      >
        回到收件箱
      </Link>
    </div>
  );
}
