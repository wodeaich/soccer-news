import mongoose from 'mongoose';
import { config, randomDelay } from './config';
import { getGoogleSuggestions } from './keywords/googleSuggest';
import { scrapeRedditPainPoints } from './scrapers/reddit';
import { scrapeQuoraPainPoints } from './scrapers/quora';
import { launchBrowser } from './utils/browser';
import { saveToDatabase } from './db/save';
import { ScrapedItem } from './scrapers/types';

/**
 * Pipeline: 种子词 -> Google 联想词拓展 -> Reddit / Quora 抓取 -> 清洗入库。
 * v1 为串行执行，保证不触发各平台频控；
 * 后续量级上来后可将每个 keyword 投递为 BullMQ 任务做并发控制。
 */
async function main() {
  console.log('[pipeline] connecting to MongoDB...');
  await mongoose.connect(config.mongoUri);

  console.log(`[pipeline] expanding ${config.seedKeywords.length} seed keyword(s) via Google Suggest...`);
  // keyword -> 它来自哪个种子词（溯源，最终会同步到 Google Sheet 的"初始关键词"列）
  const seedOf = new Map<string, string>(config.seedKeywords.map((s) => [s, s]));
  for (const seed of config.seedKeywords) {
    const suggestions = await getGoogleSuggestions(seed);
    console.log(`[pipeline] "${seed}" -> ${suggestions.length} suggestions`);
    for (const s of suggestions.slice(0, config.maxSuggestionsPerSeed)) {
      if (!seedOf.has(s)) seedOf.set(s, seed);
    }
  }
  const keywords = Array.from(seedOf.keys());
  console.log(`[pipeline] total ${keywords.length} keywords to scrape`);

  const browser = await launchBrowser();
  let totalSaved = 0;

  try {
    for (const keyword of keywords) {
      const items: ScrapedItem[] = [];

      items.push(...(await scrapeRedditPainPoints(keyword)));
      items.push(...(await scrapeQuoraPainPoints(browser, keyword)));
      items.forEach((it) => (it.seed_keyword = seedOf.get(keyword) ?? keyword));

      const { saved, skipped } = await saveToDatabase(items);
      totalSaved += saved;
      console.log(`[pipeline] "${keyword}": saved=${saved} skipped=${skipped}`);

      await randomDelay(2000, 5000);
    }
  } finally {
    await browser.close();
    await mongoose.disconnect();
  }

  console.log(`[pipeline] done. total saved/upserted: ${totalSaved}`);
}

main().catch((err) => {
  console.error('[pipeline] fatal:', err);
  process.exit(1);
});
