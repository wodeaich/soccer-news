/**
 * 演示：用样例数据跑通对比归因引擎，打印结论与建议。
 * 运行：npx ts-node src/demo.ts
 * （用真实 CSV 时，把下面的样例换成 importer/csv.ts 解析出来的数据即可）
 */

import { AdMetricDaily, deriveMetrics } from './model/adMetric';
import { attributeCpcChange } from './analysis/attribution';

function make(date: string, spend: number, impr: number, clicks: number): AdMetricDaily {
  const raw = { spend, impressions: impr, clicks, conversions: 0, revenue: 0 };
  return {
    platform: 'meta',
    accountId: 'act_1',
    campaignId: 'c_1',
    campaignName: '华东区-拉新',
    level: 'campaign',
    date,
    breakdown: { region: '华东' },
    ...raw,
    ...deriveMetrics(raw),
  };
}

// 上周期：CPM≈¥42, CTR≈2.1%, CPC≈¥2.0
const baseline = [make('2026-07-01', 4200, 100000, 2100)];
// 当前期：CPM≈¥55, CTR≈1.6%, CPC≈¥3.4（竞价变贵 + 素材疲劳）
const current = [make('2026-07-08', 5500, 100000, 1600)];

const r = attributeCpcChange(baseline, current);
console.log('=== 对比归因 ===');
console.log(`CPM: ¥${r.baseline.cpm.toFixed(0)} → ¥${r.current.cpm.toFixed(0)}`);
console.log(`CTR: ${(r.baseline.ctr * 100).toFixed(1)}% → ${(r.current.ctr * 100).toFixed(1)}%`);
console.log(`CPC: ¥${r.baseline.cpc.toFixed(1)} → ¥${r.current.cpc.toFixed(1)}`);
console.log('\n结论：' + r.conclusion);
console.log('\n建议：');
r.recommendations.forEach((x) => console.log('  - ' + x));
