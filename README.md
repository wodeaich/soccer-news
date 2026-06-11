# 长尾痛点数据库 — Data Ingestion Pipeline

自动化管线：**种子词 → Google Suggest 长尾词拓展 → Reddit / Quora 痛点抓取 → 清洗 → MongoDB 入库**，为后续程序化 SEO 引擎提供原料。

技术栈：Node.js (TypeScript) + axios + Puppeteer (Stealth) + cheerio + Mongoose。

## 目录结构

```
src/
├── index.ts                 # 管线编排入口
├── config.ts                # 全部环境变量配置
├── keywords/googleSuggest.ts # 字母树旋转拓展长尾词
├── scrapers/
│   ├── reddit.ts            # Reddit 公开 JSON 接口抓取（见下方审查说明）
│   └── quora.ts             # DuckDuckGo 检索 + Stealth Puppeteer 抓取
├── utils/
│   ├── browser.ts           # Stealth 浏览器、autoScroll
│   └── clean.ts             # 数据清洗
└── db/
    ├── painPoint.model.ts   # Mongoose Schema（url 唯一索引去重）
    └── save.ts              # upsert 入库
```

## 本地运行

```bash
docker compose up -d          # 启动本地 MongoDB
cp .env.example .env          # 填写 SEED_KEYWORDS 等
npm install
npm run dev
```

## 对原始方案的审查结论（重要）

| # | 原方案问题 | 本仓库的修正 |
|---|-----------|-------------|
| 1 | 新版 reddit.com 是 Web Components + **Shadow DOM**，`page.content()` + cheerio 取不到帖子正文和评论；`div[-shadow-root="comment-body"]` 不是合法选择器 | 改用 Reddit 公开 JSON 端点（URL 加 `.json`），结构化、稳定、无需渲染，速度快 10 倍以上 |
| 2 | Google Suggest 用了 `http://` 且无重试 | 改 `https://`，3 次重试 + 指数退避 |
| 3 | Mongo 连接串硬编码 `localhost` | 全部走环境变量（`src/config.ts`） |
| 4 | `create` + 静默吞所有异常做"去重"，会掩盖真实错误 | 改为按 `url` 唯一键 `upsert`，天然幂等 |
| 5 | 技术栈写了 BullMQ + Redis 但代码未使用 | v1 串行 + 随机延迟即可（量小且各平台有频控）；扩容时再把每个 keyword 投为 BullMQ 任务，docker-compose 已留 Redis 注释位 |
| 6 | Quora 用 Google `site:` 搜索易触发验证码 | 改用 DuckDuckGo HTML 版（无 JS、无验证码、结构稳定） |
| 7 | 字母树 27 次请求 × 每词全量抓取，任务量会指数爆炸 | 增加 `MAX_SUGGESTIONS_PER_SEED` / `MAX_POSTS_PER_KEYWORD` 限流参数 |

### 合规提醒

- 抓取 Reddit / Quora 内容违反其服务条款，存在封 IP / 法律风险。**商用或大规模场景请改用 [Reddit 官方 OAuth API](https://www.reddit.com/dev/api/)**（免费档 100 QPM，远好于爬虫）。
- 未登录的 Reddit JSON 端点约有 10 req/min 频控，本管线已内置随机延迟，请勿调小。
- 抓取数据仅用于内部痛点分析；将原文直接发布为 SEO 页面有版权风险，务必经 AI 改写。

## 自动化部署（GitHub Actions 定时抓取）

`.github/workflows/ingest.yml` 已配置：每天 UTC 02:00 自动运行，也可在 Actions 页手动触发（可临时传入种子词）。

### 你需要在 GitHub 仓库里填写的信息

**Settings → Secrets and variables → Actions → Secrets（机密）：**

| Secret | 必填 | 说明 |
|--------|------|------|
| `MONGODB_URI` | ✅ | 云端 MongoDB 连接串，推荐 [MongoDB Atlas 免费层](https://www.mongodb.com/atlas)：`mongodb+srv://<user>:<pass>@<cluster>/app_factory_seo`。注意 Atlas 需在 Network Access 放行 `0.0.0.0/0`（GitHub Runner IP 不固定） |
| `PROXY_URL` | ❌ | 住宅代理地址 `http://user:pass@host:port`，被封 IP 时配置 |

**Settings → Secrets and variables → Actions → Variables（非机密配置）：**

| Variable | 必填 | 示例 |
|----------|------|------|
| `SEED_KEYWORDS` | ✅ | `photo blur how to,fix blurry photo` |
| `SUBREDDITS` | 建议 | `iphone,photography` |
| `MAX_POSTS_PER_KEYWORD` | ❌ | `5` |
| `MAX_SUGGESTIONS_PER_SEED` | ❌ | `20` |

填完后到 **Actions → Pain Point Ingestion → Run workflow** 手动跑一次验证，绿了之后每天定时自动执行。

### 其他部署选项

- 抓取量大、单次超过 GitHub Actions 时长限制时，建议迁移到一台 VPS 上用 cron + Docker 跑，或上 BullMQ 做分布式队列。
- GitHub 会自动禁用 60 天无活动仓库的定时任务，长期挂机建议 VPS。
