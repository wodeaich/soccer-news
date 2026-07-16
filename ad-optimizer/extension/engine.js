/**
 * 浏览器原生分析引擎（ES module，零依赖）。
 * 从 src/ 的 TypeScript 核心移植：CSV 解析 + 别名映射 + 归因 + 波动 + 报告。
 * 供插件侧边栏使用，全部在本地浏览器内计算，数据不出本机。
 */

// ---------- 派生指标 ----------
export function deriveMetrics({ spend, impressions, clicks, conversions, revenue }) {
  const safe = (n, d) => (d > 0 ? n / d : 0);
  return {
    cpm: safe(spend * 1000, impressions),
    ctr: safe(clicks, impressions),
    cpc: safe(spend, clicks),
    cpa: safe(spend, conversions),
    roas: safe(revenue, spend),
  };
}

// ---------- CSV 解析（支持引号/逗号/BOM）----------
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x !== '')) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const rec = {};
    headers.forEach((h, i) => (rec[h] = (cells[i] ?? '').trim()));
    return rec;
  });
}

// ---------- 列名别名映射 + 平台识别 ----------
const ALIASES = {
  campaignName: ['campaign name', 'campaign', 'campaign_name', '广告系列名称', '广告系列', '广告活动'],
  date: ['day', 'date', 'by day', 'reporting starts', 'stat_time_day', '日期', '时间'],
  region: ['region', 'geo', 'region name', 'dma region', 'geo_target_region', '地区', '地域', '省份'],
  spend: ['amount spent', 'amount spent (usd)', 'cost', 'spend', '花费', '消耗', '成本'],
  impressions: ['impressions', 'impr', 'impr.', '展示量', '展示', '曝光量', '曝光'],
  clicks: ['clicks', 'link clicks', 'clicks (all)', 'clicks (destination)', '点击量', '点击次数', '点击'],
  conversions: ['results', 'conversions', 'conversion', 'conv', '转化数', '转化量', '转化'],
  revenue: ['conv. value', 'conversion value', 'total complete payment', 'purchase conversion value', '转化价值', '收入'],
};
const norm = (s) => String(s).toLowerCase().replace(/[().,_\s%]/g, '').replace(/usd|cny|rmb/g, '').trim();

function resolveColumns(headers) {
  const nh = headers.map((h) => ({ raw: h, n: norm(h) }));
  const map = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const na = aliases.map(norm);
    const hit = nh.find((h) => na.some((a) => h.n === a || h.n.includes(a)));
    if (hit) map[field] = hit.raw;
  }
  return map;
}

export function detectPlatform(headers) {
  const j = headers.map(norm).join('|');
  if (j.includes('amountspent')) return 'meta';
  if (j.includes('totalcompletepayment') || j.includes('byday')) return 'tiktok';
  return 'google';
}

const NUMERIC = new Set(['spend', 'impressions', 'clicks', 'conversions', 'revenue']);
const toNumber = (v) => { const n = parseFloat(String(v || '').replace(/[,¥$￥%\s]/g, '')); return Number.isFinite(n) ? n : 0; };
function normDate(v) {
  const t = String(v || '').trim();
  const m = t.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : t;
}

/** CSV 文本 → 统一模型数组 */
export function importCsv(text, platform) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const cols = resolveColumns(headers);
  const plat = platform || detectPlatform(headers);
  return rows.map((row) => {
    const raw = {
      spend: cols.spend ? toNumber(row[cols.spend]) : 0,
      impressions: cols.impressions ? toNumber(row[cols.impressions]) : 0,
      clicks: cols.clicks ? toNumber(row[cols.clicks]) : 0,
      conversions: cols.conversions ? toNumber(row[cols.conversions]) : 0,
      revenue: cols.revenue ? toNumber(row[cols.revenue]) : 0,
    };
    return {
      platform: plat,
      campaignName: cols.campaignName ? row[cols.campaignName] : 'unknown',
      region: cols.region ? row[cols.region] : undefined,
      date: cols.date ? normDate(row[cols.date]) : '',
      ...raw,
      ...deriveMetrics(raw),
    };
  }).filter((r) => r.date); // 丢掉无日期的汇总行
}

// ---------- 归因引擎 ----------
function aggregate(rows) {
  const sum = rows.reduce((a, r) => ({
    spend: a.spend + r.spend, impressions: a.impressions + r.impressions,
    clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions, revenue: a.revenue + r.revenue,
  }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 });
  return { ...sum, ...deriveMetrics(sum) };
}
const pct = (cur, base) => (base > 0 ? (cur - base) / base : 0);

export function attributeCpcChange(baselineRows, currentRows) {
  const baseline = aggregate(baselineRows), current = aggregate(currentRows);
  const change = { cpmPct: pct(current.cpm, baseline.cpm), ctrPct: pct(current.ctr, baseline.ctr), cpcPct: pct(current.cpc, baseline.cpc) };
  const ln = (n) => Math.log(Math.max(n, 1e-9));
  const cpmContrib = ln(current.cpm) - ln(baseline.cpm);
  const ctrContrib = -(ln(current.ctr) - ln(baseline.ctr));
  const totalAbs = Math.abs(cpmContrib) + Math.abs(ctrContrib) || 1;
  const cpmShare = Math.abs(cpmContrib) / totalAbs, ctrShare = Math.abs(ctrContrib) / totalAbs;
  let mainDriver = Math.abs(cpmShare - ctrShare) < 0.15 ? 'mixed' : (cpmShare > ctrShare ? 'cpm' : 'ctr');
  const fmt = (n) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(0)}%`;
  const stable = Math.abs(change.cpcPct) < 0.03;
  const conclusion = stable
    ? `CPC ${fmt(change.cpcPct)}，基本持平，无显著波动，维持当前投放即可。`
    : `CPC ${fmt(change.cpcPct)}：其中竞价(CPM ${fmt(change.cpmPct)})贡献约 ${(cpmShare * 100).toFixed(0)}%，` +
      `素材点击率(CTR ${fmt(change.ctrPct)})贡献约 ${(ctrShare * 100).toFixed(0)}%。` +
      `主因是${mainDriver === 'cpm' ? '竞价环境变贵' : mainDriver === 'ctr' ? '素材点击率下滑（素材疲劳）' : '竞价与素材双重因素'}。`;
  return { baseline, current, change, attribution: { cpmShare, ctrShare, mainDriver }, conclusion, recommendations: buildRecs(mainDriver, change) };
}

function buildRecs(driver, change) {
  const r = [];
  if (change.cpcPct <= 0.03) { r.push('CPC 未显著上涨，维持当前投放，持续观察。'); return r; }
  if (driver === 'ctr' || driver === 'mixed') {
    r.push('素材已疲劳：优先更换/迭代创意，提升 CTR 以拉低 CPC。');
    r.push('检查受众是否过窄导致重复曝光（frequency 过高会拉低 CTR）。');
  }
  if (driver === 'cpm' || driver === 'mixed') {
    r.push('竞价变贵：考虑错峰投放、放宽/更换受众、或分散预算避免同区域内部竞价。');
    r.push('核对是否预算/出价冲太快抬高了 CPM，可平滑预算或改用成本上限出价。');
  }
  return r;
}

// ---------- 波动分析 ----------
export function analyzeSeries(series, window = 7) {
  return series.map((p, i) => {
    const win = series.slice(Math.max(0, i - window + 1), i + 1).map((s) => s.value);
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const std = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
    const z = std > 0 ? (p.value - mean) / std : 0;
    const prev = i > 0 ? series[i - 1].value : null;
    return { ...p, ma: mean, upper: mean + 2 * std, lower: mean - 2 * std, z, isAnomaly: Math.abs(z) > 2, dodPct: prev ? (p.value - prev) / prev : null };
  });
}

// ---------- 累积去重 + 报告 ----------
const rowKey = (r) => `${r.platform}|${r.campaignName}|${r.region ?? ''}|${r.date}`;

/** 把新导入的行并入已存数据，按 平台|广告|地区|日期 去重（新数据覆盖旧的） */
export function mergeRows(existing, incoming) {
  const map = new Map(existing.map((r) => [rowKey(r), r]));
  for (const r of incoming) map.set(rowKey(r), r);
  return [...map.values()];
}

export function buildReport(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.platform} | ${r.campaignName} | ${r.region ?? '全部'}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const dimensions = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const dates = [...new Set(sorted.map((r) => r.date))];
    if (dates.length < 2) continue;
    const mid = Math.floor(dates.length / 2);
    const baseDates = new Set(dates.slice(0, mid));
    const attribution = attributeCpcChange(sorted.filter((r) => baseDates.has(r.date)), sorted.filter((r) => !baseDates.has(r.date)));
    const series = {
      cpc: analyzeSeries(sorted.map((r) => ({ date: r.date, value: r.cpc }))),
      cpm: analyzeSeries(sorted.map((r) => ({ date: r.date, value: r.cpm }))),
      ctr: analyzeSeries(sorted.map((r) => ({ date: r.date, value: r.ctr }))),
      roas: analyzeSeries(sorted.map((r) => ({ date: r.date, value: r.roas }))),
    };
    dimensions.push({ key, platform: sorted[0].platform, campaignName: sorted[0].campaignName, region: sorted[0].region, days: dates.length, attribution, series });
  }
  dimensions.sort((a, b) => b.attribution.change.cpcPct - a.attribution.change.cpcPct);
  return { generatedAt: new Date().toISOString(), dimensions };
}
