/**
 * 第二期：TikTok for Business 官方报表采集器（只读）。
 *
 * 鉴权：TikTok for Business 开发者账号 → OAuth → access_token。
 * 取数：Reporting API（/report/integrated/get/），data_level=AUCTION_CAMPAIGN，
 *        按天 dimensions=['campaign_id','stat_time_day']，可加 region 维度。
 *
 * TODO(阶段二)：填入真实调用，metrics=spend,impressions,clicks,conversion,total_...
 *        逐行翻译成 AdMetricDaily。
 */

import { AdMetricDaily, Level } from '../model/adMetric';

export interface TikTokCollectorConfig {
  advertiserId: string;
  accessToken: string;
  level: Level;
}

export async function collectTikTok(
  _config: TikTokCollectorConfig,
  _since: string,
  _until: string,
): Promise<AdMetricDaily[]> {
  throw new Error('TikTok collector not implemented yet — 阶段二接入官方 API');
}
