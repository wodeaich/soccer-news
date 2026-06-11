import axios from 'axios';
import { config, randomDelay } from '../config';
import { ScrapedItem } from './types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Reddit 抓取方案说明（审查后的重要修正）：
 *
 * 新版 www.reddit.com 前端是 Web Components + Shadow DOM，
 * page.content() 拿到的 HTML 里根本没有帖子正文和评论，
 * cheerio 选择器（如 div[slot="text-body"]）大概率取不到数据。
 *
 * 更稳定的做法是直接使用 Reddit 的公开 JSON 端点（任意页面加 .json 后缀），
 * 返回结构化数据，无需 Puppeteer 渲染，速度快 10 倍以上且不依赖 DOM 结构。
 * 注意：未登录调用有约 10 req/min 的频控，必须配合随机延迟。
 * 商用/大规模场景请改用 Reddit 官方 OAuth API（见 README）。
 */

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
    const searchUrl = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(
      keyword,
    )}&restrict_sr=1&sort=relevance&limit=${config.maxPostsPerKeyword}`;

    let children: RedditSearchChild[] = [];
    try {
      const res = await axios.get(searchUrl, { headers: { 'User-Agent': UA }, timeout: 15_000 });
      children = res.data?.data?.children ?? [];
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
        const res = await axios.get(`${postUrl.replace(/\/$/, '')}.json?sort=top&limit=5`, {
          headers: { 'User-Agent': UA },
          timeout: 15_000,
        });
        const comments = res.data?.[1]?.data?.children ?? [];
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

      await randomDelay(1000, 3000);
    }
  }

  return scraped;
}
