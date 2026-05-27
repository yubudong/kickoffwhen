# KickoffWhen 上线宣发文案

> 计划发布日：Day 15（6/4）。开赛日：6/11。
> **发布前替换占位符**：`{DAYS}` = 距离开赛日的天数（6/4 发就是 7 天，提前发自己换数字）。
> **目标平台**：X (Twitter) / Hacker News / Instagram。Reddit + PTT 放 Day 16。

---

## 🐦 X (Twitter) 首推

### 英文版（主推，定时在 JST 中午 = 美西凌晨 = 美东早晨发，覆盖全球）

```
⚽ World Cup 2026 kicks off in {DAYS} days.

kickoffwhen.com — every match in YOUR local time across Japan, Korea, Taiwan, HK + SE Asia. Night-owl scores so you sleep smart. One-tap calendar add.

Free. No ads. No login. 🌙

https://kickoffwhen.com
```

字数：约 240/280。预留空间放 og:image 自动展开卡片。

---

### 日文版（30 分钟后再发，避免双语推刷屏，定时 JST 19:00 晚高峰）

```
⚽ 2026年 W杯 開幕まであと {DAYS} 日。

kickoffwhen.com を作りました。全104試合を日本時間 + アジア7都市で表示、徹夜価値スコアで「寝るか観るか」が一発でわかる、ワンタップでカレンダー登録。

広告なし、ログイン不要、完全無料 🌙

https://kickoffwhen.com
```

为什么这么写：
- 「を作りました」= 谦逊的「我做了一个」，日本 indie maker Twitter 圈最自然的语气
- 「徹夜価値スコア」用了你网站上自己造的词，保持品牌一致
- 「寝るか観るか」是日语口语化的「睡 or 看」，比直译「sleep or watch」自然
- 「完全無料」放最后压轴 — 日本用户对"免费"敏感

---

## 🍊 Hacker News Show HN

### Title（≤80 字符）

```
Show HN: KickoffWhen – 2026 World Cup local kickoff times for Asia
```

66 字符。

### Body

```
Hi HN, I built kickoffwhen.com to scratch my own itch.

I live in Tokyo. The last World Cup I kept missing matches — I'd wake up and realize the match started 2 hours ago in JST, or I'd plan to stay up for what turned out to be a 5am kickoff. The official FIFA site shows times in CET. Every aggregator I tried was English-only, US-centric, or both.

So I built this:

- Every one of the 104 matches in your local time
- Auto-detects your timezone, manually switchable to 7 Asian cities (JST, KST, CST, SGT, HKT, JKT, BKK)
- A "night-owl score" (1-5 stars) for which late-night matches are actually worth losing sleep over
- One-tap calendar add (ICS)
- 4 languages (EN, JA, KO, ZH-Hant)
- No ads, no login, no tracking beyond aggregate Cloudflare counts

Tech: Astro static build, no JS framework, ~50KB JS total, deployed to Cloudflare Pages. Lighthouse 100/100/100/100 locally. Match data scraped from Wikipedia and manually verified (data accuracy is what I'm most paranoid about — one wrong kickoff time and Japanese football Twitter will eat me alive).

Built in 21 evenings, 4 hours a night, pair-programming with Claude. Happy to talk through any part of the stack or the editorial choices.
```

字数：约 1400 字符。HN 长度合适。

### HN 发帖时间窗口

- **最佳**：美东早 8 点（JST 21:00）发 — 美国白天 + 欧洲下班 + 亚洲晚饭后，三个时区同时活跃
- **次优**：美东 6 点（JST 19:00）— 美国 commute 时间
- **避开**：美东深夜 + 周末 — 首页停留时间短

⚠️ HN 不允许 self-vote、互推。**自己一票别投**。让自然热度推上去。

### 自己回复要准备好的话术

被问技术问题时，准备答案：
- **「Why Astro?」**：Static site for SEO + low traffic cost on Cloudflare's free tier. No need for client-side rendering when the data doesn't change after publish.
- **「How accurate is the data?」**：Manual verify against FIFA's official PDF + cross-check with at least 2 other sources. Will fix any error within hours.
- **「Why night-owl score?」**：It's the actual problem — Asian fans don't need a generic schedule, they need to triage which 3am match is worth it.
- **「Are you going to add X?」**：Maybe after the tournament. Right now it's about kickoff times. (拒绝增加范围，别被 HN 用户拽偏)

---

## 📷 Instagram

### Bio（已在 tonight-checklist.md 里定好，复用）

- 英文：`Know exactly when every 2026 World Cup match starts in YOUR time. 🌙⚽`
- 日文：`2026 W杯 全試合の日本時間スケジュール 🌙⚽`

### Bio 链接

直接放 `https://kickoffwhen.com` —— Day 1 你应该已经设置好了，检查一下。

### Day 15 当天 IG 发什么？

发一张图片帖，复用 og-image.png（1200×630 在 IG 上是横版，会被裁，建议另外做一张 1080×1080 方版）。Day 14 buffer 时间可以补做方版。Caption：

```
2026 World Cup ⚽ — every match in your local time
JST · KST · CST · SGT · HKT

Free, no ads
🔗 link in bio
🌙
```

---

## 📋 Day 15 当天发布顺序（JST 时区）

| 时间 (JST) | 平台 | 内容 |
|---|---|---|
| 10:00 | X 英文 | 首推英文版 |
| 10:30 | HN | Show HN 帖 |
| 11:00 | IG | 主图 + caption |
| 19:00 | X 日文 | 首推日文版（避开和英文版同时发被算重复内容） |
| 21:00-23:00 | 监控 | 看 HN 是否进 front page，X 转发数据 |

---

## ⛔️ Day 15 绝对不要做的事

1. **不要在 HN 帖里加 emoji、加粗、超链接图标** — HN 看到这些会立刻 downvote
2. **不要找朋友互推** — X 是亚洲流量，朋友互推容易被识别为僵尸账号
3. **不要在 X 推里 @ 大 V** — 一开始就被认为是 spam
4. **不要回应任何"这个有人做过了"的评论** — 沉默是最好的回应，让数据说话
5. **不要熬夜监控数据** — 早睡。明天 Day 16 还有 Reddit + PTT 要发
