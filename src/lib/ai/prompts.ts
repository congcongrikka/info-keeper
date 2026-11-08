import type { AiMessage } from "@/lib/ai/provider";
import type { Entry } from "@/lib/types";
import { KIND_META } from "@/lib/types";

const TZ = "Asia/Shanghai";

export function formatDate(iso: string, withTime = false): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

export function nowText(now = new Date()): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
}

function entryBlock(entry: Entry, index: number, contentLimit = 600): string {
  const tags = entry.tags.length ? ` · ${entry.tags.map((t) => `#${t}`).join(" ")}` : "";
  const summary = entry.summary ? `\n摘要：${entry.summary}` : "";
  const content = entry.content.replace(/\s+/g, " ").trim().slice(0, contentLimit);
  return [
    `[${index}] ${formatDate(entry.created_at)} · ${KIND_META[entry.kind].label}${tags}`,
    `标题：${entry.title || "（无标题）"}`,
    `${summary}`,
    `内容：${content}`,
    `id: ${entry.id}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ */
/*  1. 条目理解：分类 / 标题 / 摘要 / 标签 / 重点 / 关联                */
/* ------------------------------------------------------------------ */

export function buildAnalysisMessages(input: {
  content: string;
  sourceUrl?: string | null;
  candidates: Entry[];
  now?: Date;
}): AiMessage[] {
  const candidates = input.candidates
    .map((entry, i) => {
      const excerpt = (entry.summary || entry.content).replace(/\s+/g, " ").slice(0, 160);
      return `- id=${entry.id} | ${formatDate(entry.created_at)} | ${KIND_META[entry.kind].label} | ${
        entry.title || "（无标题）"
      } | ${entry.tags.map((t) => `#${t}`).join(" ")} | ${excerpt}`;
    })
    .join("\n");

  const system = `你是「信息管家」的理解引擎。用户会把零散的灵感、笔记、待办、链接丢进来，你要把它整理成可检索、可串联的结构化数据。

只输出一个 JSON 对象，不要输出 Markdown 代码块、不要解释。字段如下：
{
  "title": "≤24 字的标题，概括这条记录的核心，不要以句号结尾",
  "kind": "idea | note | task | link | reference",
  "summary": "1-2 句话说明这条记录在说什么、意味着什么，≤80 字",
  "tags": ["2-4 个中文短标签，不加 #，用于以后检索"],
  "key_points": ["0-3 条原文里真正重要的信息点，没有就给空数组"],
  "next_actions": ["0-2 条明确可执行的下一步，不是待办就给空数组"],
  "priority": 1,
  "due_at": null,
  "related_ids": ["从候选条目里挑选真正相关的，最多 3 个"],
  "relation_reason": "一句话说明为什么相关，没有关联就留空字符串"
}

判定规则：
- kind：有明确动作要做 → task；纯灵感/构思/判断 → idea；事实、摘录、随手记 → note；主要是收藏一个网址 → link；成篇的资料/文档/长文 → reference。
- priority：3 = 紧急且重要（有明确 deadline 或阻塞别人），2 = 普通，1 = 可以先放着。
- due_at：只有原文出现明确日期/时间才填 ISO 8601（带时区，如 2026-11-05T18:00:00+08:00），否则 null。禁止推测。
  遇到「下周三」「月底」「三天后」这类相对时间，先根据「当前时间」确认今天是星期几，推算出具体日期再填；推不准就填 null。
- 候选条目不是必须使用。宁可返回空数组，也不要硬凑关联；只有主题、项目、人物、事件确实相通时才关联。
- key_points 和 next_actions 必须是原文支持的内容，不要编造数字、时间、人名。
- 保留原文中的英文术语和专有名词，不要翻译。`;

  const user = `当前时间：${nowText(input.now)}
${input.sourceUrl ? `用户附带的链接：${input.sourceUrl}\n` : ""}
原始记录：
"""
${input.content.slice(0, 8000)}
"""

候选的相关条目（可能为空，也可能都不相关）：
${candidates || "（无）"}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* ------------------------------------------------------------------ */
/*  2. 智能问答                                                        */
/* ------------------------------------------------------------------ */

export function buildChatMessages(input: {
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  entries: Entry[];
  now?: Date;
}): AiMessage[] {
  const context = input.entries.length
    ? input.entries.map((entry, i) => entryBlock(entry, i + 1)).join("\n\n")
    : "（资料库还是空的）";

  const system = `你是用户的私人信息管家，帮他回忆、串联、提炼自己记录过的内容。

工作方式：
1. 只依据下面「资料库」里的记录回答。资料库没有的，就直说「你的记录里没有相关信息」，并建议他补记什么，绝不编造。
2. 引用某条记录时，在句末标注编号，例如 [1]、[2][3]。编号必须对应资料库里真实存在的条目。
3. 回答用中文，先给结论，再给依据；能列清单就别写长段落。总长度控制在 350 字以内，除非用户要求展开。
4. 用户问「最近在忙什么」「有什么没做完」这类问题时，主动汇总时间线和未闭环的事项。
5. 不要提到"资料库""上下文""检索"这些系统词汇，直接像管家一样说话。

当前时间：${nowText(input.now)}

资料库（共 ${input.entries.length} 条）：
${context}`;

  const history = input.history.slice(-6).map<AiMessage>((m) => ({ role: m.role, content: m.content }));

  return [{ role: "system", content: system }, ...history, { role: "user", content: input.question }];
}

/* ------------------------------------------------------------------ */
/*  3. 阶段总结                                                        */
/* ------------------------------------------------------------------ */

export function buildReviewMessages(input: {
  entries: Entry[];
  periodLabel: string;
  openTasks: Entry[];
  now?: Date;
}): AiMessage[] {
  const blocks = input.entries.map((entry, i) => entryBlock(entry, i + 1, 700)).join("\n\n");
  const tasks = input.openTasks
    .slice(0, 30)
    .map((t) => `- ${t.title || t.content.slice(0, 40)}（${formatDate(t.created_at)}${t.due_at ? `，截止 ${formatDate(t.due_at)}` : ""}）`)
    .join("\n");

  const system = `你是用户的复盘教练，擅长从零散记录里看出模式、进展和卡点。

只输出一个 JSON 对象（不要 Markdown 代码块）：
{
  "title": "≤20 字，点出这段时间的主题，不要用『阶段总结』这种空话",
  "summary": "300-500 字。分 2-4 段，用 \\n\\n 分隔。第一段说这段时间的重心和进展；中间段落讲具体在做什么、有什么变化或反复出现的主题；最后一段指出卡点或值得注意的信号。要具体，引用事实和数字。",
  "themes": [{"name": "主题名 ≤8 字", "insight": "这个主题下的观察，1-2 句"}],
  "actions": [{"action": "具体可执行的下一步", "why": "为什么现在做这件事", "priority": 1}],
  "open_loops": ["还没闭环、悬而未决的事"]
}

要求：
- summary 里不要用「首先/其次/总之」这类套话，直接说事。
- themes 2-4 个，必须来自记录本身，不要凑数。
- actions 3-5 条，必须能在 1-7 天内动手，写清楚做什么、做到什么程度；priority 3 表示本周必须做。
- 记录少就诚实说少，不要放大意义。
- 不要编造记录里没有的项目名、数字、日期。`;

  const user = `时间范围：${input.periodLabel}
当前时间：${nowText(input.now)}
期间记录数：${input.entries.length}

记录：
${blocks || "（这段时间没有记录）"}

当前未完成待办：
${tasks || "（没有未完成待办）"}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* ------------------------------------------------------------------ */
/*  4. 待办整理                                                        */
/* ------------------------------------------------------------------ */

export function buildTaskPlanMessages(input: { tasks: Entry[]; now?: Date }): AiMessage[] {
  const list = input.tasks
    .map(
      (t, i) =>
        `${i + 1}. id=${t.id}｜${t.title || t.content.slice(0, 30)}｜建立 ${formatDate(t.created_at)}${
          t.due_at ? `｜截止 ${formatDate(t.due_at)}` : ""
        }｜优先级 ${t.priority}｜${t.summary ?? ""}`,
    )
    .join("\n");

  const system = `你是用户的执行助理。把散落的待办整理成一份今天就能用的清单。

只输出 JSON：
{
  "today": ["今天必须推进的，3 条以内"],
  "this_week": ["本周内完成的"],
  "later": ["可以排期到以后的"],
  "blocked": ["卡在别人或外部条件上的，写清楚卡在哪"],
  "drop_candidates": ["看起来已经没意义、建议删掉的，说明理由"],
  "note": "一句话提醒，比如最该先做哪件、哪里有重复"
}

规则：
- 合并重复或高度相似的待办，用「A / B」这种写法保留原意。
- 判断依据：有截止日期的优先，阻塞别人的优先，5 分钟能做完的优先。
- 不要新增原文没有的任务；可以拆分得太笼统的任务（如「做项目」）拆成具体动作。
- 数量克制：today ≤3，this_week ≤5。`;

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `当前时间：${nowText(input.now)}\n待办清单（共 ${input.tasks.length} 条）：\n${list || "（没有待办）"}`,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  5. 重点信息提取                                                    */
/* ------------------------------------------------------------------ */

export function buildExtractionMessages(input: { entry: Entry }): AiMessage[] {
  const system = `你负责从一条记录里抽取重点信息，供用户以后快速回顾。

只输出 JSON：
{
  "points": ["最重要的 3-6 条信息，每条一句话，保留关键数字和术语"],
  "decisions": ["已经做出的决定/结论，没有就空数组"],
  "people": ["提到的人名或角色，没有就空数组"],
  "dates": ["提到的时间点，原文写法优先，如『下周三』"]
}

只抽取原文存在的信息，不要推断、不要补充背景。`;

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `标题：${input.entry.title || "（无标题）"}\n类型：${KIND_META[input.entry.kind].label}\n正文：\n"""\n${input.entry.content.slice(
        0,
        8000,
      )}\n"""`,
    },
  ];
}
