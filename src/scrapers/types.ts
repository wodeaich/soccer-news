export interface ScrapedItem {
  keyword: string;
  title: string;
  source: 'Reddit' | 'Quora';
  url: string;
  raw_text: string;
  scraped_at: Date;
  /** 赞数（Reddit score），Quora 无此数据则为 0 */
  upvotes: number;
  /** 评论数 */
  comments: number;
  /** 来源社区，如 "r/medicare"，用于跨社区出现度打分 */
  community: string;
}
