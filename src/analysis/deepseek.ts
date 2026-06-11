import axios from 'axios';
import { config } from '../config';
import { KeywordCluster } from './heat';

/**
 * 第二层：LLM 终审。把热度 Top N 的痛点簇连同用户原话喂给 DeepSeek
 * （API 兼容 OpenAI Chat Completions 格式），按"痛感强度 + 商业意图"打分。
 * MOCK_LLM=true 时走确定性规则打分，供模拟测试 / CI 使用，不消耗 API。
 */

export interface LlmScore {
  keyword: string;
  pain_score: number; // 1-10 痛感强度
  intent_score: number; // 1-10 商业意图
  reason: string;
  representative_quote: string;
}

const SYSTEM_PROMPT = `You are an SEO strategist analyzing user pain points scraped from Reddit/Quora.
For EACH keyword cluster, score two dimensions from 1-10:

pain_score (痛感强度) — judge from the user quotes:
- Emotional language (scammed, denied, can't afford, desperate) = high
- Unresolved (people keep asking, no accepted answer) = high; has a standard answer = low
- Urgency (deadlines, health emergencies) = high
- Same complaint repeated by different users = high

intent_score (商业意图) — judge from the keyword's modifiers:
- Transactional modifiers (best, cheapest, cost, quotes, rates, no medical exam, specific qualifiers like "over 70") = high
- Informational modifiers (what is, how does ... work) = low
- Solvable by content/tool/referral = high; pure complaints about regulation = low

Return STRICT JSON array, no markdown fences:
[{"keyword": "...", "pain_score": N, "intent_score": N, "reason": "<=30 words", "representative_quote": "<most representative user quote, <=50 words>"}]`;

/** 交易型修饰词，mock 模式与真实 LLM 共用同一套行业先验 */
const TRANSACTIONAL = ['best', 'cheap', 'cost', 'quote', 'rate', 'price', 'afford', 'no medical exam', 'near me', 'over '];
const PAIN_SIGNALS = ['scam', 'denied', 'cant afford', "can't afford", 'desperate', 'help', 'confus', 'ripoff', 'too expensive', 'refus'];

function mockScore(clusters: KeywordCluster[]): LlmScore[] {
  return clusters.map((c) => {
    const text = (c.keyword + ' ' + c.topPosts.map((p) => p.cleaned_content).join(' ')).toLowerCase();
    const pain = Math.min(10, 3 + PAIN_SIGNALS.filter((s) => text.includes(s)).length * 2);
    const intent = Math.min(10, 3 + TRANSACTIONAL.filter((s) => c.keyword.toLowerCase().includes(s)).length * 3);
    return {
      keyword: c.keyword,
      pain_score: pain,
      intent_score: intent,
      reason: '[mock] rule-based score for simulation',
      representative_quote: c.topPosts[0]?.cleaned_content.slice(0, 120) ?? '',
    };
  });
}

export async function scoreWithLlm(clusters: KeywordCluster[]): Promise<LlmScore[]> {
  if (config.mockLlm) {
    console.log('[llm] MOCK_LLM=true, using deterministic rule-based scoring');
    return mockScore(clusters);
  }
  if (!config.deepseekApiKey) {
    throw new Error('DEEPSEEK_API_KEY is required (or set MOCK_LLM=true for simulation)');
  }

  const userPayload = clusters.map((c) => ({
    keyword: c.keyword,
    variants: c.variants.slice(0, 5),
    stats: { posts: c.postCount, upvotes: c.totalUpvotes, comments: c.totalComments, communities: c.communityCount },
    user_quotes: c.topPosts.map((p) => p.cleaned_content.slice(0, 500)),
  }));

  const response = await axios.post(
    `${config.deepseekBaseUrl}/chat/completions`,
    {
      model: config.deepseekModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    },
    {
      headers: { Authorization: `Bearer ${config.deepseekApiKey}` },
      timeout: 120_000,
    },
  );

  const content: string = response.data.choices[0].message.content;
  // 容错：剥掉模型偶尔加上的 ```json 围栏
  const json = content.replace(/^```(json)?\s*|```\s*$/g, '').trim();
  const parsed: LlmScore[] = JSON.parse(json);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('DeepSeek returned empty/invalid score array');
  }
  return parsed;
}
