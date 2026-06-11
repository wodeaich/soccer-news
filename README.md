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
src/analyze.ts               # 分析入口：DB -> 聚类 -> 热度 -> LLM -> Top 10
src/analysis/
├── heat.ts                  # 关键词 Jaccard 聚类 + 热度打分（第一层，免费）
├── serp.ts                  # 排名速度分：Serper.dev SERP 实测（KGR/弱主域/巨头封锁）
├── deepseek.ts              # DeepSeek 终审：痛感+商业意图打分（第二层）
└── rank.ts                  # 加权总分排序，输出 top10_painpoints.json
src/test/simulate.ts         # 模拟测试：mock 数据全链路（CI 自动跑）
```

## 痛点 Top 10 分析（npm run analyze）

两层漏斗：**量化打分把 N 个关键词簇压到 50（不花钱）→ DeepSeek 把 50 压到 10（一次 API 调用）**。

- 第一层热度分 = `log(1+帖子数)×2 + log(1+总赞) + log(1+总评论)×1.5 + 跨社区数×3`
- **排名速度分（0-10）** = 免费信号(词长+疑问句式+Reddit反推, 0-3) + KGR(0-3) + 弱主域(0-2) + 巨头封锁(0-2)，
  数据来自 Serper.dev SERP 实测；前 10 被高权重域名占 8 席以上的词直接剔除（新站陷阱词）；
  无 `SERPER_API_KEY` 时自动降级为免费信号，管线不断
- 第二层 LLM 按痛感强度（情绪词/未解决/紧迫性）和商业意图（交易型 vs 信息型修饰词/可解决性）各打 1-10 分
- 总分 = 痛感×0.4 + 意图×0.25 + 排名速度×0.2 + 归一化热度×0.15（权重可用 `WEIGHT_*` 环境变量调；
  站点权重起来后把 `WEIGHT_RANK_SPEED` 调回 0 再攻高难度词）
- 输出 `top10_painpoints.json`，每个痛点附代表性用户原话、SERP 信号和来源链接

模拟测试（不需要数据库和 API Key）：

```bash
npm run test:sim   # mock 数据全链路 + 断言，CI 每次 push 自动跑
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
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | ✅(抓取) | [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) 创建 **script** 类型应用（勾选 reCAPTCHA 后才能提交）。client_id 在应用卡片 "personal use script" 字样正下方那串字符；secret 点 edit 展开可见。**GitHub Actions 数据中心 IP 已被 Reddit 匿名接口封锁(403)，必须配置** |
| `DEEPSEEK_API_KEY` | ✅(分析) | DeepSeek 开放平台 API Key，分析 workflow 用 |
| `SERPER_API_KEY` | 建议 | [serper.dev](https://serper.dev) API Key（注册送 2500 次查询），排名速度分的 SERP 实测；不填自动降级为免费信号 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ❌(导出) | GCP 服务账号 JSON 凭据的完整文件内容，Google Sheets 导出用；与 `GOOGLE_SHEET_ID` 配套，不填则跳过导出 |

### Google Sheets 导出配置（最终关键词自动写入你的网盘表格）

每次分析后，Top 10 结果自动追加到你 Google 网盘里的表格，列结构：
`行业 | 初始关键词 | REDDIT 模块 | 最终关键词 | 总分 | 痛感 | 商业意图 | 排名速度 | 热度 | 代表性用户原话 | 来源链接 | 批次时间`

一次性配置步骤（约 10 分钟）：

1. 打开 [Google Cloud Console](https://console.cloud.google.com) → 新建项目 → **APIs & Services → Library** 搜索并启用 **Google Sheets API**
2. **IAM & Admin → Service Accounts → Create**，随便起名，不用授任何角色
3. 进入该服务账号 → **Keys → Add Key → JSON**，下载密钥文件，**整个文件内容**粘贴为 GitHub Secret `GOOGLE_SERVICE_ACCOUNT_JSON`
4. 在你的 Google Drive 新建一个空白表格，点右上角**共享**，把服务账号邮箱（形如 `xxx@项目名.iam.gserviceaccount.com`，在 JSON 的 `client_email` 字段）加为**编辑者**——漏了这步会报 403
5. 表格 URL 中 `/d/` 和 `/edit` 之间那串就是 Sheet ID，填到 GitHub Variable `GOOGLE_SHEET_ID`；再加一个 Variable `INDUSTRY`（如 `senior-insurance`）

**Settings → Secrets and variables → Actions → Variables（非机密配置）：**

| Variable | 必填 | 示例 |
|----------|------|------|
| `SEED_KEYWORDS` | ✅ | `photo blur how to,fix blurry photo` |
| `SUBREDDITS` | 建议 | `iphone,photography` |
| `MAX_POSTS_PER_KEYWORD` | ❌ | `5` |
| `MAX_SUGGESTIONS_PER_SEED` | ❌ | `20` |

填完后到 **Actions → Pain Point Ingestion → Run workflow** 手动跑一次验证，绿了之后每天定时自动执行。

三个 workflow 的分工：

| Workflow | 触发 | 作用 |
|----------|------|------|
| `ci.yml` | 每次 push | 类型检查 + mock 数据模拟测试，不花钱不联外网 |
| `ingest.yml` | 每天 UTC 02:00 / 手动 | 抓取入库 |
| `analyze.yml` | 每周一 UTC 03:00 / 手动 | 提炼 Top 10，结果作为 artifact 下载（Actions 运行页底部 `top10-painpoints`） |

### 其他部署选项

- 抓取量大、单次超过 GitHub Actions 时长限制时，建议迁移到一台 VPS 上用 cron + Docker 跑，或上 BullMQ 做分布式队列。
- GitHub 会自动禁用 60 天无活动仓库的定时任务，长期挂机建议 VPS。
