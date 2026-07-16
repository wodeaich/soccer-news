/**
 * 统一数据模型：把三家平台（Meta / Google / TikTok）的报表数据都翻译成同一张表。
 * 一条 = 某天、某个层级对象、某个拆分维度下的一份指标快照。
 * 后续的对比、波动、图表全部只基于这个模型，无需关心平台差异。
 */

export type Platform = 'meta' | 'google' | 'tiktok';

/** 颗粒度 / 层级：和在跑广告的结构对齐 */
export type Level = 'account' | 'campaign' | 'adset' | 'ad';

/** 可选拆分维度（"同一个区域"靠 region） */
export interface Breakdown {
  region?: string; // 地区
  country?: string;
  placement?: string; // 版位
  age?: string;
  gender?: string;
}

export interface AdMetricDaily {
  platform: Platform;
  accountId: string;
  campaignId: string;
  campaignName: string;
  adsetId?: string;
  adId?: string;
  level: Level;
  date: string; // YYYY-MM-DD，一天一条
  breakdown?: Breakdown;

  // 原始指标（各平台采集器负责统一单位，如 Google cost_micros ÷ 1e6）
  spend: number; // 花费
  impressions: number; // 展示
  clicks: number; // 点击
  conversions: number; // 转化
  revenue: number; // 转化价值

  // 派生指标（存下来省得每次算）
  cpm: number; // 千次展示成本 = spend / impressions * 1000
  ctr: number; // 点击率     = clicks / impressions
  cpc: number; // 单次点击成本 = spend / clicks
  cpa: number; // 单次转化成本 = spend / conversions
  roas: number; // 花费回报    = revenue / spend
}

/** 由原始指标计算派生指标，避免除零 */
export function deriveMetrics(
  raw: Pick<AdMetricDaily, 'spend' | 'impressions' | 'clicks' | 'conversions' | 'revenue'>,
): Pick<AdMetricDaily, 'cpm' | 'ctr' | 'cpc' | 'cpa' | 'roas'> {
  const { spend, impressions, clicks, conversions, revenue } = raw;
  const safe = (n: number, d: number) => (d > 0 ? n / d : 0);
  return {
    cpm: safe(spend * 1000, impressions),
    ctr: safe(clicks, impressions),
    cpc: safe(spend, clicks),
    cpa: safe(spend, conversions),
    roas: safe(revenue, spend),
  };
}
