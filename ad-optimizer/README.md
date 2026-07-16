# Ad Optimizer 广告账户波动分析工具

面向广告优化师的多平台（Meta / Google / TikTok）数据对比与归因工具。
目标：**告别每天手动下表 → 数据自动沉淀 → 按可选维度看波动 → 自动输出对比结论与调整建议。**

## 需求与技术方案对照

| 需求 | 技术方案 |
|---|---|
| **1. FB 防封账户/主页** | **只用官方只读报表 API（`ads_read`）取数，绝不做网页 UI 自动化/爬取。** 用商务管理平台 System User Token（机器专用、不绑个人号）；固定服务器 IP；限速 + 每天定时拉 1~2 次。⚠️ 禁止把 puppeteer 用于任何广告后台。 |
| **2. PC + 手机端适配** | 响应式网页看板：CSS Grid/Flex + 媒体查询；图表用 ECharts（移动端触摸/手势友好）；图表容器 `max-width:100%` 自适应。纯网页，两端通吃。 |
| **3. 维度/颗粒度可选，且对齐在跑广告** | 层级 `level`（account/campaign/adset·adgroup/ad）+ 拆分维度 `breakdowns`（region/date/placement/age/gender）暴露成下拉框，映射到各平台参数。 |
| **4. 只做对比 + 输出结论 + 调整建议** | 对比归因引擎：基于 `CPC = CPM / (1000 × CTR)` 做数学分解，定位单价上涨主因（竞价变贵 vs 素材疲劳），规则引擎给出建议。历史数据沉淀足够后再上 ML。 |

## 架构

```
Meta / Google / TikTok 官方只读 API  ──►  采集器(各写一次)
                                          │  统一翻译成 AdMetricDaily
                                          ▼
                                   MongoDB（每天快照，永久归档）
                                          │
                     ┌────────────────────┼────────────────────┐
                     ▼                                          ▼
             对比归因引擎(attribution)                   响应式网页看板(web)
             CPM/CPC/CTR 分解 → 结论/建议                 维度下拉 + 波动图表
```

## 快速开始（第一期已可跑）

```bash
cd ad-optimizer
npm install
npx ts-node src/analyze.ts        # 分析 samples/ 下的 CSV，打印结论并生成 web/data.js
# 然后浏览器直接打开 web/index.html 看图表
```

用你自己的数据：把后台导出的 CSV 放进 `samples/`（或 `npx ts-node src/analyze.ts 你的.csv`）即可。
列名会自动容错匹配（见 `src/importer/csv.ts` 的 ALIASES），支持中英文表头。

## 目录结构

```
ad-optimizer/
├── src/
│   ├── model/adMetric.ts        # 统一数据模型 AdMetricDaily（多平台/多维度）
│   ├── analysis/
│   │   ├── attribution.ts       # 对比归因引擎（CPM/CPC/CTR 分解）★核心
│   │   ├── fluctuation.ts       # 波动分析（均线/标准差带/Z-score 异常）
│   │   └── pipeline.ts          # 分维度切周期 → 归因+波动 → 报告
│   ├── importer/
│   │   ├── parseCsv.ts          # 零依赖 CSV 解析
│   │   └── csv.ts               # 别名容错映射 + 平台自动识别
│   ├── collectors/              # 第二期：三平台官方只读 API 采集器（stub）
│   │   ├── meta.ts  google.ts  tiktok.ts
│   ├── analyze.ts               # 入口：CSV → 报告 → web/data.js
│   └── demo.ts                  # 纯代码演示
├── samples/                     # 示例 CSV（Meta / Google 导出格式）
├── web/index.html               # 响应式看板（PC + 手机，零依赖 SVG 图表）
└── extension/                   # Chrome/Edge 浏览器插件（MV3 侧边栏）★
    ├── manifest.json  background.js
    ├── sidepanel.html  sidepanel.js
    └── engine.js                # 由 src/ TS 核心移植的浏览器原生引擎
```

## 浏览器插件（桌面）

`extension/` 是一个 Manifest V3 侧边栏插件：拖入 CSV → 本地累积去重 → 波动对比 + 结论 + 建议。
**零封号风险**：不申请任何广告平台页面权限、不注入脚本、不爬后台，数据不出本机。
安装与用法见 `extension/README.md`。手机端用 `web/` 看板（同一套引擎）。

## 落地路线

- **第一期（现在）**：统一模型 + 对比归因引擎 + 波动分析 + CSV 导入 + 响应式看板。用导出的 CSV 跑通全链路，立刻可用。
- **第二期**：把 CSV 采集换成三家官方只读 API + `node-cron` 每天自动拉。分析与看板代码不用改（都基于统一模型）。
- **第三期**：历史数据积累 3~6 个月后，训练预测/出价 ML 模型。
