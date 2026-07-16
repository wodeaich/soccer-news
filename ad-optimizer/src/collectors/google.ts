/**
 * 第二期：Google Ads 官方报表采集器（只读）。
 *
 * 鉴权：需要 developer token（需审核）+ OAuth2 refresh token。三家里申请最慢，尽早开始。
 * 取数：GoogleAdsService.SearchStream + GAQL 查询。
 *
 * TODO(阶段二)：GAQL 示例（按天 + 地区拆分）：
 *   SELECT campaign.id, campaign.name,
 *          metrics.cost_micros, metrics.impressions, metrics.clicks,
 *          metrics.conversions, metrics.conversions_value,
 *          segments.date, segments.geo_target_region
 *   FROM campaign
 *   WHERE segments.date BETWEEN '{since}' AND '{until}'
 *   注意：cost_micros ÷ 1e6 才是花费（统一单位）。
 */

import { AdMetricDaily, Level } from '../model/adMetric';

export interface GoogleCollectorConfig {
  customerId: string;
  developerToken: string;
  refreshToken: string;
  level: Level;
}

export async function collectGoogle(
  _config: GoogleCollectorConfig,
  _since: string,
  _until: string,
): Promise<AdMetricDaily[]> {
  throw new Error('Google Ads collector not implemented yet — 阶段二接入官方 API');
}
