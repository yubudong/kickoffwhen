# 站点上线前后数据观察 SOP

> 适用场景：独立开发者上线一个新站点（内容站 / SaaS Landing / 工具站），需要从"上线前 buffer 期"到"流量稳定期"系统观察 SEO + 变现数据。
> 工具栈：**Google Search Console (GSC)** + **Google AdSense**（如接广告）+ **Cloudflare Web Analytics**（可选，无 Cookie 的隐私友好分析）。

---

## 目录

1. [三个工具各管什么](#三个工具各管什么)
2. [三阶段框架](#三阶段框架)
3. [每日 5 分钟 SOP](#每日-5-分钟-sop)
4. [手动操作清单（罕见但要会）](#手动操作清单罕见但要会)
5. [关键概念与原理](#关键概念与原理)
6. [常见误区](#常见误区)
7. [心态守则：Buffer 期纪律](#心态守则buffer-期纪律)
8. [快速链接](#快速链接)

---

## 三个工具各管什么

记忆口诀：**GSC = 上游（Google 视角）** / **AdSense = 收入** / **Analytics = 用户**。

| 工具 | 看什么 | 一句话翻译 | 数据延迟 |
|---|---|---|---|
| **GSC** | Google 怎么看你的站 | "我有多少页被收录？哪些被搜到？什么词进来？" | **1-3 天**（不是实时） |
| **AdSense** | 站点变现状态 | "广告投了吗？挣了多少？" | 数小时（每日数据次日定版） |
| **CF Web Analytics** | 真实用户行为 | "谁访问？停留多久？跳出多少？" | 接近实时（5-15 分钟） |

**三者关系**：
- GSC 是"漏斗最上游"——决定有没有曝光机会
- Analytics 是"中游"——决定来了多少人 + 做了什么
- AdSense 是"下游"——决定流量能变多少钱

---

## 三阶段框架

### Phase 1：上线前 buffer 期

> 站点已部署上线（CF Pages / Vercel / Netlify 等），但**未公开宣发**（没发推、没投朋友圈、没上 HN）。

**目标**：确认 Google 能正常抓取索引，无错误。**不要期待流量**。

| 看哪 | 健康基线 | 异常时怎么办 |
|---|---|---|
| GSC → 页面 → 已编入索引 | 每天**缓慢增长**（不会一夜全索引完）| 30 天内 < 50 页 → 检查 sitemap |
| GSC → 页面 → 未编入索引 | 各类原因总和 < 站点总页数 | 出现"服务器错误 (5xx)" → 检查 hosting；"重定向错误" → 检查 trailingSlash 配置 |
| GSC → Sitemap → 状态 | "成功"绿色 | "无法获取" → 检查 sitemap URL 可访问；"无效" → 检查 XML 格式 |
| GSC → 效果 → 展示次数 | **几乎为 0** | 这是正常的，**不要尝试干预** |
| AdSense → 通知 | "您的网站已验证" | 24h 后还显示"未检测到代码" → 检查 publisher script 是否在每页 `<head>` |

### Phase 2：上线 + 早期流量

> 公开宣发后 0-2 周。X/Reddit/HN/IG 等渠道开始有人点链接进来。

**目标**：观察自然流量曲线，发现意外查询词。

| 看哪 | 健康基线 |
|---|---|
| GSC → 效果 → 展示次数曲线 | **上升趋势**（即使绝对值小） |
| GSC → 效果 → 热门查询 | 出现你**预期外**的关键词（这是金矿）|
| GSC → 效果 → 热门页面 | 通常首页 + 几个"招牌内容页" |
| GSC → 效果 → 平均位置 | 新站 > 10 正常 |
| GSC → 效果 → 平均 CTR | 1-3%（行业基线） |
| AdSense → 收入仪表盘 | $0-2/天起步 |
| AdSense → 账户状态 | "正在审核" → 转为"已通过"通常在 1-4 周 |

### Phase 3：稳定期

> 流量稳定，开始有可观察规律（如比赛日峰值、周末峰值等）。

**目标**：找放大杠杆，优化高 CTR 低排名页。

| 看哪 | 优化机会 |
|---|---|
| GSC → 效果 → 平均位置 **5-15** 的查询 | "努一把就上首页"的 sweet spot——优化标题、增加内链、补充内容深度 |
| GSC → 高展示 + 低 CTR 的页 | 标题写得不吸引，改 meta title |
| GSC → 高 CTR + 低位置的页 | 内容有竞争力但排名差，做反向链接 |
| AdSense → 各广告单元收入分布 | 哪种格式赚得多？调整其他位置向这个收敛 |
| CF Analytics → 跳出率 | > 80% 异常，看是不是某种设备 / 浏览器有 bug |

---

## 每日 5 分钟 SOP

> 上线后 30-90 天每天执行。**目的不是"发现问题"，而是"确认没事故"**。

### Step 1：GSC（3 分钟）

打开 https://search.google.com/search-console，选你的资源。

| # | 操作 | 看什么 | 通过标准 |
|---|---|---|---|
| 1 | 左栏 → **效果** | 总展示次数 + 总点击次数曲线 | Phase 1 都是 0 正常；Phase 2+ 应有数字 |
| 2 | 左栏 → **页面** | 已编入索引 / 未编入索引比例 | 已编入应**单调递增** |
| 3 | 左栏 → **Sitemap** | sitemap-index.xml 状态 | "成功" |
| 4 | 顶部 → **快速搜索框** | 偶尔粘贴一个核心 URL 检查 | 显示"网址在 Google 上" |

### Step 2：AdSense（30 秒）

打开 https://adsense.google.com。

| # | 操作 | 看什么 | 通过标准 |
|---|---|---|---|
| 1 | 右上角 🔔 | 有无新通知 | 无 = 一切正常 |
| 2 | 首页仪表盘 | 今日预估收入 | 看个数字，不做反应 |
| 3 | 账户状态徽章 | "已通过 / 正在审核 / 受限" | 任何变化截图记录 |

### Step 3（可选）：CF Analytics（1 分钟）

打开 Cloudflare → 网站 → Analytics。

| # | 看什么 | 关注 |
|---|---|---|
| 1 | Page views 曲线 | 与昨天对比，无大跌 |
| 2 | Top pages | 哪些页面被访问最多 |
| 3 | Status codes | 4xx / 5xx 比例 < 1% |

### Step 4：5 分钟硬截止

**写下今天的发现 / 不写也行 → 关掉浏览器 → 该干嘛干嘛**。

⚠️ **如果你想多看 5 分钟，是 buffer 纪律出问题了**，不是数据。立刻关。

---

## 手动操作清单（罕见但要会）

### A. 强制 Google 重新索引某页

**何时用**：某个核心页 30 天都不在索引列表里，且明知页面没问题。

| # | 步骤 |
|---|---|
| 1 | GSC 顶部搜索栏粘贴 URL（完整 https://...）|
| 2 | 看 GSC 给的状态报告 |
| 3 | 如显示"未编入索引"且无明显错误 → 点 **"请求编入索引"** |
| 4 | 等 1-7 天 |

**限制**：一天只能请求约 10-12 个 URL，所以挑核心页用。

### B. 重新提交 Sitemap

**何时用**：sitemap 状态显示"无法获取"或长时间"挂起"。

| # | 步骤 |
|---|---|
| 1 | GSC → Sitemap |
| 2 | 找到你的 sitemap（如 `sitemap-index.xml`），点⋮ → 删除 |
| 3 | 顶部"添加新的 sitemap" → 粘贴完整路径 |
| 4 | 等 5-15 分钟，状态应变"成功" |

### C. 移除被错误编入索引的页

**何时用**：发现 `?debug=1`、`/preview/` 之类的脏 URL 被索引了。

| # | 步骤 |
|---|---|
| 1 | GSC → 编入索引 → 删除 |
| 2 | 选"临时删除"（180 天），输入 URL |
| 3 | 同时修代码 / robots.txt 防止再被抓 |

### D. 验证手机端体验

**何时用**：怀疑某页移动端有 bug。

| # | 步骤 |
|---|---|
| 1 | GSC → 体验 → 移动设备易用性 |
| 2 | 看错误列表 |
| 3 | 修代码后回来点"验证修复" |

### E. 提交 robots.txt 给 Google 重读

**何时用**：你刚改了 robots.txt 想立刻生效（默认 Google 也是几小时内自动重读，这步只是加速）。

| # | 步骤 |
|---|---|
| 1 | GSC → 设置 → 抓取统计信息 → robots.txt → 请求重新抓取 |

---

## 关键概念与原理

### 1. Index ≠ Rank ≠ Traffic（三个独立阶段）

```
你的页面被 Google 收录 (Index)
        ↓
当用户搜某个词，你的页面以第几位出现 (Rank)
        ↓
用户实际点击你的链接 (Traffic)
```

每一步都可能卡住：
- **未被 Index**：Google 都没收录你 → 看 GSC "已编入索引"页数
- **Index 了但 Rank 差**：被收录但排在 50 名外 → 看 GSC "平均位置"
- **Rank 不错但 Traffic 少**：排在前 10 但没人点 → 看 GSC "CTR"

**每一步对应不同优化策略**，不要混淆。

### 2. Lighthouse 100/100/100/100 ≠ SEO 一定好

| Lighthouse 评分项 | 实际意义 |
|---|---|
| Performance | 加载快慢 |
| Accessibility | 残障辅助 |
| Best Practices | HTML / 安全等技术规范 |
| **SEO** | **基础 SEO 检查**（meta title / description / robots / canonical）—— **只是入门门槛**，不代表排名 |

Lighthouse SEO 100 只保证你"没有低级错误"，**不保证排名**。排名靠：内容质量 + 外链 + 用户行为信号 + 域名权威。

### 3. GSC 数据有 1-3 天延迟

| GSC 数据 | 延迟 |
|---|---|
| 效果数据（展示、点击）| **2-3 天** |
| 覆盖率（索引状态）| **几小时到几天** |
| URL 检查 | 接近实时 |
| Sitemap 状态 | 几小时 |

所以**今天的运营动作影响要 3 天后才看得到**。**不要急**。

### 4. AdSense 审核期 vs 投放期

```
注册账户 (你做)
   ↓
添加站点 + 嵌入 publisher script (你做)
   ↓
站点验证 [自动] ←──── 24-48h
   ↓
内容/政策审核 [人工 + 自动] ←─── 1-4 周
   ↓
审核通过，开始投放广告
   ↓
首次满 $100 → 提款门槛
   ↓
PIN 卡寄达国内 ←──── 3-6 周
   ↓
输入 PIN 验证地址
   ↓
首次提款（到 PingPong / Payoneer / Wise 等）
```

**完整闭环要 1-3 个月**，所以越早注册越好。

### 5. trailingSlash 配置必须前后一致

如果站点用 `trailingSlash: 'always'`，那：
- 内链全部带 `/`
- canonical 全部带 `/`
- sitemap 全部带 `/`
- GSC 提交时全部带 `/`

任一处不一致 → Google 把同一页当成两个，分散权重，索引重复。**这是新手站点最常见的隐形 SEO bug**。

### 6. ads.txt 必须放（如果接 AdSense / 任何广告）

**ads.txt** = IAB 行业标准，**一行文本**，部署在站点根目录 `https://yoursite.com/ads.txt`。

格式（仅接 AdSense 时）：
```
google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
```

| 字段 | 含义 |
|---|---|
| `google.com` | 授权卖方 |
| `pub-XXXX` | 你的 AdSense 发布商 ID |
| `DIRECT` | 你与 Google 直接关系 |
| `f08c47fec0942fa0` | Google 在 IAB 的固定认证编号（**所有 AdSense 用户共用这一串**） |

**为什么必须放**：没有 ads.txt → 广告买家不确认你是真授权方 → 跳过竞价或出低价 → **收入损失 5-20%**。

**Astro 站操作**：`public/ads.txt` 单文件，部署后自动出现在域名根。CF Pages / Vercel / Netlify 都直接服务，无需配置。

**多家广告网络场景**：每家一行，比如：
```
google.com, pub-XXXX, DIRECT, f08c47fec0942fa0
mediavine.com, 12345, DIRECT
ezoic.com, 67890, DIRECT
```

**AdSense 后台显示状态**：
- "未找到" → 文件没部署 / 路径错
- "无效" → 格式错 / publisher ID 不对
- "已授权" → 通过，等 24-48h 自动检测

### 7. robots.txt 的覆盖关系

如果你站托管在 Cloudflare Pages，**CF 会强制注入自定义 robots.txt**（包含 `Content-Signal` 等指令），覆盖你 `public/robots.txt` 里的内容。

- 线上 robots.txt **不是仓库里那份**
- Lighthouse 可能标"未知指令"警告 → **不影响真实 SEO**
- Google / Bing 实际认 CF 注入的指令

类似的覆盖关系还有：Vercel 注入 headers、Netlify 注入 `_redirects` 等。**部署前确认平台是否在你不知情的情况下加东西**。

### 8. 与 ads.txt 的关系不要混

| 文件 | 用途 | 平台是否覆盖 |
|---|---|---|
| `robots.txt` | 告诉搜索引擎"哪些页可抓" | **CF Pages 会覆盖**（注入 Content-Signal 等） |
| `ads.txt` | 告诉广告买家"谁授权售卖" | **不被覆盖**，按你写的内容直接服务 |
| `sitemap.xml` | 告诉搜索引擎"我有哪些页" | 不被覆盖 |
| `humans.txt` | 装饰性（可不放）| 不被覆盖 |

---

## 常见误区

| 误区 | 真相 |
|---|---|
| "我刚上线 1 周，怎么 GSC 还没数据？" | 数据有 1-3 天延迟 + 早期流量本就小 |
| "我的页面被收录但搜不到 = Google 不喜欢" | 大概率是排名靠后（50 名外），不是被惩罚 |
| "AdSense 还没通过我得催客服" | **没有催的渠道**，等就完了 |
| "我每天看 GSC 5 分钟还嫌不够" | 数据没那么快变化，看多了纯焦虑消耗 |
| "Lighthouse 100 我就稳了" | Lighthouse 是技术分，**不是商业分** |
| "404 页越多越糟" | 几个 404 完全正常，大量 404 才是问题 |
| "我得每天 ping 一下 sitemap 让 Google 抓" | sitemap 已经在那，Google 会自己抓，**ping 没用** |
| "提交 URL 检查 → 立刻请求编入索引"批量做 | 每天 quota 有限（10-12 个），别用在边缘页上 |

---

## 心态守则：Buffer 期纪律

> 这是这份 SOP 最难执行的部分。

| 心理冲动 | 怎么处理 |
|---|---|
| "这 5 分钟我能再优化点啥？" | ❌ **不能**。记到 P1 笔记本，特定时机统一处理 |
| "数据没动是不是哪里错了？" | ✅ 早期数据稀疏是常态，错的概率 < 5% |
| "我朋友说 X 体验不好，要不连夜改？" | 🟡 分级：**致命** bug 立即改；**体验**类记下来，统一一次性改 |
| "AdSense 还没通过，要不调下设置？" | ❌ 调整设置会触发**重新审核**，**保持不动反而最快** |
| "我每天看 GSC 数据 5 次就能领先" | ❌ Google 不奖励"焦虑"，奖励"内容质量 + 时间" |

**核心原则**：上线后 7 天内**除非紧急 bug**，否则**保持 zero commit**。让代码稳定 → 让 Google 慢慢吃下去 → 让数据慢慢长出来。

---

## 快速链接

| 工具 | URL | 适用场景 |
|---|---|---|
| Google Search Console | https://search.google.com/search-console | 索引 + 搜索数据 |
| Google AdSense | https://adsense.google.com | 广告收入 |
| Cloudflare Dashboard | https://dash.cloudflare.com | DNS / Pages / Analytics |
| Cloudflare Web Analytics | https://dash.cloudflare.com → 选站 → Analytics | 用户行为 |
| Bing Webmaster Tools | https://www.bing.com/webmasters | Bing 索引（约占搜索流量 3-5%） |
| Naver Search Advisor | https://searchadvisor.naver.com | 韩国市场 |
| Google PageSpeed Insights | https://pagespeed.web.dev | 性能 + Core Web Vitals |
| Lighthouse (Chrome DevTools) | F12 → Lighthouse | 本地性能 / SEO / A11y 跑分 |
| Rich Results Test | https://search.google.com/test/rich-results | 验证结构化数据 |
| hreflang Tags Testing Tool | https://www.aleydasolis.com/english/international-seo-tools/hreflang-tags-generator/ | 多语种站点 |
| Mobile-Friendly Test | https://search.google.com/test/mobile-friendly | 已合并到 GSC，独立工具仅做快速检查 |
| WebPageTest | https://www.webpagetest.org | 第三方真机性能测试 |
| AdSense Help | https://support.google.com/adsense | AdSense 政策 / 申诉 |

---

## 上线前后的里程碑日历（参考）

| Day | 状态 | 你应该看到的 |
|---|---|---|
| Day 0（上线日）| 站点公开 | CF Analytics 立刻有数据；GSC 还是空的 |
| Day 1-2 | 早期访问 | Analytics 显示几十-几百 PV；GSC 还是空的 |
| Day 3 | GSC 开始有数据 | "效果"页面出现展示次数（个位数） |
| Day 7 | 索引推进 | "已编入索引"页数 > 一半 |
| Day 14 | 排名形成 | 出现"平均位置"数字，但通常 > 20 |
| Day 30 | AdSense 通过（如果通过）| 开始有广告收入 |
| Day 60 | 长尾词进来 | 出现意料外的查询词，是优化金矿 |
| Day 90 | 数据完整 | 可以做趋势分析了 |

**新站排名稳定需要 3-6 个月，请耐心**。

---

## 总结：这份 SOP 想让你养成的习惯

1. **每天 5 分钟，不多看**
2. **数据看趋势不看绝对值**（除非有明显异常）
3. **手动操作只在罕见情况用**，平时纯观察
4. **理解 1-3 天延迟，不当天评估当天动作**
5. **buffer 期 zero commit 是最难也最重要的纪律**

> 这是工具站 / 内容站上线后最值钱的 30-90 天，别用焦虑动作填满它。
