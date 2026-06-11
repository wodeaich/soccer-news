import dotenv from 'dotenv';

dotenv.config();

function csv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  /** MongoDB 连接串，生产环境必须通过环境变量注入 */
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/app_factory_seo',

  /** 种子关键词，逗号分隔，例如 "photo blur how to,remove background" */
  seedKeywords: csv(process.env.SEED_KEYWORDS, ['photo blur how to']),

  /** 要搜索的 subreddit 列表，逗号分隔 */
  subreddits: csv(process.env.SUBREDDITS, ['iphone', 'photography']),

  /** 每个关键词在每个来源最多深入抓取的帖子数 */
  maxPostsPerKeyword: Number(process.env.MAX_POSTS_PER_KEYWORD ?? 5),

  /** 每个种子词最多取多少个 Google 联想词参与抓取（防止任务爆炸） */
  maxSuggestionsPerSeed: Number(process.env.MAX_SUGGESTIONS_PER_SEED ?? 20),

  /** 可选：HTTP 代理，形如 http://user:pass@host:port，留空则直连 */
  proxyUrl: process.env.PROXY_URL ?? '',

  /** 清洗后文本最短长度，低于此值视为垃圾数据丢弃 */
  minContentLength: Number(process.env.MIN_CONTENT_LENGTH ?? 50),
};

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
