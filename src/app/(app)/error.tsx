"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] 渲染出错", error);
  }, [error]);

  const isSchemaIssue = /relation .* does not exist|schema cache|permission denied/i.test(error.message);

  return (
    <div className="glass flex min-h-[60vh] flex-col items-center justify-center rounded-3xl px-6 text-center">
      <p className="text-[20px] font-semibold text-bright">
        {isSchemaIssue ? "数据库还没准备好" : "这一页没加载出来"}
      </p>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-faint">
        {isSchemaIssue
          ? "看起来 Supabase 里还没建表。把项目里的 supabase/schema.sql 整段贴到 SQL Editor 跑一遍，然后刷新。"
          : "可能是网络抖了一下。重试一次通常就好；如果反复出现，检查一下环境变量和服务端日志。"}
      </p>
      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="neon-soft inline-flex items-center gap-1.5 rounded-full bg-miku px-4 py-2 text-[12.5px] font-medium text-night transition hover:neon"
        >
          <RotateCcw className="size-3.5" />
          重试
        </button>
        <Link
          href="/"
          className="glass rounded-full px-4 py-2 text-[12.5px] text-muted transition hover:text-bright"
        >
          回到收件箱
        </Link>
      </div>
    </div>
  );
}
