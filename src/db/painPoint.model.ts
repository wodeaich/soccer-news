import mongoose, { Schema, Document } from 'mongoose';

export interface ILongTailPainPoint extends Document {
  keyword: string; // 触发的 Google 长尾词
  seed_keyword: string; // 该长尾词来自哪个初始种子词（溯源）
  title: string; // 原始帖子标题 / 问题
  source: string; // 来源平台 (Reddit / Quora)
  url: string; // 原始来源链接，唯一索引天然去重
  cleaned_content: string; // 清洗后的纯净文本
  upvotes: number; // 赞数（热度打分原料）
  comments: number; // 评论数（热度打分原料）
  community: string; // 来源社区，如 "r/medicare"
  is_processed: boolean; // 是否已被 AI 转化为 SEO 页面
  scraped_at: Date;
}

const LongTailPainPointSchema = new Schema<ILongTailPainPoint>({
  keyword: { type: String, required: true, index: true },
  seed_keyword: { type: String, default: '' },
  title: { type: String, required: true },
  source: { type: String, required: true },
  url: { type: String, required: true, unique: true },
  cleaned_content: { type: String, required: true },
  upvotes: { type: Number, default: 0 },
  comments: { type: Number, default: 0 },
  community: { type: String, default: '' },
  is_processed: { type: Boolean, default: false, index: true },
  scraped_at: { type: Date, default: Date.now },
});

export const PainPointModel = mongoose.model<ILongTailPainPoint>('PainPoint', LongTailPainPointSchema);
