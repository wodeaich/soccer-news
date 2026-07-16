/**
 * 极简健壮 CSV 解析器（零依赖）：支持带引号字段、字段内逗号、转义引号、\r\n。
 * 输出：以首行表头为 key 的对象数组。
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = splitRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => (rec[h] = (cells[i] ?? '').trim()));
    return rec;
  });
}

function splitRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, ''); // 去 BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // 转义引号
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) out.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x !== '')) out.push(row); }
  return out;
}
