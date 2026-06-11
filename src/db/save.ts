import { config } from '../config';
import { cleanRawText } from '../utils/clean';
import { ScrapedItem } from '../scrapers/types';
import { PainPointModel } from './painPoint.model';

/**
 * 清洗 + 入库。用 upsert（按 url 唯一键）代替 create + 吞异常：
 * 重复 URL 自然幂等，不会因为 E11000 异常掩盖其他真实错误。
 */
export async function saveToDatabase(items: ScrapedItem[]): Promise<{ saved: number; skipped: number }> {
  let saved = 0;
  let skipped = 0;

  for (const item of items) {
    const cleaned = cleanRawText(item.raw_text);
    // 清洗后过短说明是无意义内容或已删帖，丢弃
    if (cleaned.length < config.minContentLength) {
      skipped++;
      continue;
    }

    await PainPointModel.updateOne(
      { url: item.url },
      {
        $setOnInsert: {
          keyword: item.keyword,
          seed_keyword: item.seed_keyword ?? item.keyword,
          title: item.title,
          source: item.source,
          url: item.url,
          cleaned_content: cleaned,
          upvotes: item.upvotes,
          comments: item.comments,
          community: item.community,
          is_processed: false,
          scraped_at: item.scraped_at,
        },
      },
      { upsert: true },
    );
    saved++;
  }

  return { saved, skipped };
}
