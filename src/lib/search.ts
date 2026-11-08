const STOPWORDS = new Set([
  "我",
  "你",
  "他",
  "她",
  "它",
  "我们",
  "你们",
  "他们",
  "的",
  "了",
  "着",
  "过",
  "是",
  "在",
  "和",
  "与",
  "或",
  "有",
  "没有",
  "什么",
  "怎么",
  "如何",
  "哪些",
  "哪个",
  "为什么",
  "多少",
  "最近",
  "之前",
  "以前",
  "现在",
  "然后",
  "还有",
  "一下",
  "帮我",
  "告诉",
  "这个",
  "那个",
  "这些",
  "那些",
  "关于",
  "以及",
  "但是",
  "而且",
  "the",
  "a",
  "an",
  "of",
  "to",
  "and",
  "is",
  "are",
  "what",
  "how",
]);

/**
 * 把用户的一句话拆成检索词。
 * 没有向量库的情况下，用「英文按词 + 中文按 2-3 字滑窗」来提升中文 ILIKE 命中率。
 */
export function extractTerms(input: string, limit = 16): string[] {
  const normalized = input
    .replace(/[，。！？、；：""''（）【】《》,.!?;:"'()[\]<>/\\|~`@#$%^&*+=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return [];

  const terms = new Set<string>();

  for (const token of normalized.split(" ")) {
    const word = token.trim();
    if (!word) continue;
    if (word.length < 2 && !/[\u4e00-\u9fa5]/.test(word)) continue;
    if (STOPWORDS.has(word.toLowerCase())) continue;

    // 纯中文长句：滑窗切词（pg_trgm 的 ILIKE 需要连续子串）
    if (/^[\u4e00-\u9fa5]+$/.test(word) && word.length > 4) {
      for (let i = 0; i + 3 <= word.length && terms.size < limit; i += 2) {
        const gram = word.slice(i, i + 3);
        if (!STOPWORDS.has(gram)) terms.add(gram);
      }
      continue;
    }

    terms.add(word.slice(0, 40));
    if (terms.size >= limit) break;
  }

  return [...terms].slice(0, limit);
}

/** 从正文里猜测可能的时间表达，用于前端展示（不参与判断） */
export function extractHashtags(text: string): string[] {
  const matches = text.match(/#([^\s#，。,.!?！？、；;：:]{1,16})/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1)))].slice(0, 8);
}
