/**
 * 第一层：纯数据量化打分（不消耗 LLM Token）。
 * 1. 关键词归一化 + Jaccard 聚类，把"life insurance for seniors over 70"
 *    和"senior life insurance age 70"这类同义长尾词合并成一个痛点簇。
 * 2. 按簇聚合 Reddit 信号，计算热度分。
 */

export interface SourcePost {
  keyword: string;
  seed_keyword: string;
  title: string;
  url: string;
  cleaned_content: string;
  upvotes: number;
  comments: number;
  community: string;
}

export interface KeywordCluster {
  /** 代表关键词（簇内关联帖子最多的那个） */
  keyword: string;
  /** 簇内合并掉的其他关键词 */
  variants: string[];
  /** 簇内帖子来自哪些初始种子词（溯源） */
  seedKeywords: string[];
  postCount: number;
  totalUpvotes: number;
  totalComments: number;
  communityCount: number;
  heatScore: number;
  /** 赞数最高的代表性帖子（喂给 LLM 的用户原话） */
  topPosts: SourcePost[];
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'of', 'to', 'in', 'on', 'at', 'over', 'with', 'and', 'or', 'is', 'are', 'my', 'your',
]);

/** 归一化为词元集合：小写、去停用词、朴素去复数 */
export function tokenize(keyword: string): Set<string> {
  const tokens = keyword
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
  return new Set(tokens);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * 热度分：取对数防止单个爆款帖碾压持续出现的真痛点。
 * 评论权重高于赞 —— 评论多说明问题有争论、没有公认解法。
 * 跨社区出现权重最高 —— 多个社区都在讨论 = 普遍痛点而非小圈子话题。
 */
export function heatScore(c: Pick<KeywordCluster, 'postCount' | 'totalUpvotes' | 'totalComments' | 'communityCount'>): number {
  return (
    Math.log1p(c.postCount) * 2 +
    Math.log1p(c.totalUpvotes) +
    Math.log1p(c.totalComments) * 1.5 +
    c.communityCount * 3
  );
}

/** 贪心聚类：Jaccard >= threshold 的关键词并入同一簇 */
export function clusterKeywords(posts: SourcePost[], threshold = 0.7): KeywordCluster[] {
  // 按关键词分组
  const byKeyword = new Map<string, SourcePost[]>();
  for (const post of posts) {
    const list = byKeyword.get(post.keyword) ?? [];
    list.push(post);
    byKeyword.set(post.keyword, list);
  }

  // 帖子多的关键词优先当簇心
  const keywords = Array.from(byKeyword.keys()).sort(
    (a, b) => byKeyword.get(b)!.length - byKeyword.get(a)!.length,
  );

  const clusters: Array<{ center: string; tokens: Set<string>; members: string[] }> = [];
  for (const kw of keywords) {
    const tokens = tokenize(kw);
    const hit = clusters.find((c) => jaccard(c.tokens, tokens) >= threshold);
    if (hit) {
      hit.members.push(kw);
    } else {
      clusters.push({ center: kw, tokens, members: [kw] });
    }
  }

  return clusters.map(({ center, members }) => {
    const clusterPosts = members.flatMap((kw) => byKeyword.get(kw)!);
    // 同一帖子可能被多个关键词命中，按 URL 去重
    const unique = Array.from(new Map(clusterPosts.map((p) => [p.url, p])).values());

    const stats = {
      postCount: unique.length,
      totalUpvotes: unique.reduce((s, p) => s + p.upvotes, 0),
      totalComments: unique.reduce((s, p) => s + p.comments, 0),
      communityCount: new Set(unique.map((p) => p.community)).size,
    };

    return {
      keyword: center,
      variants: members.filter((m) => m !== center),
      seedKeywords: Array.from(new Set(unique.map((p) => p.seed_keyword).filter(Boolean))),
      ...stats,
      heatScore: heatScore(stats),
      topPosts: [...unique].sort((a, b) => b.upvotes - a.upvotes).slice(0, 3),
    };
  });
}
