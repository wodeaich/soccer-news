/**
 * 第一期：CSV 导入器（不依赖 API 令牌，立刻可用）。
 * 把各平台后台"导出的报表 CSV"识别并翻译成统一模型 AdMetricDaily。
 *
 * 用别名匹配（大小写/中英文容错），适配 Meta / Google / TikTok 的常见导出列名。
 * 拿到你的真实样例后，把对应列名补进下面的 ALIASES 即可（现有默认已覆盖多数情况）。
 */

import { AdMetricDaily, deriveMetrics, Platform } from '../model/adMetric';
import { parseCsv } from './parseCsv';

/** 统一字段 → 可能的列名别名（全部小写比较，去空格/标点后匹配） */
const ALIASES: Record<string, string[]> = {
  campaignName: ['campaign name', 'campaign', 'campaign_name', '广告系列名称', '广告系列', '广告活动'],
  date: ['day', 'date', 'by day', 'reporting starts', 'stat_time_day', '日期', '时间'],
  region: ['region', 'geo', 'region name', 'dma region', 'geo_target_region', '地区', '地域', '省份'],
  spend: ['amount spent', 'amount spent (usd)', 'cost', 'spend', '花费', '消耗', '成本'],
  impressions: ['impressions', 'impr', 'impr.', '展示量', '展示', '曝光量', '曝光'],
  clicks: ['clicks', 'link clicks', 'clicks (all)', 'clicks (destination)', '点击量', '点击次数', '点击'],
  conversions: ['results', 'conversions', 'conversion', 'conv', '转化数', '转化量', '转化'],
  revenue: ['conv. value', 'conversion value', 'total complete payment', 'purchase conversion value', '转化价值', '收入'],
};

const norm = (s: string) => s.toLowerCase().replace(/[().,_\s%]/g, '').replace(/usd|cny|rmb/g, '').trim();

/** 为一份 CSV 的表头，建立 “统一字段 -> 实际列名” 的映射 */
function resolveColumns(headers: string[]): Partial<Record<string, string>> {
  const normHeaders = headers.map((h) => ({ raw: h, n: norm(h) }));
  const map: Partial<Record<string, string>> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const normAliases = aliases.map(norm);
    const hit = normHeaders.find((h) => normAliases.some((a) => h.n === a || h.n.includes(a)));
    if (hit) map[field] = hit.raw;
  }
  return map;
}

/** 从表头启发式判断平台（也可由调用方显式指定） */
export function detectPlatform(headers: string[]): Platform {
  const joined = headers.map(norm).join('|');
  if (joined.includes('amountspent')) return 'meta';
  if (joined.includes('totalcompletepayment') || joined.includes('byday')) return 'tiktok';
  return 'google'; // 兜底：Google 导出多为 Cost/Conv. value 等通用列名
}

const NUMERIC = new Set(['spend', 'impressions', 'clicks', 'conversions', 'revenue']);

function toNumber(v: string): number {
  const n = parseFloat((v || '').replace(/[,¥$￥%\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 规范化日期为 YYYY-MM-DD */
function normDate(v: string): string {
  const t = (v || '').trim();
  const m = t.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return t;
}

/** 解析一份 CSV 文本 → AdMetricDaily[]（platform 可显式传，否则自动识别） */
export function importCsv(text: string, platform?: Platform): AdMetricDaily[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const cols = resolveColumns(headers);
  const plat = platform ?? detectPlatform(headers);

  return rows.map((row) => {
    const raw = {
      spend: cols.spend ? toNumber(row[cols.spend]) : 0,
      impressions: cols.impressions ? toNumber(row[cols.impressions]) : 0,
      clicks: cols.clicks ? toNumber(row[cols.clicks]) : 0,
      conversions: cols.conversions ? toNumber(row[cols.conversions]) : 0,
      revenue: cols.revenue ? toNumber(row[cols.revenue]) : 0,
    };
    const rec: AdMetricDaily = {
      platform: plat,
      accountId: `${plat}_account`,
      campaignId: cols.campaignName ? row[cols.campaignName] : 'unknown',
      campaignName: cols.campaignName ? row[cols.campaignName] : 'unknown',
      level: 'campaign',
      date: cols.date ? normDate(row[cols.date]) : '',
      breakdown: cols.region ? { region: row[cols.region] } : undefined,
      ...raw,
      ...deriveMetrics(raw),
    };
    return rec;
  });
}
