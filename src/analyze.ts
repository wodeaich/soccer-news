import fs from 'fs';
import mongoose from 'mongoose';
import { config } from './config';
import { PainPointModel } from './db/painPoint.model';
import { clusterKeywords, SourcePost } from './analysis/heat';
import { scoreWithLlm } from './analysis/deepseek';
import { rankFinal } from './analysis/rank';

/**
 * 分析入口：MongoDB 全量痛点数据 -> 聚类 -> 热度 Top 50 -> DeepSeek 终审
 * -> Top 10 写入 top10_painpoints.json（GitHub Actions 会作为 artifact 上传）。
 */
async function main() {
  console.log('[analyze] connecting to MongoDB...');
  await mongoose.connect(config.mongoUri);

  const docs = await PainPointModel.find({}).lean();
  console.log(`[analyze] loaded ${docs.length} pain point documents`);
  if (docs.length === 0) {
    throw new Error('No data in MongoDB. Run the ingestion pipeline first (npm start).');
  }

  const posts: SourcePost[] = docs.map((d) => ({
    keyword: d.keyword,
    title: d.title,
    url: d.url,
    cleaned_content: d.cleaned_content,
    upvotes: d.upvotes ?? 0,
    comments: d.comments ?? 0,
    community: d.community ?? '',
  }));

  const clusters = clusterKeywords(posts);
  console.log(`[analyze] ${posts.length} posts -> ${clusters.length} keyword clusters`);

  const candidates = [...clusters].sort((a, b) => b.heatScore - a.heatScore).slice(0, config.llmCandidates);
  console.log(`[analyze] sending top ${candidates.length} clusters to LLM for pain/intent scoring...`);

  const llmScores = await scoreWithLlm(candidates);
  const top = rankFinal(candidates, llmScores);

  fs.writeFileSync('top10_painpoints.json', JSON.stringify(top, null, 2));
  console.log(`[analyze] wrote top10_painpoints.json (${top.length} pain points):\n`);
  for (const p of top) {
    console.log(`  #${p.rank} [${p.final_score}] ${p.keyword} (pain=${p.pain_score} intent=${p.intent_score} heat=${p.heat_score})`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[analyze] fatal:', err);
  process.exit(1);
});
