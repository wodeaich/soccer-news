import * as cheerio from 'cheerio';
import type { Browser } from 'puppeteer';
import { config, randomDelay } from '../config';
import { newPage, autoScroll } from '../utils/browser';
import { ScrapedItem } from './types';

/**
 * Quora 抓取策略（绕过登录墙）：
 * 1. 不直接搜 Quora 站内 —— 用 DuckDuckGo HTML 版搜 site:quora.com "keyword"
 *    （比 Google SERP 更不容易触发验证码，且 HTML 结构简单稳定）。
 * 2. 拿到问题页 URL 后，用 Stealth Puppeteer 打开并模拟滚动加载回答。
 */

async function findQuoraUrls(browser: Browser, keyword: string): Promise<Array<{ title: string; url: string }>> {
  const page = await newPage(browser);
  const q = encodeURIComponent(`site:quora.com ${keyword}`);
  const results: Array<{ title: string; url: string }> = [];

  try {
    await page.goto(`https://html.duckduckgo.com/html/?q=${q}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const $ = cheerio.load(await page.content());

    $('a.result__a').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const title = $(el).text().trim();
      // DDG 的链接是跳转 URL，从 uddg 参数里解出真实地址
      const match = href.match(/uddg=([^&]+)/);
      const real = match ? decodeURIComponent(match[1]) : href;
      if (real.includes('quora.com') && title) {
        results.push({ title, url: real });
      }
    });
  } catch (error) {
    console.error(`[quora] search failed for "${keyword}":`, (error as Error).message);
  } finally {
    await page.close();
  }

  return results.slice(0, config.maxPostsPerKeyword);
}

export async function scrapeQuoraPainPoints(browser: Browser, keyword: string): Promise<ScrapedItem[]> {
  const questions = await findQuoraUrls(browser, keyword);
  console.log(`[quora] "${keyword}" -> ${questions.length} questions`);

  const scraped: ScrapedItem[] = [];

  for (const question of questions) {
    const page = await newPage(browser);
    try {
      await page.goto(question.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await autoScroll(page, 5);

      const $ = cheerio.load(await page.content());
      // Quora 回答正文容器（class 名会变，q-text 是长期相对稳定的语义类）
      const answers: string[] = [];
      $('div.q-text span.q-box, div.spacing_log_answer_content').each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 80) answers.push(text);
      });

      scraped.push({
        keyword,
        title: question.title,
        source: 'Quora',
        url: question.url,
        raw_text: `${question.title}\n${answers.slice(0, 3).join('\n')}`,
        scraped_at: new Date(),
        upvotes: 0,
        comments: answers.length,
        community: 'quora.com',
      });
    } catch (error) {
      console.error(`[quora] scrape failed for ${question.url}:`, (error as Error).message);
    } finally {
      await page.close();
      await randomDelay(1500, 3500);
    }
  }

  return scraped;
}
