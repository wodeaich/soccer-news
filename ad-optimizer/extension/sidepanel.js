import { importCsv, buildReport } from './engine.js';
import { getAllRows, putRows, clearRows, migrateLegacy } from './store.js';

const $ = (id) => document.getElementById(id);

let rows = [];   // 当前内存中的全部明细（从 IndexedDB 载入）
let report = { dimensions: [] };

async function reload() { rows = await getAllRows(); }

// ---------- 导入 CSV ----------
async function handleFiles(fileList) {
  let added = 0;
  for (const f of fileList) {
    const parsed = importCsv(await f.text());
    await putRows(parsed);            // IndexedDB 按维度自动去重入库
    added += parsed.length;
  }
  await reload();
  rebuild();
  flashStat(`本次导入 ${added} 行，已累积 ${rows.length} 行`);
}

// ---------- 导出 / 导入备份（JSON）----------
async function exportData() {
  const data = await getAllRows();
  const payload = { app: 'ad-optimizer', version: 1, exportedAt: new Date().toISOString(), rows: data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ad-optimizer-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  flashStat(`已导出 ${data.length} 行备份`);
}

async function importBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed.rows;
    if (!Array.isArray(incoming)) throw new Error('格式不符');
    await putRows(incoming);
    await reload();
    rebuild();
    flashStat(`已导入备份 ${incoming.length} 行，累积 ${rows.length} 行`);
  } catch (e) {
    flashStat('导入失败：不是有效的备份 JSON');
  }
}

function rebuild() {
  report = buildReport(rows);
  const has = report.dimensions.length > 0;
  $('controls').style.display = has ? 'block' : 'none';
  if (!has) {
    $('panel').innerHTML = rows.length
      ? '<div class="empty">已有数据，但每个维度还不足 2 天，无法对比。<br>再导入更多日期的数据即可。</div>'
      : '<div class="empty">还没有数据。拖入一份导出的 CSV 开始。</div>';
    return;
  }
  const sel = $('dim');
  sel.innerHTML = report.dimensions.map((d, i) =>
    `<option value="${i}">${d.key} (CPC ${fmtPct(d.attribution.change.cpcPct)})</option>`).join('');
  render();
}

function baseStat() {
  const days = new Set(rows.map((r) => r.date)).size;
  const plats = [...new Set(rows.map((r) => r.platform))].join('/');
  $('stat').textContent = rows.length ? `已累积 ${rows.length} 行 · ${days} 个日期 · ${plats || '—'}` : '';
}
let flashTimer;
function flashStat(msg) {
  $('stat').textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(baseStat, 2500);
}

// ---------- 渲染 ----------
const fmtPct = (n) => (n >= 0 ? '+' : '') + (n * 100).toFixed(0) + '%';
const fmtVal = (m, v) => m === 'ctr' ? (v * 100).toFixed(2) + '%' : (m === 'roas' ? v.toFixed(2) : '¥' + v.toFixed(2));

function render() {
  const d = report.dimensions[+$('dim').value];
  if (!d) return;
  const m = $('metric').value;
  const a = d.attribution;
  const cls = (n) => n > 0 ? 'up' : (n < 0 ? 'down' : '');
  const kpis = [
    ['CPM', `¥${a.baseline.cpm.toFixed(1)}→¥${a.current.cpm.toFixed(1)}`, a.change.cpmPct],
    ['CTR', `${(a.baseline.ctr*100).toFixed(2)}%→${(a.current.ctr*100).toFixed(2)}%`, a.change.ctrPct],
    ['CPC', `¥${a.baseline.cpc.toFixed(2)}→¥${a.current.cpc.toFixed(2)}`, a.change.cpcPct],
  ].map(([k,v,c]) => `<div class="kpi"><span>${k} <b class="${cls(c)}" style="font-size:10px">${fmtPct(c)}</b></span><b>${v}</b></div>`).join('');

  const hl = (t) => t.replace(/(\+\d+%)/g, '<span class="up">$1</span>').replace(/(-\d+%)/g, '<span class="down">$1</span>');
  const recsHtml = (arr) => arr.map((r) => `<li>${r}</li>`).join('');

  // 有回收数据时，回收(ROI)归因优先展示
  const roiCard = d.roi ? `<div class="card"><h3>💰 回收(ROI) 归因 · 是 CPM 还是 CPC</h3>
       <div class="kpis">
         <div class="kpi"><span>回收 ROAS <b class="${cls(d.roi.change.roasPct)}" style="font-size:10px">${fmtPct(d.roi.change.roasPct)}</b></span><b>${d.roi.baseline.roas.toFixed(2)}→${d.roi.current.roas.toFixed(2)}</b></div>
         <div class="kpi"><span>CVR <b class="${cls(d.roi.change.cvrPct)}" style="font-size:10px">${fmtPct(d.roi.change.cvrPct)}</b></span><b>${(d.roi.baseline.cvr*100).toFixed(1)}%→${(d.roi.current.cvr*100).toFixed(1)}%</b></div>
         <div class="kpi"><span>客单价 <b class="${cls(d.roi.change.aovPct)}" style="font-size:10px">${fmtPct(d.roi.change.aovPct)}</b></span><b>¥${d.roi.baseline.aov.toFixed(0)}→¥${d.roi.current.aov.toFixed(0)}</b></div>
       </div>
       <div class="concl">${hl(d.roi.conclusion)}</div><ul class="recs">${recsHtml(d.roi.recommendations)}</ul></div>` : '';

  $('panel').innerHTML =
    `<div class="card"><h3>${d.key} · ${m.toUpperCase()} 趋势 + 7日均线 ±2σ</h3>
       <div class="kpis">${kpis}</div>${chartSvg(d.series[m], m)}</div>
     ${roiCard}
     <div class="card"><h3>成本侧：CPC 归因与建议</h3><div class="concl">${hl(a.conclusion)}</div><ul class="recs">${recsHtml(a.recommendations)}</ul></div>`;
}

// 零依赖 SVG 折线图：波动带 + 均线 + 数据线 + 异常红点
function chartSvg(points, m) {
  if (!points || !points.length) return '';
  const W = 360, H = 200, pad = { l: 44, r: 10, t: 10, b: 24 };
  const vals = points.flatMap((p) => [p.value, p.upper, p.lower]).filter(Number.isFinite);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; } const py = (max - min) * 0.1; min -= py; max += py;
  const X = (i) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const path = (k) => points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(' ');
  const band = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.upper).toFixed(1)}`).join(' ') + ' ' +
               points.map((p, i) => `${X(i).toFixed(1)},${Y(p.lower).toFixed(1)}`).reverse().join(' ');
  const grid = [min, (min+max)/2, max].map((v) => `<text x="4" y="${Y(v)+4}" fill="#8b97ad" font-size="10">${fmtVal(m, v)}</text><line x1="${pad.l}" y1="${Y(v)}" x2="${W-pad.r}" y2="${Y(v)}" stroke="#26304a"/>`).join('');
  const step = Math.ceil(points.length / 5);
  const xl = points.map((p, i) => (i % step === 0 || i === points.length-1) ? `<text x="${X(i)}" y="${H-6}" fill="#8b97ad" font-size="9" text-anchor="middle">${p.date.slice(5)}</text>` : '').join('');
  const dots = points.map((p, i) => p.isAnomaly
    ? `<circle cx="${X(i)}" cy="${Y(p.value)}" r="4" fill="#ff6b6b"><title>${p.date} 异常 z=${p.z.toFixed(1)}</title></circle>`
    : `<circle cx="${X(i)}" cy="${Y(p.value)}" r="2" fill="#5b8def"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}
    <polygon points="${band}" fill="var(--band)"/>
    <path d="${path('ma')}" fill="none" stroke="#8b97ad" stroke-dasharray="4 3" stroke-width="1.3"/>
    <path d="${path('value')}" fill="none" stroke="#5b8def" stroke-width="2"/>${dots}${xl}</svg>`;
}

// ---------- 事件 ----------
const drop = $('drop');
drop.onclick = () => $('file').click();
$('file').onchange = (e) => handleFiles(e.target.files);
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('hot'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('hot'); }));
drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
$('dim').onchange = render;
$('metric').onchange = render;
$('export').onclick = exportData;
$('import').onclick = () => $('jsonFile').click();
$('jsonFile').onchange = (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; };
$('clear').onclick = async () => {
  if (!confirm('清空本地累积的全部数据？（建议先导出备份）')) return;
  await clearRows(); await reload(); rebuild(); baseStat();
};

// ---------- 启动 ----------
(async () => {
  await migrateLegacy();     // 旧 chrome.storage 数据一次性迁入 IndexedDB
  await reload();
  baseStat();
  rebuild();
})();
