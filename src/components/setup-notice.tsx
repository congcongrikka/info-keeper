import { TriangleAlert } from "lucide-react";

const ENV_SAMPLE = `NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
AI_BASE_URL=https://api.deepseek.com/v1
AI_API_KEY=sk-...
AI_MODEL=deepseek-chat`;

/** 环境变量缺失时的引导页：比抛一个 500 有用得多 */
export function SetupNotice() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="glass-strong w-full max-w-lg rounded-3xl p-6 sm:p-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-amber/15 text-amber">
            <TriangleAlert className="size-4" />
          </span>
          <h1 className="text-[19px] font-semibold tracking-tight text-bright">还差最后一步配置</h1>
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          应用已经跑起来了，但还没有连上 Supabase。在项目根目录新建{" "}
          <code className="rounded bg-white/10 px-1 py-0.5 text-[12px]">.env.local</code>，
          填入下面这些值，然后重启{" "}
          <code className="rounded bg-white/10 px-1 py-0.5 text-[12px]">npm run dev</code>。
        </p>

        <pre className="mt-4 overflow-x-auto rounded-2xl bg-night-2 px-4 py-3 text-[11.5px] leading-relaxed text-miku/90">
          {ENV_SAMPLE}
        </pre>

        <ol className="mt-5 space-y-2 text-[12.5px] leading-relaxed text-muted">
          <li>
            <span className="mr-1.5 font-medium text-miku">1.</span>
            去 Supabase 新建项目，在 Project Settings → API 里复制 URL 和 anon key。
          </li>
          <li>
            <span className="mr-1.5 font-medium text-miku">2.</span>
            把 <code className="rounded bg-white/10 px-1 py-0.5">supabase/schema.sql</code> 整段贴进 SQL Editor 执行。
          </li>
          <li>
            <span className="mr-1.5 font-medium text-miku">3.</span>
            在 Authentication → Users 里创建你的账号，然后关掉公开注册。
          </li>
          <li>
            <span className="mr-1.5 font-medium text-miku">4.</span>
            AI Key 是可选的；不填也能记录、检索、导出，只是没有自动整理。
          </li>
        </ol>

        <p className="mt-5 text-[11.5px] leading-relaxed text-faint">
          部署到 Vercel 时，同样的变量填在 Project → Settings → Environment Variables 里，重新部署即可。
        </p>
      </div>
    </div>
  );
}
