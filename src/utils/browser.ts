import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';
import { config } from '../config';

puppeteer.use(StealthPlugin());

export async function launchBrowser(): Promise<Browser> {
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  if (config.proxyUrl) {
    args.push(`--proxy-server=${config.proxyUrl}`);
  }
  return puppeteer.launch({ headless: true, args }) as unknown as Promise<Browser>;
}

export async function newPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({
    width: 1280 + Math.floor(Math.random() * 100),
    height: 800 + Math.floor(Math.random() * 100),
  });
  return page;
}

/** 模拟无限滚动，直到页面高度不再增长或达到最大滚动次数（Quora 瀑布流必备） */
export async function autoScroll(page: Page, maxScrolls = 10): Promise<void> {
  await page.evaluate(async (max: number) => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      let scrolls = 0;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        scrolls++;
        if (totalHeight >= scrollHeight || scrolls >= max * 10) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  }, maxScrolls);
}
