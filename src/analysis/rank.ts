import { config } from '../config';
import { KeywordCluster } from './heat';
import { LlmScore } from './deepseek';
import { RankSpeed } from './serp';

export interface FinalPainPoint {
  rank: number;
  keyword: string;
  variants: string[];
  seed_keywords: string[];
  final_score: number;
  pain_score: number;
  intent_score: number;
  rank_speed_score: number;
  heat_score: number;
  stats: { posts: number; upvotes: number; comments: number; communities: number };
  serp: RankSpeed['signals']; // null = 当时降级为免费信号模式
  reason: string;
  representative_quote: string;
  source_urls: string[];
}

/**
 * 总分 = 痛感×0.4 + 商业意图×0.25 + 排名速度×0.2 + 归一化热度×0.15（权重可由环境变量覆盖）。
 * 巨头封锁（前 10 被 DR90+ 域名占 8 席以上）的词在排序前直接剔除——新站做不上去的陷阱词。
 */
export function rankFinal(
  clusters: KeywordCluster[],
  llmScores: LlmScore[],
  rankSpeeds: Map<string, RankSpeed>,
): FinalPainPoint[] {
  const maxHeat = Math.max(...clusters.map((c) => c.heatScore), 1);
  const byKeyword = new Map(clusters.map((c) => [c.keyword, c]));
  const { pain, intent, rankSpeed, heat } = config.weights;

  const ranked = llmScores
    .map((score) => {
      const cluster = byKeyword.get(score.keyword);
      if (!cluster) return null;

      const speed = rankSpeeds.get(score.keyword) ?? { score: 0, excluded: false, signals: null };
      if (speed.excluded) {
        console.log(`[rank] excluded "${score.keyword}" — top 10 blockaded by high-authority domains`);
        return null;
      }

      const heatNorm = (cluster.heatScore / maxHeat) * 10;
      return {
        keyword: cluster.keyword,
        variants: cluster.variants,
        seed_keywords: cluster.seedKeywords,
        final_score: Number(
          (score.pain_score * pain + score.intent_score * intent + speed.score * rankSpeed + heatNorm * heat).toFixed(2),
        ),
        pain_score: score.pain_score,
        intent_score: score.intent_score,
        rank_speed_score: speed.score,
        heat_score: Number(heatNorm.toFixed(2)),
        stats: {
          posts: cluster.postCount,
          upvotes: cluster.totalUpvotes,
          comments: cluster.totalComments,
          communities: cluster.communityCount,
        },
        serp: speed.signals,
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
