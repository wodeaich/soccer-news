import { config } from '../config';
import { KeywordCluster } from './heat';
import { LlmScore } from './deepseek';

export interface FinalPainPoint {
  rank: number;
  keyword: string;
  variants: string[];
  final_score: number;
  pain_score: number;
  intent_score: number;
  heat_score: number;
  stats: { posts: number; upvotes: number; comments: number; communities: number };
  reason: string;
  representative_quote: string;
  source_urls: string[];
}

/**
 * 总分 = 痛感×0.5 + 商业意图×0.3 + 归一化热度×0.2（权重可由环境变量覆盖）。
 * 热度归一化到 0-10，和 LLM 两个维度同量纲。
 */
export function rankFinal(clusters: KeywordCluster[], llmScores: LlmScore[]): FinalPainPoint[] {
  const maxHeat = Math.max(...clusters.map((c) => c.heatScore), 1);
  const byKeyword = new Map(clusters.map((c) => [c.keyword, c]));
  const { pain, intent, heat } = config.weights;

  const ranked = llmScores
    .map((score) => {
      const cluster = byKeyword.get(score.keyword);
      if (!cluster) return null;
      const heatNorm = (cluster.heatScore / maxHeat) * 10;
      return {
        keyword: cluster.keyword,
        variants: cluster.variants,
        final_score: Number((score.pain_score * pain + score.intent_score * intent + heatNorm * heat).toFixed(2)),
        pain_score: score.pain_score,
        intent_score: score.intent_score,
        heat_score: Number(heatNorm.toFixed(2)),
        stats: {
          posts: cluster.postCount,
          upvotes: cluster.totalUpvotes,
          comments: cluster.totalComments,
          communities: cluster.communityCount,
        },
        reason: score.reason,
        representative_quote: score.representative_quote,
        source_urls: cluster.topPosts.map((p) => p.url),
      };
    })
    .filter((x): x is Omit<FinalPainPoint, 'rank'> => x !== null)
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, config.finalTopN);

  return ranked.map((item, i) => ({ rank: i + 1, ...item }));
}
