/**
 * 入口：读取 CSV → 分析 → 打印报告 + 生成看板数据 web/data.js。
 *
 * 用法：
 *   npx ts-node src/analyze.ts                 # 分析 samples/ 下所有 csv
 *   npx ts-node src/analyze.ts a.csv b.csv     # 分析指定文件
 * 之后浏览器直接打开 web/index.html 即可看图。
 */

import * as fs from 'fs';
import * as path from 'path';
import { importCsv } from './importer/csv';
import { buildReport } from './analysis/pipeline';
import { AdMetricDaily } from './model/adMetric';

function collectFiles(args: string[]): string[] {
  if (args.length) return args;
  const dir = path.join(__dirname, '..', 'samples');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).map((f) => path.join(dir, f));
}

function main() {
  const files = collectFiles(process.argv.slice(2));
  if (files.length === 0) {
    console.error('未找到 CSV。放到 samples/ 或作为参数传入。');
    process.exit(1);
  }

  const rows: AdMetricDaily[] = [];
  for (const f of files) {
    const parsed = importCsv(fs.readFileSync(f, 'utf8'));
    console.log(`✓ ${path.basename(f)}: ${parsed.length} 行 (${parsed[0]?.platform ?? '?'})`);
    rows.push(...parsed);
  }

  const report = buildReport(rows);

  console.log('\n================ 对比归因报告 ================');
  for (const d of report.dimensions) {
    const a = d.attribution;
    const anomalies = d.series.cpc.filter((p) => p.isAnomaly).map((p) => p.date);
    console.log(`\n📍 ${d.key}  （${d.days} 天）`);
    console.log(`   CPM ¥${a.baseline.cpm.toFixed(1)}→¥${a.current.cpm.toFixed(1)}  ` +
      `CTR ${(a.baseline.ctr * 100).toFixed(2)}%→${(a.current.ctr * 100).toFixed(2)}%  ` +
      `CPC ¥${a.baseline.cpc.toFixed(2)}→¥${a.current.cpc.toFixed(2)}`);
    console.log(`   结论：${a.conclusion}`);
    a.recommendations.forEach((r) => console.log(`   建议：${r}`));
    if (anomalies.length) console.log(`   ⚠ CPC 异常日：${anomalies.join(', ')}`);
  }

  // 生成看板数据
  const webDir = path.join(__dirname, '..', 'web');
  fs.writeFileSync(
    path.join(webDir, 'data.js'),
    'window.__AD_DATA__ = ' + JSON.stringify(report, null, 2) + ';\n',
    'utf8',
  );
  console.log(`\n✓ 看板数据已写入 web/data.js —— 浏览器打开 web/index.html 查看图表。`);
}

main();
