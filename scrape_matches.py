"""
2026 FIFA World Cup 赛程抓取脚本 v2
==================================

从 Wikipedia 的 div.footballbox（Schema.org SportsEvent microdata）抓取
完整 104 场比赛数据，转换为前端友好的 JSON。

为什么 v2：
    Wikipedia 在 2025 年间把 <table class="footballbox"> 改成了
    <div class="footballbox">，并加入了 itemprop microdata。
    legacy 版本基于 <table> + 正则匹配，已经完全失效。
    v2 用 BeautifulSoup 选 div.footballbox + itemprop 抓取，
    解析准确性接近 100%。

用法:
    .venv/bin/python scrape_matches.py

输出:
    src/data/matches.json
    src/data/venues.json
    src/data/teams.json

数据可靠性:
    - 小组赛 72 场：球队 + 时间 + 场地 全部明确
    - 淘汰赛 32 场：场地 + 时间确定，对阵会写成 "Winner Group A" 等占位
      （小组赛结束后 Wikipedia 会更新对阵，到时重跑此脚本即可）

注意:
    - VENUES 表内置在脚本中，时区是 IANA 格式
    - kickoff_utc 字段会自动计算（datetime + 场馆 tz → UTC ISO）
"""

import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("缺少依赖,请先运行:.venv/bin/pip install requests beautifulsoup4 lxml")
    sys.exit(1)


WIKI_URL = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup"
HEADERS = {
    "User-Agent": "KickoffWhen-Scraper/2.0 (https://kickoffwhen.com; non-commercial fan tool)"
}


# --- 球队实力分级（用于 match_appeal 预计算）---
# 这是 KickoffWhen 的主观分级，不是官方排名，目的是让"熬夜评分"对球迷有意义
TEAM_TIER = {
    # TIER S — 公认顶级（夺冠热门）
    "ARG": 1.0, "BRA": 1.0, "FRA": 1.0, "ENG": 1.0,
    # TIER A — 传统强队 / 上届八强
    "GER": 0.6, "ESP": 0.6, "POR": 0.6, "NED": 0.6,
    "BEL": 0.6, "CRO": 0.6, "URU": 0.6, "MAR": 0.6,
    # TIER B — 黑马 / 北中美洲东道主 / 亚洲焦点
    "JPN": 0.3, "KOR": 0.3, "USA": 0.3, "MEX": 0.3,
    "SUI": 0.3, "SWE": 0.3,
    # 其他 28 队默认 0
}

STAGE_WEIGHT = {
    "group":         0.0,
    "round-of-32":   1.0,
    "round-of-16":   1.5,
    "quarter-final": 2.0,
    "semi-final":    2.5,
    "third-place":   1.0,
    "final":         3.0,
}


def calc_match_appeal(home_code: str | None, away_code: str | None, stage: str, matchday: int | None) -> float:
    """
    中立比赛吸引力（不含 personalBoost / sleepPain）。
    Raw 值不封顶，前端做最终 clamp。预计算到 matches.json，前端不重复算。
    """
    score = 2.0  # 基础分（任何 FIFA World Cup 比赛起步）
    score += TEAM_TIER.get(home_code or "", 0.0)
    score += TEAM_TIER.get(away_code or "", 0.0)
    score += STAGE_WEIGHT.get(stage, 0.0)
    if stage == "group" and matchday == 3:
        score += 0.5  # potential stakes（出线悬念，未必每场都有）
    return round(score * 2) / 2  # 保留 0.5 精度


# 48 支参赛队 — Wikipedia 英文名 → 我们的内部数据
# 球队抽签后已确定（2025-12-05），名字以 Wikipedia 2026_FIFA_World_Cup 页面为准
TEAMS = {
    # 东道主 + 北美
    "Canada":                  {"code": "CAN", "slug": "canada",             "name_ja": "カナダ",       "name_ko": "캐나다",       "name_zh": "加拿大",     "flag": "🇨🇦"},
    "Mexico":                  {"code": "MEX", "slug": "mexico",             "name_ja": "メキシコ",     "name_ko": "멕시코",       "name_zh": "墨西哥",     "flag": "🇲🇽"},
    "United States":           {"code": "USA", "slug": "united-states",      "name_ja": "アメリカ",     "name_ko": "미국",         "name_zh": "美國",       "flag": "🇺🇸"},
    "Panama":                  {"code": "PAN", "slug": "panama",             "name_ja": "パナマ",       "name_ko": "파나마",       "name_zh": "巴拿馬",     "flag": "🇵🇦"},
    "Curaçao":                 {"code": "CUW", "slug": "curacao",            "name_ja": "キュラソー",   "name_ko": "퀴라소",       "name_zh": "庫拉索",     "flag": "🇨🇼"},
    "Haiti":                   {"code": "HAI", "slug": "haiti",              "name_ja": "ハイチ",       "name_ko": "아이티",       "name_zh": "海地",       "flag": "🇭🇹"},
    # 南美
    "Argentina":               {"code": "ARG", "slug": "argentina",          "name_ja": "アルゼンチン", "name_ko": "아르헨티나",   "name_zh": "阿根廷",     "flag": "🇦🇷"},
    "Brazil":                  {"code": "BRA", "slug": "brazil",             "name_ja": "ブラジル",     "name_ko": "브라질",       "name_zh": "巴西",       "flag": "🇧🇷"},
    "Colombia":                {"code": "COL", "slug": "colombia",           "name_ja": "コロンビア",   "name_ko": "콜롬비아",     "name_zh": "哥倫比亞",   "flag": "🇨🇴"},
    "Ecuador":                 {"code": "ECU", "slug": "ecuador",            "name_ja": "エクアドル",   "name_ko": "에콰도르",     "name_zh": "厄瓜多",     "flag": "🇪🇨"},
    "Paraguay":                {"code": "PAR", "slug": "paraguay",           "name_ja": "パラグアイ",   "name_ko": "파라과이",     "name_zh": "巴拉圭",     "flag": "🇵🇾"},
    "Uruguay":                 {"code": "URU", "slug": "uruguay",            "name_ja": "ウルグアイ",   "name_ko": "우루과이",     "name_zh": "烏拉圭",     "flag": "🇺🇾"},
    # 欧洲
    "Austria":                 {"code": "AUT", "slug": "austria",            "name_ja": "オーストリア", "name_ko": "오스트리아",   "name_zh": "奧地利",     "flag": "🇦🇹"},
    "Belgium":                 {"code": "BEL", "slug": "belgium",            "name_ja": "ベルギー",     "name_ko": "벨기에",       "name_zh": "比利時",     "flag": "🇧🇪"},
    "Bosnia and Herzegovina":  {"code": "BIH", "slug": "bosnia-and-herzegovina", "name_ja": "ボスニア・ヘルツェゴビナ", "name_ko": "보스니아 헤르체고비나", "name_zh": "波士尼亞與赫塞哥維納", "flag": "🇧🇦"},
    "Croatia":                 {"code": "CRO", "slug": "croatia",            "name_ja": "クロアチア",   "name_ko": "크로아티아",   "name_zh": "克羅埃西亞", "flag": "🇭🇷"},
    "Czech Republic":          {"code": "CZE", "slug": "czech-republic",     "name_ja": "チェコ",       "name_ko": "체코",         "name_zh": "捷克",       "flag": "🇨🇿"},
    "England":                 {"code": "ENG", "slug": "england",            "name_ja": "イングランド", "name_ko": "잉글랜드",     "name_zh": "英格蘭",     "flag": "🏴󠁧󠁢󠁥󠁮󠁧󠁿"},
    "France":                  {"code": "FRA", "slug": "france",             "name_ja": "フランス",     "name_ko": "프랑스",       "name_zh": "法國",       "flag": "🇫🇷"},
    "Germany":                 {"code": "GER", "slug": "germany",            "name_ja": "ドイツ",       "name_ko": "독일",         "name_zh": "德國",       "flag": "🇩🇪"},
    "Netherlands":             {"code": "NED", "slug": "netherlands",        "name_ja": "オランダ",     "name_ko": "네덜란드",     "name_zh": "荷蘭",       "flag": "🇳🇱"},
    "Norway":                  {"code": "NOR", "slug": "norway",             "name_ja": "ノルウェー",   "name_ko": "노르웨이",     "name_zh": "挪威",       "flag": "🇳🇴"},
    "Portugal":                {"code": "POR", "slug": "portugal",           "name_ja": "ポルトガル",   "name_ko": "포르투갈",     "name_zh": "葡萄牙",     "flag": "🇵🇹"},
    "Scotland":                {"code": "SCO", "slug": "scotland",           "name_ja": "スコットランド", "name_ko": "스코틀랜드",   "name_zh": "蘇格蘭",     "flag": "🏴󠁧󠁢󠁳󠁣󠁴󠁿"},
    "Spain":                   {"code": "ESP", "slug": "spain",              "name_ja": "スペイン",     "name_ko": "스페인",       "name_zh": "西班牙",     "flag": "🇪🇸"},
    "Sweden":                  {"code": "SWE", "slug": "sweden",             "name_ja": "スウェーデン", "name_ko": "스웨덴",       "name_zh": "瑞典",       "flag": "🇸🇪"},
    "Switzerland":             {"code": "SUI", "slug": "switzerland",        "name_ja": "スイス",       "name_ko": "스위스",       "name_zh": "瑞士",       "flag": "🇨🇭"},
    "Turkey":                  {"code": "TUR", "slug": "turkey",             "name_ja": "トルコ",       "name_ko": "튀르키예",     "name_zh": "土耳其",     "flag": "🇹🇷"},
    # 非洲
    "Algeria":                 {"code": "ALG", "slug": "algeria",            "name_ja": "アルジェリア", "name_ko": "알제리",       "name_zh": "阿爾及利亞", "flag": "🇩🇿"},
    "Cape Verde":              {"code": "CPV", "slug": "cape-verde",         "name_ja": "カーボベルデ", "name_ko": "카보베르데",   "name_zh": "維德角",     "flag": "🇨🇻"},
    "DR Congo":                {"code": "COD", "slug": "dr-congo",           "name_ja": "コンゴ民主共和国", "name_ko": "DR콩고",   "name_zh": "剛果民主共和國", "flag": "🇨🇩"},
    "Egypt":                   {"code": "EGY", "slug": "egypt",              "name_ja": "エジプト",     "name_ko": "이집트",       "name_zh": "埃及",       "flag": "🇪🇬"},
    "Ghana":                   {"code": "GHA", "slug": "ghana",              "name_ja": "ガーナ",       "name_ko": "가나",         "name_zh": "迦納",       "flag": "🇬🇭"},
    "Ivory Coast":             {"code": "CIV", "slug": "ivory-coast",        "name_ja": "コートジボワール", "name_ko": "코트디부아르", "name_zh": "象牙海岸", "flag": "🇨🇮"},
    "Morocco":                 {"code": "MAR", "slug": "morocco",            "name_ja": "モロッコ",     "name_ko": "모로코",       "name_zh": "摩洛哥",     "flag": "🇲🇦"},
    "Senegal":                 {"code": "SEN", "slug": "senegal",            "name_ja": "セネガル",     "name_ko": "세네갈",       "name_zh": "塞內加爾",   "flag": "🇸🇳"},
    "South Africa":            {"code": "RSA", "slug": "south-africa",       "name_ja": "南アフリカ",   "name_ko": "남아프리카공화국", "name_zh": "南非",   "flag": "🇿🇦"},
    "Tunisia":                 {"code": "TUN", "slug": "tunisia",            "name_ja": "チュニジア",   "name_ko": "튀니지",       "name_zh": "突尼西亞",   "flag": "🇹🇳"},
    # 亚洲 + 大洋洲
    "Australia":               {"code": "AUS", "slug": "australia",          "name_ja": "オーストラリア", "name_ko": "호주",       "name_zh": "澳洲",       "flag": "🇦🇺"},
    "Iran":                    {"code": "IRN", "slug": "iran",               "name_ja": "イラン",       "name_ko": "이란",         "name_zh": "伊朗",       "flag": "🇮🇷"},
    "Iraq":                    {"code": "IRQ", "slug": "iraq",               "name_ja": "イラク",       "name_ko": "이라크",       "name_zh": "伊拉克",     "flag": "🇮🇶"},
    "Japan":                   {"code": "JPN", "slug": "japan",              "name_ja": "日本",         "name_ko": "일본",         "name_zh": "日本",       "flag": "🇯🇵"},
    "Jordan":                  {"code": "JOR", "slug": "jordan",             "name_ja": "ヨルダン",     "name_ko": "요르단",       "name_zh": "約旦",       "flag": "🇯🇴"},
    "New Zealand":             {"code": "NZL", "slug": "new-zealand",        "name_ja": "ニュージーランド", "name_ko": "뉴질랜드", "name_zh": "紐西蘭",     "flag": "🇳🇿"},
    "Qatar":                   {"code": "QAT", "slug": "qatar",              "name_ja": "カタール",     "name_ko": "카타르",       "name_zh": "卡達",       "flag": "🇶🇦"},
    "Saudi Arabia":            {"code": "KSA", "slug": "saudi-arabia",       "name_ja": "サウジアラビア", "name_ko": "사우디아라비아", "name_zh": "沙烏地阿拉伯", "flag": "🇸🇦"},
    "South Korea":             {"code": "KOR", "slug": "south-korea",        "name_ja": "韓国",         "name_ko": "대한민국",     "name_zh": "南韓",       "flag": "🇰🇷"},
    "Uzbekistan":              {"code": "UZB", "slug": "uzbekistan",         "name_ja": "ウズベキスタン", "name_ko": "우즈베키스탄", "name_zh": "烏茲別克", "flag": "🇺🇿"},
}


# 16 个场馆 → 城市/国家/IANA 时区/slug
VENUES = {
    # United States (11)
    "MetLife Stadium": {"city": "East Rutherford", "country": "USA", "timezone": "America/New_York", "slug": "metlife-stadium"},
    "AT&T Stadium": {"city": "Arlington", "country": "USA", "timezone": "America/Chicago", "slug": "att-stadium"},
    "SoFi Stadium": {"city": "Inglewood", "country": "USA", "timezone": "America/Los_Angeles", "slug": "sofi-stadium"},
    "Mercedes-Benz Stadium": {"city": "Atlanta", "country": "USA", "timezone": "America/New_York", "slug": "mercedes-benz-stadium"},
    "Hard Rock Stadium": {"city": "Miami Gardens", "country": "USA", "timezone": "America/New_York", "slug": "hard-rock-stadium"},
    "NRG Stadium": {"city": "Houston", "country": "USA", "timezone": "America/Chicago", "slug": "nrg-stadium"},
    "Arrowhead Stadium": {"city": "Kansas City", "country": "USA", "timezone": "America/Chicago", "slug": "arrowhead-stadium"},
    "Lumen Field": {"city": "Seattle", "country": "USA", "timezone": "America/Los_Angeles", "slug": "lumen-field"},
    "Levi's Stadium": {"city": "Santa Clara", "country": "USA", "timezone": "America/Los_Angeles", "slug": "levis-stadium"},
    "Gillette Stadium": {"city": "Foxborough", "country": "USA", "timezone": "America/New_York", "slug": "gillette-stadium"},
    "Lincoln Financial Field": {"city": "Philadelphia", "country": "USA", "timezone": "America/New_York", "slug": "lincoln-financial-field"},
    # Mexico (3)
    "Estadio Azteca": {"city": "Mexico City", "country": "MEX", "timezone": "America/Mexico_City", "slug": "estadio-azteca"},
    "Estadio BBVA": {"city": "Monterrey", "country": "MEX", "timezone": "America/Monterrey", "slug": "estadio-bbva"},
    "Estadio Akron": {"city": "Guadalajara", "country": "MEX", "timezone": "America/Mexico_City", "slug": "estadio-akron"},
    # Canada (2)
    "BMO Field": {"city": "Toronto", "country": "CAN", "timezone": "America/Toronto", "slug": "bmo-field"},
    "BC Place": {"city": "Vancouver", "country": "CAN", "timezone": "America/Vancouver", "slug": "bc-place"},
}


def parse_kickoff_time(time_text: str) -> str | None:
    """
    把 "1:00 p.m." / "12:00 noon" / "9:00 a.m." 解析成 24h "HH:MM"
    """
    if not time_text:
        return None
    t = time_text.lower().replace("\xa0", " ").strip()
    # 处理 noon / midnight 特例
    if "noon" in t:
        return "12:00"
    if "midnight" in t:
        return "00:00"
    m = re.match(r"(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.|am|pm)?", t)
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2))
    suffix = (m.group(3) or "").replace(".", "")
    if suffix == "pm" and hour != 12:
        hour += 12
    elif suffix == "am" and hour == 12:
        hour = 0
    return f"{hour:02d}:{minute:02d}"


def to_iso_utc(date_iso: str, time_24h: str, tz: str) -> str | None:
    """把 date+time+tz 转换为 UTC ISO 字符串 like '2026-06-11T19:00:00Z'"""
    if not all([date_iso, time_24h, tz]):
        return None
    try:
        dt_local = datetime.strptime(f"{date_iso} {time_24h}", "%Y-%m-%d %H:%M")
        dt_local = dt_local.replace(tzinfo=ZoneInfo(tz))
        dt_utc = dt_local.astimezone(timezone.utc)
        return dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception as e:
        print(f"  ⚠️  UTC 转换失败 ({date_iso} {time_24h} {tz}): {e}")
        return None


def slugify(s: str) -> str:
    """简单 slug 化：小写、空格变连字符、移除非字母数字"""
    s = s.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_-]+", "-", s)
    return s.strip("-")


def parse_box(box) -> dict | None:
    """从单个 div.footballbox 中抓出一场比赛"""
    # 1) 日期 — 找 .bday span（machine-readable ISO）
    bday = box.find("span", class_="bday")
    if not bday:
        return None
    date_iso = bday.get_text(strip=True)

    # 2) 时间 — .ftime div
    ftime = box.find("div", class_="ftime")
    kickoff_local = parse_kickoff_time(ftime.get_text(" ", strip=True) if ftime else "")

    # 3) 主队 / 客队 — itemprop=homeTeam / awayTeam 里的第一个 <a>
    home_tag = box.find(attrs={"itemprop": "homeTeam"})
    away_tag = box.find(attrs={"itemprop": "awayTeam"})
    home = away = None
    if home_tag:
        a = home_tag.find("a")
        home = a.get_text(strip=True) if a else home_tag.get_text(strip=True)
    if away_tag:
        a = away_tag.find("a")
        away = a.get_text(strip=True) if a else away_tag.get_text(strip=True)

    # 4) 场地 + 城市 — itemprop=location 里有两个 <a>
    loc_tag = box.find(attrs={"itemprop": "location"})
    venue_name = venue_city = None
    if loc_tag:
        links = loc_tag.find_all("a")
        if len(links) >= 1:
            venue_name = links[0].get_text(strip=True)
        if len(links) >= 2:
            venue_city = links[1].get_text(strip=True)

    # 5) Match 编号 + stage（用 match number 判断，比 URL 可靠）
    fscore = box.find("th", class_="fscore")
    match_label = None
    stage_href = None
    if fscore:
        a = fscore.find("a")
        if a:
            match_label = a.get_text(strip=True)
            stage_href = a.get("href", "")

    # 2026 世界杯 104 场结构（48 队制）：
    #   Match  1-72  → 小组赛（12 组 × 6 场）
    #   Match 73-88  → 1/16 决赛（round-of-32，16 场，48 队制独有）
    #   Match 89-96  → 1/8 决赛（round-of-16，8 场）
    #   Match 97-100 → 1/4 决赛（quarter-final，4 场）
    #   Match 101-102→ 半决赛（semi-final，2 场）
    #   Match 103    → 季军赛（third-place）
    #   Match 104    → 决赛（final）
    stage = "unknown"
    group = None
    matchday = None
    match_num = None
    if match_label:
        mn = re.match(r"Match\s+(\d+)", match_label)
        if mn:
            match_num = int(mn.group(1))
    if match_num is not None:
        if match_num <= 72:
            stage = "group"
        elif match_num <= 88:
            stage = "round-of-32"
        elif match_num <= 96:
            stage = "round-of-16"
        elif match_num <= 100:
            stage = "quarter-final"
        elif match_num <= 102:
            stage = "semi-final"
        elif match_num == 103:
            stage = "third-place"
        elif match_num == 104:
            stage = "final"

    # group 字母仍然从链接里抓（仅小组赛阶段）
    if stage == "group" and stage_href:
        gm = re.search(r"Group_([A-L])", stage_href)
        if gm:
            group = gm.group(1)

    # matchday（小组赛轮次）：每组 4 队按 3 轮打，可从 match_num 推算
    # 12 组 × 6 场 = 72，按 Wikipedia 排程，每轮 12*2=24 场
    if stage == "group" and match_num is not None:
        if match_num <= 24:
            matchday = 1
        elif match_num <= 48:
            matchday = 2
        else:
            matchday = 3

    return {
        "date_iso": date_iso,
        "kickoff_local": kickoff_local,
        "home": home,
        "away": away,
        "venue_name": venue_name,
        "venue_city": venue_city,
        "match_label": match_label,
        "stage": stage,
        "group": group,
        "matchday": matchday,
    }


def main():
    print("=" * 60)
    print("KickoffWhen | Wikipedia 2026 FIFA World Cup 抓取 v2")
    print("=" * 60)

    print(f"\n📡 Fetching {WIKI_URL}")
    resp = requests.get(WIKI_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    print(f"   ✅ {len(resp.text)} bytes")

    soup = BeautifulSoup(resp.text, "lxml")
    boxes = soup.find_all("div", class_="footballbox")
    print(f"\n🔍 找到 {len(boxes)} 个 footballbox")

    if not boxes:
        print("❌ 未抓到比赛。退出。")
        sys.exit(1)

    matches = []
    for i, box in enumerate(boxes, 1):
        m = parse_box(box)
        if not m:
            print(f"  ⚠️  box {i} 解析失败")
            continue

        # 计算 UTC 时间
        venue_info = VENUES.get(m["venue_name"] or "", {})
        kickoff_utc = None
        if m["kickoff_local"] and venue_info.get("timezone"):
            kickoff_utc = to_iso_utc(m["date_iso"], m["kickoff_local"], venue_info["timezone"])

        # 生成 match ID
        match_id = f"{m['date_iso']}-{slugify(m['home'] or 'tba')}-vs-{slugify(m['away'] or 'tba')}"

        # 中立比赛吸引力（仅含双队实力 + 阶段 + 出线悬念，不含 personalBoost / sleepPain）
        home_code = (TEAMS.get(m["home"]) or {}).get("code")
        away_code = (TEAMS.get(m["away"]) or {}).get("code")
        match_appeal = calc_match_appeal(home_code, away_code, m["stage"], m["matchday"])

        matches.append({
            "id": match_id,
            "match_label": m["match_label"],
            "date": m["date_iso"],
            "kickoff_local": m["kickoff_local"],
            "kickoff_utc": kickoff_utc,
            "home_team": m["home"],
            "away_team": m["away"],
            "home_code": home_code,
            "away_code": away_code,
            "venue_name": m["venue_name"],
            "venue_city": m["venue_city"],
            "venue_slug": venue_info.get("slug"),
            "venue_timezone": venue_info.get("timezone"),
            "stage": m["stage"],
            "group": m["group"],
            "matchday": m["matchday"],
            "match_appeal": match_appeal,
        })

    # 排序 by date_iso then match_label
    matches.sort(key=lambda x: (x["date"], x.get("match_label") or ""))

    # 输出到 src/data/
    out_dir = Path("src/data")
    out_dir.mkdir(parents=True, exist_ok=True)

    matches_path = out_dir / "matches.json"
    with open(matches_path, "w", encoding="utf-8") as f:
        json.dump(matches, f, ensure_ascii=False, indent=2)
    print(f"\n✅ {matches_path} ({len(matches)} 场)")

    venues_path = out_dir / "venues.json"
    with open(venues_path, "w", encoding="utf-8") as f:
        json.dump(VENUES, f, ensure_ascii=False, indent=2)
    print(f"✅ {venues_path} ({len(VENUES)} 个场馆)")

    # 从 matches 提取真实球队，校验与 TEAMS 表一致，输出 teams.json
    placeholder_re = re.compile(r"^(Winner|Loser|Runner|3rd|TBD|TBA|Group|Match)\b", re.IGNORECASE)
    appeared = set()
    for m in matches:
        for t in (m["home_team"], m["away_team"]):
            if t and not placeholder_re.match(t):
                appeared.add(t)
    missing_in_table = appeared - set(TEAMS.keys())
    not_appeared = set(TEAMS.keys()) - appeared
    if missing_in_table:
        print(f"⚠️  比赛中出现但 TEAMS 表里没有的队（请补）：{sorted(missing_in_table)}")
    if not_appeared:
        print(f"⚠️  TEAMS 表里有但比赛中没出现的队（可能拼写不一致）：{sorted(not_appeared)}")

    # 输出 teams.json：用 slug 作 key，便于前端通过 /team/[slug] 路由访问
    teams_out = {}
    for en_name in sorted(appeared):
        info = TEAMS.get(en_name)
        if not info:
            continue
        teams_out[info["slug"]] = {
            "slug": info["slug"],
            "code": info["code"],
            "name_en": en_name,
            "name_ja": info["name_ja"],
            "name_ko": info["name_ko"],
            "name_zh": info["name_zh"],
            "flag": info["flag"],
        }
    teams_path = out_dir / "teams.json"
    with open(teams_path, "w", encoding="utf-8") as f:
        json.dump(teams_out, f, ensure_ascii=False, indent=2)
    print(f"✅ {teams_path} ({len(teams_out)} 支球队 — 应为 48)")

    # 数据完整性报告
    print("\n" + "=" * 60)
    print("📊 数据完整性")
    print("=" * 60)
    print(f"总场次：{len(matches)} / 104")
    from collections import Counter
    print(f"按 stage：{dict(Counter(m['stage'] for m in matches))}")
    print(f"按 group：{dict(Counter(m['group'] for m in matches if m['group']))}")
    missing_venue = [m for m in matches if not m["venue_slug"]]
    missing_utc = [m for m in matches if not m["kickoff_utc"]]
    if missing_venue:
        print(f"⚠️  {len(missing_venue)} 场缺 venue（venue_name 不在 VENUES 表里）")
        for m in missing_venue[:5]:
            print(f"   - {m['date']} {m['home_team']} vs {m['away_team']} @ {m['venue_name']}")
    if missing_utc:
        print(f"⚠️  {len(missing_utc)} 场缺 kickoff_utc")

    print("\n=== 开幕战 ===")
    print(json.dumps(matches[0], ensure_ascii=False, indent=2))
    print("\n=== 决赛（最后一场）===")
    print(json.dumps(matches[-1], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
