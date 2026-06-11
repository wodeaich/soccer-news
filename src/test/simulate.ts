/**
 * 模拟测试：用 mock 的老年保险痛点数据全链路跑通
 * 清洗 -> 聚类 -> 热度打分 -> LLM 打分(mock) -> 最终排序，
 * 并对关键行为做断言。不依赖 MongoDB / DeepSeek API / 网络。
 *
 * 运行：MOCK_LLM=true npm run test:sim
 */
process.env.MOCK_LLM = 'true';
process.env.MOCK_SERP = 'true';

import assert from 'assert';
import fs from 'fs';
import { cleanRawText } from '../utils/clean';
import { clusterKeywords, tokenize, jaccard, SourcePost } from '../analysis/heat';
import { scoreWithLlm } from '../analysis/deepseek';
import { computeRankSpeed, getRankSpeedScores } from '../analysis/serp';
import { rankFinal } from '../analysis/rank';

function post(p: Partial<SourcePost> & { keyword: string; url: string }): SourcePost {
  return {
    title: p.keyword,
    cleaned_content: `${p.keyword} discussion`,
    upvotes: 0,
    comments: 0,
    community: 'r/insurance',
    ...p,
  } as SourcePost;
}

async function main() {
  // ---------- 1. 清洗测试 ----------
  const dirty =
    'Check https://spam.example/link I am a bot, and this action was performed automatically.   My mom got denied   coverage twice.';
  const cleaned = cleanRawText(dirty);
  assert(!cleaned.includes('https://'), 'URL 应被移除');
  assert(!cleaned.toLowerCase().includes('i am a bot'), '机器人话术应被移除');
  assert(!/\s{2,}/.test(cleaned), '连续空白应被压缩');
  console.log('✅ 1. cleanRawText: URL/机器人话术/空白 清洗正确');

  // ---------- 2. 聚类测试：同义长尾词必须合并 ----------
  const a = tokenize('life insurance for seniors over 70');
  const b = tokenize('senior life insurance 70');
  assert(jaccard(a, b) >= 0.7, `同义词 Jaccard 应 >= 0.7，实际 ${jaccard(a, b).toFixed(2)}`);

  const mockPosts: SourcePost[] = [
    // 簇 1：同义词应合并（高痛感 + 高商业意图 + 跨社区）
    post({ keyword: 'life insurance for seniors over 70', url: 'u1', upvotes: 120, comments: 85, community: 'r/medicare',
      cleaned_content: "My dad got denied twice, agents feel like a scam, we can't afford $300/mo. Desperate for the cheapest option with no medical exam." }),
    post({ keyword: 'senior life insurance 70', url: 'u2', upvotes: 90, comments: 40, community: 'r/personalfinance',
      cleaned_content: 'Best rates for seniors over 70? Every quote is too expensive and confusing.' }),
    // 簇 2：信息型低意图
    post({ keyword: 'what is medicare part b', url: 'u3', upvotes: 30, comments: 5, community: 'r/medicare',
      cleaned_content: 'Just wondering what part B covers, found the answer on the official site.' }),
    // 簇 3：中等
    post({ keyword: 'burial insurance cost', url: 'u4', upvotes: 60, comments: 22, community: 'r/insurance',
      cleaned_content: 'Funeral homes quoted us $12k, family cannot afford it, denied by two insurers already.' }),
    // 凑数簇，验证 Top N 截断
    ...Array.from({ length: 12 }, (_, i) =>
      post({ keyword: `senior dental plan topic ${i}`, url: `f${i}`, upvotes: i, comments: i, community: 'r/insurance' })),
  ];

  const clusters = clusterKeywords(mockPosts);
  const merged = clusters.find((c) => c.keyword === 'life insurance for seniors over 70');
  assert(merged, '簇心应为帖子数最多的代表词');
  assert(merged!.variants.includes('senior life insurance 70'), '同义长尾词应并入同一簇');
  assert(merged!.postCount === 2 && merged!.communityCount === 2, '簇统计(去重帖数/跨社区数)应正确');
  console.log(`✅ 2. clusterKeywords: ${mockPosts.length} 帖 -> ${clusters.length} 簇，同义词合并正确`);

  // ---------- 3. 热度排序测试 ----------
  const sorted = [...clusters].sort((x, y) => y.heatScore - x.heatScore);
  assert(sorted[0].keyword === 'life insurance for seniors over 70', '高赞高评跨社区的簇热度应排第一');
  console.log('✅ 3. heatScore: 热度排序符合预期（跨社区高互动簇居首）');

  // ---------- 4. 排名速度分测试 ----------
  // 4a. SERP 实测打分：弱竞争长尾疑问词 vs 巨头封锁短头部词
  const easy = computeRankSpeed(
    'how to get life insurance for seniors over 70',
    { allintitleCount: 8, weakDomainCount: 4, bigDomainCount: 2 },
    { postCount: 3, totalComments: 60 },
  );
  const blocked = computeRankSpeed('life insurance', { allintitleCount: 500_000, weakDomainCount: 0, bigDomainCount: 9 });
  assert(easy.score > 7, `弱竞争长尾词排名速度分应高，实际 ${easy.score}`);
  assert(blocked.excluded, '巨头封锁（前10占8席以上）的词应被标记剔除');

  // 4b. 降级链：无 SERP 数据时仅用免费信号，分数仍可计算且不剔除
  const degraded = computeRankSpeed('how much does burial insurance cost', null);
  assert(degraded.signals === null && degraded.score > 0 && !degraded.excluded, '无 Key 降级模式应正常打分');

  // 4c. 批量接口（MOCK_SERP）：返回数量与候选一致
  const rankSpeeds = await getRankSpeedScores(
    sorted.map((c) => ({ keyword: c.keyword, postCount: c.postCount, totalComments: c.totalComments })),
  );
  assert(rankSpeeds.size === sorted.length, '每个候选簇都应有排名速度分');
  console.log(`✅ 4. rankSpeed: 弱竞争=${easy.score} 降级=${degraded.score} 封锁剔除正确`);

  // ---------- 5. LLM 打分（mock）+ 最终排序 ----------
  const llmScores = await scoreWithLlm(sorted);
  assert(llmScores.length === sorted.length, '每个簇都应有 LLM 评分');

  const top = rankFinal(sorted, llmScores, rankSpeeds);
  assert(top.length <= 10, `最终输出应 <= 10 个，实际 ${top.length}`);
  for (let i = 1; i < top.length; i++) {
    assert(top[i - 1].final_score >= top[i].final_score, '最终结果应按总分降序');
  }
  assert(top[0].keyword === 'life insurance for seniors over 70', '痛感+意图+热度三高的簇应居 Top 1');
  assert(top[0].representative_quote.length > 0, 'Top 痛点应附带代表性用户原话');
  const infoCluster = top.find((t) => t.keyword === 'what is medicare part b');
  if (infoCluster) {
    assert(infoCluster.rank > 1, '信息型低意图关键词不应排第一');
  }
  assert(
    top.every((t) => typeof t.rank_speed_score === 'number'),
    '最终结果应包含排名速度分',
  );
  console.log(`✅ 5. rankFinal: 输出 ${top.length} 个痛点，降序正确，Top1 = "${top[0].keyword}"`);

  // ---------- 6. 输出文件 ----------
  fs.writeFileSync('top10_painpoints.sample.json', JSON.stringify(top, null, 2));
  console.log('✅ 6. 已写出 top10_painpoints.sample.json（模拟结果样例）');

  console.log('\n🎉 模拟测试全部通过');
}

main().catch((err) => {
  console.error('❌ 模拟测试失败:', err.message);
  process.exit(1);
});
