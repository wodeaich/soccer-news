import { google } from 'googleapis';
import { config } from '../config';
import { FinalPainPoint } from '../analysis/rank';

/**
 * 把最终筛选结果追加到用户 Google 网盘里的表格（Google Sheets）。
 * 认证方式：GCP 服务账号 —— 无需 OAuth 授权弹窗，适合 GitHub Actions 无人值守运行。
 * 前提：用户需把目标表格"共享"给服务账号邮箱（编辑权限），否则 403。
 */

export const SHEET_HEADER = [
  '行业',
  '初始关键词',
  'REDDIT 模块',
  '最终关键词',
  '总分',
  '痛感',
  '商业意图',
  '排名速度',
  '热度',
  '代表性用户原话',
  '来源链接',
  '批次时间',
];

/** 纯函数构造行数据，便于模拟测试断言 */
export function buildSheetRows(points: FinalPainPoint[], industry: string, batchTime: string): string[][] {
  return points.map((p) => [
    industry,
    p.seed_keywords.join(', '),
    `帖子数:${p.stats.posts} 总赞:${p.stats.upvotes} 评论:${p.stats.comments} 社区数:${p.stats.communities}`,
    p.keyword,
    String(p.final_score),
    String(p.pain_score),
    String(p.intent_score),
    String(p.rank_speed_score),
    String(p.heat_score),
    p.representative_quote,
    p.source_urls.join('\n'),
    batchTime,
  ]);
}

export async function exportToGoogleSheet(points: FinalPainPoint[]): Promise<void> {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(config.googleServiceAccountJson),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = config.googleSheetId;

  // 表格为空时先写表头
  const head = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'A1:A1' });
  if (!head.data.values) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'A1',
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADER] },
    });
  }

  const rows = buildSheetRows(points, config.industry, new Date().toISOString());
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });

  console.log(`[sheets] appended ${rows.length} rows to Google Sheet ${spreadsheetId}`);
}
