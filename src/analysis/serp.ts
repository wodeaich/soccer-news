import axios from 'axios';
import { config, randomDelay } from '../config';

/**
 * 排名速度分（rank_speed_score，0-10）：评估"新站多快能把这个词做上排名"。
 *
 * 数据来源 Serper.dev（google.serper.dev/search）。三级降级链保证管线不断：
 *   1. MOCK_SERP=true        -> 确定性规则（模拟测试 / CI）
 *   2. 有 SERPER_API_KEY     -> 真实 SERP 实测（KGR + 弱主域 + 巨头封锁）
 *   3. 无 Key / 调用失败      -> 仅用免费信号（词长 + 疑问句式）归一化兜底
 */

export interface SerpSignals {
  /** allintitle:"keyword" 的结果总数（标题精确包含该词的页面数，KGR 核心） */
  allintitleCount: number;
  /** 前 10 名里弱主域（Reddit/Quora/论坛）数量——论坛能排进前 10 = 竞争弱 */
  weakDomainCount: number;
  /** 前 10 名里高权重巨头域名数量——越多越难做 */
  bigDomainCount: number;
}

export interface RankSpeed {
  score: number; // 0-10
  /** 巨头封锁（前 10 被高权重域名占 8 席以上），新站建议直接放弃该词 */
  excluded: boolean;
  signals: SerpSignals | null; // null = 降级为免费信号模式
}

const WEAK_DOMAINS = ['reddit.com', 'quora.com', 'forum', 'community.', 'answers.', 'stackexchange.com', 'tripadvisor.com'];

/** 保险/通用高权重域名（DR90+ 量级），可按行业扩充 */
const BIG_DOMAINS = [
  'aarp.org', 'nerdwallet.com', 'forbes.com', 'investopedia.com', 'bankrate.com', 'usnews.com',
  'cnbc.com', 'wikipedia.org', 'aetna.com', 'cigna.com', 'mutualofomaha.com', 'aflac.com',
  'statefarm.com', 'progressive.com', 'medicare.gov', '.gov',
];

const QUESTION_WORDS = ['how', 'why', 'what', 'can', 'should', 'does', 'is', 'do', 'when', 'which'];

async function serperSearch(q: string): Promise<{ organic: Array<{ link: string }>; totalResults: number }> {
  const response = await axios.post(
    'https://google.serper.dev/search',
    { q, gl: 'us', hl: 'en', num: 10 },
    { headers: { 'X-API-KEY': config.serperApiKey, 'Content-Type': 'application/json' }, timeout: 20_000 },
  );
  const organic = response.data?.organic ?? [];
  // Serper 部分响应不带 totalResults，此时用返回条数兜底：
  // allintitle 查询若连 10 条都凑不齐，本身就说明竞争极弱
  const totalResults = Number(response.data?.searchInformation?.totalResults ?? organic.length);
  return { organic, totalResults };
}

async function fetchSerpSignals(keyword: string): Promise<SerpSignals> {
  const [main, intitle] = [await serperSearch(keyword), await serperSearch(`allintitle:"${keyword}"`)];

  const domains = main.organic.map((r) => {
    try {
      return new URL(r.link).hostname.toLowerCase();
    } catch {
      return '';
    }
  });

  return {
    allintitleCount: intitle.totalResults,
    weakDomainCount: domains.filter((d) => WEAK_DOMAINS.some((w) => d.includes(w))).length,
    bigDomainCount: domains.filter((d) => BIG_DOMAINS.some((b) => d.includes(b))).length,
  };
}

/** mock：长尾疑问词 = 弱竞争，短头部词 = 巨头封锁，规则确定可断言 */
function mockSerpSignals(keyword: string): SerpSignals {
  const words = keyword.trim().split(/\s+/);
  const isQuestion = QUESTION_WORDS.includes(words[0]?.toLowerCase());
  return {
    allintitleCount: words.length >= 5 ? 8 : 50_000,
    weakDomainCount: isQuestion ? 4 : words.length >= 5 ? 2 : 0,
    bigDomainCount: words.length <= 2 ? 9 : 2,
  };
}

/** 免费信号（无 SERP 数据也能算，0-3 分）：词长 + 疑问句式 + Reddit 反推 */
export function freeSignalScore(
  keyword: string,
  redditStats?: { postCount: number; totalComments: number },
): number {
  const words = keyword.trim().split(/\s+/);
  let score = 0;
  if (words.length >= 5) score += 1;
  else if (words.length >= 4) score += 0.5;
  if (QUESTION_WORDS.includes(words[0]?.toLowerCase())) score += 1;
  // Reddit 反推：讨论多（平均每帖评论 >= 10 且多帖出现）= 大家反复问、没有公认答案
  // = 现有搜索结果没解决问题，Google 正缺好内容
  if (redditStats && redditStats.postCount >= 2 && redditStats.totalComments / redditStats.postCount >= 10) {
    score += 1;
  }
  return score;
}

/** 纯函数打分，便于单测：signals 为 null 时降级为免费信号归一化 */
export function computeRankSpeed(
  keyword: string,
  signals: SerpSignals | null,
  redditStats?: { postCount: number; totalComments: number },
): RankSpeed {
  const free = freeSignalScore(keyword, redditStats); // 0-3

  if (!signals) {
    return { score: Number(((free / 3) * 10).toFixed(2)), excluded: false, signals: null };
  }

  // KGR 档位：allintitle 结果越少越容易排，0-3 分
  let kgr = 0;
  if (signals.allintitleCount < 10) kgr = 3;
  else if (signals.allintitleCount < 100) kgr = 2;
  else if (signals.allintitleCount < 1000) kgr = 1;

  // 弱主域：论坛占前 10 的席位数，0-2 分
  const weak = signals.weakDomainCount >= 3 ? 2 : signals.weakDomainCount >= 1 ? 1 : 0;

  // 巨头封锁：占 8 席以上直接剔除；否则按占比反向给 0-2 分
  const excluded = signals.bigDomainCount >= 8;
  const blockade = Math.max(0, 2 - (signals.bigDomainCount / 10) * 2.5);

  const score = Math.min(10, free + kgr + weak + blockade);
  return { score: Number(score.toFixed(2)), excluded, signals };
}

/** 批量获取（含降级链）。返回 Map<keyword, RankSpeed> */
export async function getRankSpeedScores(
  candidates: Array<{ keyword: string; postCount: number; totalComments: number }>,
): Promise<Map<string, RankSpeed>> {
  const result = new Map<string, RankSpeed>();

  for (const c of candidates) {
    const redditStats = { postCount: c.postCount, totalComments: c.totalComments };

    if (config.mockSerp) {
      result.set(c.keyword, computeRankSpeed(c.keyword, mockSerpSignals(c.keyword), redditStats));
      continue;
    }
    if (!config.serperApiKey) {
      result.set(c.keyword, computeRankSpeed(c.keyword, null, redditStats));
      continue;
    }
    try {
      result.set(c.keyword, computeRankSpeed(c.keyword, await fetchSerpSignals(c.keyword), redditStats));
    } catch (error) {
      console.error(`[serp] failed for "${c.keyword}", degrading to free signals:`, (error as Error).message);
      result.set(c.keyword, computeRankSpeed(c.keyword, null, redditStats));
    }
    await randomDelay(300, 800); // Serper 官方限速内的礼貌间隔
  }

  if (!config.mockSerp && !config.serperApiKey) {
    console.warn('[serp] SERPER_API_KEY not set — rank speed degraded to free signals only');
  }
  return result;
}
