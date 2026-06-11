import mongoose, { Schema, Document } from 'mongoose';

export interface ILongTailPainPoint extends Document {
  keyword: string; // 触发的 Google 长尾种子词
  title: string; // 原始帖子标题 / 问题
  source: string; // 来源平台 (Reddit / Quora)
  url: string; // 原始来源链接，唯一索引天然去重
  cleaned_content: string; // 清洗后的纯净文本
  is_processed: boolean; // 是否已被 AI 转化为 SEO 页面
  scraped_at: Date;
}

const LongTailPainPointSchema = new Schema<ILongTailPainPoint>({
  keyword: { type: String, required: true, index: true },
  title: { type: String, required: true },
  source: { type: String, required: true },
  url: { type: String, required: true, unique: true },
  cleaned_content: { type: String, required: true },
  is_processed: { type: Boolean, default: false, index: true },
  scraped_at: { type: Date, default: Date.now },
});

export const PainPointModel = mongoose.model<ILongTailPainPoint>('PainPoint', LongTailPainPointSchema);
