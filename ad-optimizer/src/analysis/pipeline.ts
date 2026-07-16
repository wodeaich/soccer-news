/**
 * 分析管线：AdMetricDaily[] → 分维度 → 切两个周期 → 归因 + 波动 → 报告。
 * 报告结构直接喂给网页看板渲染。
 */

import { AdMetricDaily } from '../model/adMetric';
import { attributeCpcChange, AttributionResult } from './attribution';
import { analyzeSeries, FluctuationPoint } from './fluctuation';

export type MetricKey = 'cpc' | 'cpm' | 'ctr' | 'roas';

export interface DimensionReport {
  key: string; // 唯一键：platform | campaign | region
  platform: string;
  campaignName: string;
  region?: string;
  days: number;
  attribution: AttributionResult;
  series: Record<MetricKey, FluctuationPoint[]>; // 各指标的波动序列
}

export interface AnalysisReport {
  generatedAt: string;
  dimensions: DimensionReport[];
}

const dimKey = (r: AdMetricDaily) =>
  `${r.platform} | ${r.campaignName} | ${r.breakdown?.region ?? '全部'}`;

/** 把明细按维度分组、按日期排序，切成前后两个周期做对比 */
export function buildReport(rows: AdMetricDaily[]): AnalysisReport {
  const groups = new Map<string, AdMetricDaily[]>();
  for (const r of rows) {
    const k = dimKey(r);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }

  const dimensions: DimensionReport[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const dates = [...new Set(sorted.map((r) => r.date))];
    if (dates.length < 2) continue; // 不足两天无法对比

    const mid = Math.floor(dates.length / 2);
    const baseDates = new Set(dates.slice(0, mid));
    const baselineRows = sorted.filter((r) => baseDates.has(r.date));
    const currentRows = sorted.filter((r) => !baseDates.has(r.date));

    const attribution = attributeCpcChange(baselineRows, currentRows);
    const series = {
      cpc: analyzeSeries(sorted.map((r) => ({ date: r.date, value: r.cpc }))),
      cpm: analyzeSeries(sorted.map((r) => ({ date: r.date, value: r.cpm }))),
      ctr: analyzeSeries(sorted.map((r) => ({ date: r.date, value: r.ctr }))),
      roas: analyzeSeries(sorted.map((r) => ({ date: r.date, value: r.roas }))),
    };

    dimensions.push({
      key,
      platform: sorted[0].platform,
      campaignName: sorted[0].campaignName,
      region: sorted[0].breakdown?.region,
      days: dates.length,
      attribution,
      series,
    });
  }

  // CPC 涨得最多的维度排前面，优先关注
  dimensions.sort((a, b) => b.attribution.change.cpcPct - a.attribution.change.cpcPct);
  return { generatedAt: new Date().toISOString(), dimensions };
}
