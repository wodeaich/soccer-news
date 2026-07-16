/**
 * 第一期：CSV 导入器（不依赖 API 令牌，立刻可用）。
 * 把各平台后台"导出的报表 CSV"识别并翻译成统一模型 AdMetricDaily。
 *
 * 用法：先跑通全链路验证分析与图表，之后无缝换成 collectors/ 里的官方 API 采集器。
 *
 * TODO(阶段一)：接入真实 CSV 表头映射。请发一份 FB / Google 导出样例，
 * 照真实列名补全下面各平台的 FIELD_MAP。
 */

import { AdMetricDaily, deriveMetrics, Platform } from '../model/adMetric';

/** 各平台导出 CSV 的列名 → 统一字段 的映射（待用真实样例补全） */
const FIELD_MAP: Record<Platform, Record<string, keyof AdMetricDaily>> = {
  meta: {
    // 'Campaign name': 'campaignName', 'Amount spent': 'spend', ...
  },
  google: {
    // 'Campaign': 'campaignName', 'Cost': 'spend', ...
  },
  tiktok: {
    // 'Campaign name': 'campaignName', 'Cost': 'spend', ...
  },
};

/**
 * 解析一份 CSV 文本为 AdMetricDaily[]。
 * @param platform 该 CSV 来自哪个平台
 * @param rows     已解析为对象数组的 CSV 行（key = 表头）
 */
export function mapCsvRows(platform: Platform, rows: Record<string, string>[]): AdMetricDaily[] {
  const map = FIELD_MAP[platform];
  return rows.map((row) => {
    const rec: Partial<AdMetricDaily> = { platform, level: 'campaign' };
    for (const [col, field] of Object.entries(map)) {
      const v = row[col];
      if (v == null) continue;
      // 数值字段转 number，其余保留字符串
      (rec as Record<string, unknown>)[field] = isNumericField(field) ? toNumber(v) : v;
    }
    const raw = {
      spend: rec.spend ?? 0,
      impressions: rec.impressions ?? 0,
      clicks: rec.clicks ?? 0,
      conversions: rec.conversions ?? 0,
      revenue: rec.revenue ?? 0,
    };
    return { ...rec, ...raw, ...deriveMetrics(raw) } as AdMetricDaily;
  });
}

function isNumericField(f: keyof AdMetricDaily): boolean {
  return ['spend', 'impressions', 'clicks', 'conversions', 'revenue'].includes(f as string);
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(/[,¥$%\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
