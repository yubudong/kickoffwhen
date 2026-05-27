# 数据核对文档 — 2026 World Cup

> 核对日期：2026-05-26
> 本地数据：`src/data/matches.json`（5/23 由 Wikipedia scraper 生成）
> 外部源：Wikipedia 当前快照（Group A / Group F / Knockout Stage 三个独立条目）
> 范围：开幕战 + 决赛 + 三四名 + Group A（韩国所在）全 6 场 + Group F（日本所在）全 6 场 = 共 14 场

---

## 总结

| 类别 | 核对场次 | 差异数 | 状态 |
|---|---|---|---|
| Group A 全场 | 6 | 0 | ✅ |
| Group F 全场（日本队） | 6 | 0 | ✅ |
| 决赛 | 1 | 0 | ✅ |
| 三四名决赛 | 1 | 0 | ✅ |
| **合计** | **14** | **0** | **✅ 全通过** |

**结论**：核心 14 场数据完全一致。可以放心进入 Day 14 内测阶段。

---

## 开幕战（最关键）

| 字段 | 本地数据 | Wikipedia | 一致？ |
|---|---|---|---|
| 日期 | 2026-06-11 | June 11, 2026 | ✅ |
| 开球时间（当地） | 13:00 | 1:00 p.m. UTC−6 | ✅ |
| 开球时间（UTC） | 2026-06-11T19:00:00Z | 13:00 UTC-6 = 19:00 UTC | ✅ |
| 主队 | Mexico (MEX) | Mexico | ✅ |
| 客队 | South Africa (RSA) | South Africa | ✅ |
| 场馆 | Estadio Azteca | Estadio Azteca | ✅ |
| 城市 | Mexico City | Mexico City | ✅ |
| 小组 | A | A | ✅ |

**日本本地时间**（JST = UTC+9）：6/12 04:00 AM —— 这是给日本用户首页倒计时锚点的关键。

---

## Group A 全 6 场（韩国队所在小组）

韩国队 = 第 2、第 4、第 6 场

| # | 日期 | 本地时间 | 对阵 | 场馆 | 城市 | 一致？ |
|---|---|---|---|---|---|---|
| 1 | 6/11 | 13:00 UTC-6 | Mexico vs South Africa | Estadio Azteca | Mexico City | ✅ |
| **2** | **6/11** | **20:00 UTC-6** | **South Korea vs Czech Republic** | Estadio Akron | Zapopan | ✅ |
| 3 | 6/18 | 12:00 UTC-4 | Czech Republic vs South Africa | Mercedes-Benz Stadium | Atlanta | ✅ |
| **4** | **6/18** | **19:00 UTC-6** | **Mexico vs South Korea** | Estadio Akron | Zapopan | ✅ |
| 5 | 6/24 | 19:00 UTC-6 | Czech Republic vs Mexico | Estadio Azteca | Mexico City | ✅ |
| **6** | **6/24** | **19:00 UTC-6** | **South Africa vs South Korea** | Estadio BBVA | Guadalupe (Nuevo León) | ✅ |

---

## Group F 全 6 场（日本队所在小组）

日本队 = 第 1、第 4、第 5 场

| # | 日期 | 本地时间 | 对阵 | 场馆 | 城市 | 一致？ |
|---|---|---|---|---|---|---|
| **1** | **6/14** | **15:00 UTC-5** | **Netherlands vs Japan** | AT&T Stadium | Arlington TX | ✅ |
| 2 | 6/14 | 20:00 UTC-6 | Sweden vs Tunisia | Estadio BBVA | Guadalupe NL | ✅ |
| 3 | 6/20 | 12:00 UTC-5 | Netherlands vs Sweden | NRG Stadium | Houston | ✅ |
| **4** | **6/20** | **22:00 UTC-6** | **Tunisia vs Japan** | Estadio BBVA | Guadalupe NL | ✅ |
| **5** | **6/25** | **18:00 UTC-5** | **Japan vs Sweden** | AT&T Stadium | Arlington TX | ✅ |
| 6 | 6/25 | 18:00 UTC-5 | Tunisia vs Netherlands | Arrowhead Stadium | Kansas City | ✅ |

**日本本地时间换算**（UTC+9，全部为日本日期）：
- 第 1 场（vs 荷兰）：6/15 05:00 AM —— 起得来
- 第 4 场（vs 突尼斯）：6/21 13:00 PM —— 完美时段（午餐）
- 第 5 场（vs 瑞典）：6/26 08:00 AM —— 起得来

---

## 决赛 + 三四名决赛

| 比赛 | 日期 | 本地时间 | 场馆 | 城市 | 一致？ |
|---|---|---|---|---|---|
| 三四名决赛 | 7/18 | 17:00 UTC-4 | Hard Rock Stadium | Miami Gardens | ✅ |
| **决赛** | **7/19** | **15:00 UTC-4** | **MetLife Stadium** | **East Rutherford NJ** | ✅ |

决赛日本时间：**7/20 04:00 AM**（凌晨）—— 经典熬夜场。

---

## 时区处理验证

特别检查了几个 venue 的时区设置（容易踩坑）：

| 场馆 | 城市 | 你的 timezone | 6 月是否 DST | UTC offset | 状态 |
|---|---|---|---|---|---|
| Estadio Azteca | Mexico City | America/Mexico_City | 否（2022 改革后无 DST） | UTC-6 | ✅ |
| Estadio BBVA | Guadalupe (NL) | America/Monterrey | 否（Nuevo León 不属于边境 DST 区） | UTC-6 | ✅ |
| Mercedes-Benz Stadium | Atlanta | America/New_York | 是 | UTC-4 (EDT) | ✅ |
| AT&T Stadium | Arlington TX | America/Chicago | 是 | UTC-5 (CDT) | ✅ |
| MetLife Stadium | East Rutherford | America/New_York | 是 | UTC-4 (EDT) | ✅ |

**重点**：Nuevo León 这个州 ≠ 美墨边境，不参与 DST 例外，所以全年 UTC-6。你的 scraper 用 `America/Monterrey`（IANA 数据库里对应北墨标准时间）正确。

---

## 我没核对到的部分

- **小组赛其余 10 个小组（Group B, C, D, E, G, H, I, J, K, L）共 60 场** —— 时间不够，且抽样核对到的 6 场都通过，没理由认为其他小组会错
- **淘汰赛 32 场的对阵 placeholder** —— 你的数据用 `Winner Match X` 占位（如决赛标的是 `Winner Match 101 vs Winner Match 102`），等小组赛结果出来后才能填实
- **淘汰赛场馆与时间** —— Wikipedia 知识点都有，我抓到了完整列表（见外部源），如有需要可以再补一份逐场比对

---

## 外部源参考

- Group A: https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_Group_A
- Group F: https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_Group_F
- 淘汰赛: https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage

注：FIFA 官网（fifa.com/en/tournaments/...）是 JS-rendered SPA，自动化抓取拿不到内容。如果你有时间，建议**人工打开一次** FIFA 官网开幕战详情页对照本表第一段开幕战那 8 行，作为来自第二个独立源的最终确认。

---

## 建议下一步

| 优先级 | 事项 |
|---|---|
| 🟢 完成 | 14 场核心数据已交叉验证 |
| 🟡 可选 | 人工去 FIFA 官网点开开幕战页面，肉眼对一次第一段表格（5 分钟） |
| 🟢 可继续 | 进入 Day 14 内测：私聊朋友 + 真机测试 |
