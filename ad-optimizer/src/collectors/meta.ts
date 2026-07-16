/**
 * 第二期：Meta (Facebook) 官方只读报表采集器。
 *
 * ★防封原则（对应需求1）：
 *   - 只调只读接口 GET /{ad-account-id}/insights，绝不做网页 UI 自动化/爬取。
 *   - 用【商务管理平台 System User Token】（机器专用、不绑个人账号、长期有效）。
 *   - 只申请 `ads_read` 只读权限；固定服务器 IP；限速 + 每天定时拉 1~2 次。
 *   - 禁止在广告后台使用 puppeteer/stealth 之类的自动化——那是封号高危操作。
 *
 * TODO(阶段二)：填入真实 API 调用。参数：
 *   level=campaign|adset|ad、time_increment=1(按天)、breakdowns=region 等、
 *   fields=spend,impressions,clicks,actions,action_values。
 */

import { AdMetricDaily, Level } from '../model/adMetric';

export interface MetaCollectorConfig {
  adAccountId: string;
  systemUserToken: string; // 来自商务管理平台，非个人 token
  level: Level;
  breakdowns?: string[]; // 如 ['region']
}

export async function collectMeta(
  _config: MetaCollectorConfig,
  _since: string,
  _until: string,
): Promise<AdMetricDaily[]> {
  // TODO: axios GET https://graph.facebook.com/v20.0/{adAccountId}/insights
  //       ?time_increment=1&level=..&breakdowns=..&fields=..&access_token=systemUserToken
  //       然后逐行翻译成 AdMetricDaily（deriveMetrics 补派生指标）。
  throw new Error('Meta collector not implemented yet — 阶段二接入官方只读 API');
}
