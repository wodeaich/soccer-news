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
  const keywordSet = new Set<string>(config.seedKeywords);
  for (const seed of config.seedKeywords) {
    const suggestions = await getGoogleSuggestions(seed);
    console.log(`[pipeline] "${seed}" -> ${suggestions.length} suggestions`);
    suggestions.slice(0, config.maxSuggestionsPerSeed).forEach((s) => keywordSet.add(s));
  }
  const keywords = Array.from(keywordSet);
  console.log(`[pipeline] total ${keywords.length} keywords to scrape`);

  const browser = await launchBrowser();
  let totalSaved = 0;

  try {
    for (const keyword of keywords) {
      const items: ScrapedItem[] = [];

      items.push(...(await scrapeRedditPainPoints(keyword)));
      items.push(...(await scrapeQuoraPainPoints(browser, keyword)));

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
