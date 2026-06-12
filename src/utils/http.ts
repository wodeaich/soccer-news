import axios, { AxiosInstance } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { config } from '../config';

/**
 * 统一的 HTTP 客户端：配置了 PROXY_URL 时所有请求走住宅代理。
 * 用途：GitHub Actions 等数据中心 IP 被 Reddit 匿名接口封锁(403)时，
 * 配一个住宅代理即可让抓取恢复，零代码改动。
 * （Quora 的 Puppeteer 流量在 utils/browser.ts 里单独走 --proxy-server。）
 */
export const http: AxiosInstance = (() => {
  if (!config.proxyUrl) return axios.create();
  const agent = new HttpsProxyAgent(config.proxyUrl);
  return axios.create({ httpAgent: agent, httpsAgent: agent, proxy: false });
})();
