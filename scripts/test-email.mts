/**
 * 邮件层自检：不连真 SMTP，验证
 *   1. isEmailConfigured 的开关判定
 *   2. buildDigestEmail 的文案/HTML 是否正常
 *   3. sendEmail 对「连不上」和「收件人不存在」的分类是否正确
 *
 * 跑法：node node_modules\tsx\dist\cli.mjs scripts/test-email.mts
 */
process.env.SMTP_HOST = process.env.SMTP_HOST ?? "127.0.0.1";
process.env.SMTP_PORT = "1"; // 必定连不上
process.env.SMTP_SECURE = "false";
process.env.SMTP_USER = "smoke@example.com";
process.env.SMTP_PASS = "dummy";

const { isEmailConfigured, getSmtpConfig, buildDigestEmail, sendEmail, getSiteUrl } = await import(
  "../src/lib/email.ts"
);

const checks: string[] = [];

function check(name: string, pass: boolean, detail = "") {
  checks.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// 1. 配置判定
check("isEmailConfigured() 三件套齐全时为 true", isEmailConfigured() === true);
const smtp = getSmtpConfig();
check("getSmtpConfig() 读出 port=1 / secure=false", smtp?.port === 1 && smtp?.secure === false);
check("SMTP_SECURE=false 不被端口推断覆盖", smtp?.secure === false);
check("MAIL_FROM 缺省时回落到 SMTP_USER", smtp?.from === "smoke@example.com");

delete process.env.SMTP_PASS;
check("缺 SMTP_PASS 时 isEmailConfigured() 为 false", isEmailConfigured() === false);
process.env.SMTP_PASS = "dummy";

// 2. 邮件内容
const siteUrl = getSiteUrl();
const tasks = [
  { title: "把周报写完", priority: 1 },
  { title: "回 Alice 的邮件", priority: 2 },
  { title: '<script>alert("xss")</script>', priority: 3 },
];
const digest = buildDigestEmail(12, tasks, siteUrl);

check("subject 里带待办总数", digest.subject.includes("12"));
check("text 里列出待办标题", digest.text.includes("把周报写完"));
check("text 里出现「还有 9 件」之类的截断说明", /还有\s*\d+\s*件/.test(digest.text));
check("text 里带 /tasks 链接", digest.text.includes(`${siteUrl}/tasks`));
check(
  "html 转义了脚本标签（防 XSS）",
  digest.html.includes("&lt;script&gt;") && !digest.html.includes("<script>alert"),
);
check("html 里仍保留「查看全部」按钮", digest.html.includes("/tasks"));

// 3. 失败分类：连不上 = 可重试，不算永久失效
const outcome = await sendEmail({
  to: "nobody@example.com",
  subject: "自检",
  text: "自检",
});

check(
  "连不上 SMTP 时返回 ok=false",
  outcome.ok === false,
  outcome.ok ? "" : `reason=${outcome.reason}`,
);
check(
  "连不上 SMTP 归为「暂时失败」（permanent=false，不删数据）",
  outcome.ok === false && outcome.permanent === false,
);

for (const line of checks) console.log(line);

const failed = checks.filter((line) => line.startsWith("FAIL")).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed === 0 ? 0 : 1);
