export interface ScrapedItem {
  keyword: string;
  title: string;
  source: 'Reddit' | 'Quora';
  url: string;
  raw_text: string;
  scraped_at: Date;
}
