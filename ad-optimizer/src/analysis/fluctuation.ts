/**
 * 波动分析：广告周期内某指标的时间序列波动检测。
 * - 7 日移动均线 + ±2σ 标准差带 → 正常波动范围
 * - Z-score 异常检测 → 自动圈出异常日（花费突涨、CPA 突增等），供图表标红
 */

export interface Point {
  date: string;
  value: number;
}

export interface FluctuationPoint extends Point {
  ma: number; // 移动均线
  upper: number; // 均线 + 2σ
  lower: number; // 均线 − 2σ
  z: number; // Z-score
  isAnomaly: boolean; // |z| > 2
  dodPct: number | null; // 日环比
}

export function analyzeSeries(series: Point[], window = 7): FluctuationPoint[] {
  return series.map((p, i) => {
    const from = Math.max(0, i - window + 1);
    const win = series.slice(from, i + 1).map((s) => s.value);
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length;
    const std = Math.sqrt(variance);
    const z = std > 0 ? (p.value - mean) / std : 0;
    const prev = i > 0 ? series[i - 1].value : null;
    return {
      ...p,
      ma: mean,
      upper: mean + 2 * std,
      lower: mean - 2 * std,
      z,
      isAnomaly: Math.abs(z) > 2,
      dodPct: prev && prev !== 0 ? (p.value - prev) / prev : null,
    };
  });
}
