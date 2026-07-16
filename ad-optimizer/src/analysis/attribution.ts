/**
 * 对比归因引擎 ★核心
 *
 * 恒等式：CPC = CPM / (1000 × CTR)
 * 取对数：ln(CPC) = ln(CPM) − ln(CTR) − ln(1000)
 * 两期相减，CPC 的变化被【精确】拆成两部分（对数分解，可加、无残差）：
 *   Δln(CPC) = Δln(CPM)  +  (−Δln(CTR))
 *              └ 竞价变贵    └ 素材/相关性疲劳（CTR 下降）
 *
 * 于是就能自动回答："单价（CPC）为什么涨？是竞价贵了还是素材点击率掉了？"
 */

import { AdMetricDaily, deriveMetrics } from '../model/adMetric';

export interface PeriodStats {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  cpm: number;
  ctr: number;
  cpc: number;
}

export interface AttributionResult {
  baseline: PeriodStats; // 对比基准期（如上周期）
  current: PeriodStats; // 当前期
  change: {
    cpmPct: number; // CPM 变化 %
    ctrPct: number; // CTR 变化 %
    cpcPct: number; // CPC 变化 %
  };
  attribution: {
    cpmShare: number; // CPC 变化中，竞价(CPM)贡献占比 %
    ctrShare: number; // CPC 变化中，素材(CTR)贡献占比 %
    mainDriver: 'cpm' | 'ctr' | 'mixed';
  };
  conclusion: string; // 人话结论
  recommendations: string[]; // 调整建议
}

/** 把一组每日明细聚合成一个周期的统计 */
export function aggregate(rows: AdMetricDaily[]): PeriodStats {
  const sum = rows.reduce(
    (a, r) => ({
      spend: a.spend + r.spend,
      impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks,
      conversions: a.conversions + r.conversions,
      revenue: a.revenue + r.revenue,
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
  );
  const d = deriveMetrics(sum);
  return { ...sum, cpm: d.cpm, ctr: d.ctr, cpc: d.cpc };
}

const pct = (cur: number, base: number) => (base > 0 ? (cur - base) / base : 0);

/**
 * 对比两个周期，输出归因、结论、建议。
 * @param baselineRows 基准期每日明细（同一维度，如同一区域）
 * @param currentRows  当前期每日明细
 */
export function attributeCpcChange(
  baselineRows: AdMetricDaily[],
  currentRows: AdMetricDaily[],
): AttributionResult {
  const baseline = aggregate(baselineRows);
  const current = aggregate(currentRows);

  const change = {
    cpmPct: pct(current.cpm, baseline.cpm),
    ctrPct: pct(current.ctr, baseline.ctr),
    cpcPct: pct(current.cpc, baseline.cpc),
  };

  // 对数分解：各部分对 Δln(CPC) 的贡献
  const ln = (n: number) => Math.log(Math.max(n, 1e-9));
  const cpmContrib = ln(current.cpm) - ln(baseline.cpm); // 竞价贡献
  const ctrContrib = -(ln(current.ctr) - ln(baseline.ctr)); // 素材贡献（CTR 跌 → 正贡献）
  const totalAbs = Math.abs(cpmContrib) + Math.abs(ctrContrib) || 1;
  const cpmShare = Math.abs(cpmContrib) / totalAbs;
  const ctrShare = Math.abs(ctrContrib) / totalAbs;

  let mainDriver: 'cpm' | 'ctr' | 'mixed';
  if (Math.abs(cpmShare - ctrShare) < 0.15) mainDriver = 'mixed';
  else mainDriver = cpmShare > ctrShare ? 'cpm' : 'ctr';

  const fmt = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(0)}%`;
  const conclusion =
    `CPC ${fmt(change.cpcPct)}：其中竞价(CPM ${fmt(change.cpmPct)})贡献约 ${(cpmShare * 100).toFixed(0)}%，` +
    `素材点击率(CTR ${fmt(change.ctrPct)})贡献约 ${(ctrShare * 100).toFixed(0)}%。` +
    `主因是${mainDriver === 'cpm' ? '竞价环境变贵' : mainDriver === 'ctr' ? '素材点击率下滑（素材疲劳）' : '竞价与素材双重因素'}。`;

  return {
    baseline,
    current,
    change,
    attribution: { cpmShare, ctrShare, mainDriver },
    conclusion,
    recommendations: buildRecommendations(mainDriver, change),
  };
}

/** 规则引擎：贴合渠道竞价机制给出可解释的调整建议 */
function buildRecommendations(
  driver: 'cpm' | 'ctr' | 'mixed',
  change: AttributionResult['change'],
): string[] {
  const recs: string[] = [];
  if (change.cpcPct <= 0) {
    recs.push('CPC 未上涨，维持当前投放，持续观察。');
    return recs;
  }
  if (driver === 'ctr' || driver === 'mixed') {
    recs.push('素材已疲劳：优先更换/迭代创意，提升 CTR 以拉低 CPC。');
    recs.push('检查受众是否过窄导致重复曝光（frequency 过高会拉低 CTR）。');
  }
  if (driver === 'cpm' || driver === 'mixed') {
    recs.push('竞价变贵：考虑错峰投放、放宽/更换受众、或分散预算避免同区域内部竞价。');
    recs.push('核对是否预算/出价冲太快抬高了 CPM，可平滑预算或改用成本上限出价。');
  }
  return recs;
}
