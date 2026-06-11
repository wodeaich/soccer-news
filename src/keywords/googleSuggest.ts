import axios from 'axios';
import { randomDelay } from '../config';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * 字母树旋转（Alphabet Soup）：seed + a~z 逐个请求 Google 联想词接口，
 * 拓展出数百个真实用户长尾搜索词。接口免费、无验证码。
 * 注意：必须用 https，单次失败重试 2 次，请求间随机延迟防频控。
 */
export async function getGoogleSuggestions(seedKeyword: string): Promise<string[]> {
  const suggestions = new Set<string>();
  const alphabets = ['', ...'abcdefghijklmnopqrstuvwxyz'.split('')];

  for (const letter of alphabets) {
    const query = encodeURIComponent(`${seedKeyword} ${letter}`.trim());
    const url = `https://suggestqueries.google.com/complete/search?client=chrome&hl=en&q=${query}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await axios.get(url, {
          headers: { 'User-Agent': UA },
          timeout: 10_000,
        });
        // 返回格式: [query, [suggestion1, suggestion2, ...], ...]
        const results: unknown = response.data?.[1];
        if (Array.isArray(results)) {
          for (const s of results) {
            if (typeof s === 'string' && s.trim()) suggestions.add(s.trim().toLowerCase());
          }
        }
        break;
      } catch (error) {
        if (attempt === 3) {
          console.error(`[suggest] fetch failed for "${seedKeyword} ${letter}":`, (error as Error).message);
        } else {
          await randomDelay(1000 * attempt, 2000 * attempt);
        }
      }
    }

    await randomDelay(500, 1000);
  }

  return Array.from(suggestions);
}
