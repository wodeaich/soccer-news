import axios from 'axios';
import { config, randomDelay } from '../config';
import { ScrapedItem } from './types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Reddit 抓取双模式：
 *
 * 1. OAuth 模式（推荐）：配置 REDDIT_CLIENT_ID/SECRET 后，用 client_credentials
 *    换取 token 走 oauth.reddit.com —— 100 req/min，数据中心 IP（GitHub Actions）不封。
 * 2. 匿名回退：未配置凭据时走公开 JSON 端点（URL 加 .json）。注意 Reddit 已开始
 *    封锁数据中心 IP（403），匿名模式只适合本地/住宅网络跑。
 *
 * （历史审查结论保留：不要用 Puppeteer+cheerio 抓新版 reddit.com，
 *   其前端是 Shadow DOM，page.content() 拿不到正文和评论。）
 */

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getRedditToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const res = await axios.post(
    'https://www.reddit.com/api/v1/access_token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      auth: { username: config.redditClientId, password: config.redditClientSecret },
      headers: { 'User-Agent': config.redditUserAgent },
      timeout: 15_000,
    },
  );
  // 提前 60s 过期，避免边界上用到失效 token
  cachedToken = { value: res.data.access_token, expiresAt: Date.now() + (res.data.expires_in - 60) * 1000 };
  console.log('[reddit] OAuth token acquired');
  return cachedToken.value;
}

const useOAuth = () => Boolean(config.redditClientId && config.redditClientSecret);

/** 统一请求入口：path 不带 .json 后缀，匿名模式自动补上 */
async function redditGet(path: string, query: string): Promise<any> {
  if (useOAuth()) {
    const token = await getRedditToken();
    const res = await axios.get(`https://oauth.reddit.com${path}?${query}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': config.redditUserAgent },
      timeout: 15_000,
    });
    return res.data;
  }
  const res = await axios.get(`https://www.reddit.com${path}.json?${query}`, {
    headers: { 'User-Agent': UA },
    timeout: 15_000,
  });
  return res.data;
}

interface RedditSearchChild {
  data: {
    title: string;
    permalink: string;
    selftext: string;
    score: number;
    num_comments: number;
    subreddit: string;
  };
}

export async function scrapeRedditPainPoints(keyword: string): Promise<ScrapedItem[]> {
  const scraped: ScrapedItem[] = [];

  for (const subreddit of config.subreddits) {
    let children: RedditSearchChild[] = [];
    try {
      const data = await redditGet(
        `/r/${subreddit}/search`,
        `q=${encodeURIComponent(keyword)}&restrict_sr=1&sort=relevance&limit=${config.maxPostsPerKeyword}`,
      );
      children = data?.data?.children ?? [];
    } catch (error) {
      console.error(`[reddit] search failed for r/${subreddit} "${keyword}":`, (error as Error).message);
      continue;
    }

    console.log(`[reddit] r/${subreddit} "${keyword}" -> ${children.length} posts`);

    for (const child of children) {
      const { title, permalink, selftext, score, num_comments } = child.data;
      const postUrl = `https://www.reddit.com${permalink}`;

      // 深入帖子页 JSON，提取前 3 条高赞评论
      const topComments: string[] = [];
      try {
        const data = await redditGet(permalink.replace(/\/$/, ''), 'sort=top&limit=5');
        const comments = data?.[1]?.data?.children ?? [];
        for (const c of comments.slice(0, 3)) {
          const body: string | undefined = c?.data?.body;
          if (body && c?.data?.author !== 'AutoModerator') topComments.push(body);
        }
      } catch {
        // 评论抓取失败不影响主体入库
      }

      scraped.push({
        keyword,
        title,
        source: 'Reddit',
        url: postUrl,
        raw_text: `${title}\n${selftext}\n${topComments.join('\n')}`,
        scraped_at: new Date(),
        upvotes: score ?? 0,
        comments: num_comments ?? 0,
        community: `r/${child.data.subreddit ?? subreddit}`,
      });

      // OAuth 100 req/min 限额下可以更快；匿名模式保持保守延迟
      await (useOAuth() ? randomDelay(600, 1200) : randomDelay(1000, 3000));
    }
  }

  return scraped;
}
