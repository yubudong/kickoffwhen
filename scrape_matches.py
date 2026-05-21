"""
2026 FIFA World Cup 赛程抓取脚本
================================

从 Wikipedia 抓取 104 场比赛数据,输出为 JSON 文件供前端使用。

使用方法:
    pip install requests beautifulsoup4 lxml
    python scrape_matches.py

输出:
    matches.json   - 104 场比赛数据
    venues.json    - 16 个场馆信息(含时区)
    teams.json     - 48 支参赛球队

策略说明:
    1. 优先抓取 Wikipedia (英文版数据最全)
    2. Wikipedia 的足球比赛用 footballbox 模板,渲染后是 .footballbox 或 .wikitable 表格
    3. 如果某些字段抓不到,会标记 "TBD" 或给出警告
    4. 淘汰赛对阵未定时队伍字段为 "TBD"
    5. 时区信息使用本脚本内置的场馆时区表(不依赖 Wikipedia)

注意:
    - Wikipedia HTML 结构可能变化,如脚本失败请按提示调试
    - 脚本会保留已有 matches.json,先备份再覆盖
    - 抓取后务必人工核对开幕战和决赛(最容易出错)
"""

import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("缺少依赖,请先运行:pip install requests beautifulsoup4 lxml")
    sys.exit(1)


# ============================================================
# 常量与配置
# ============================================================

WIKI_URLS = {
    "main": "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
    "group_stage": "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_group_stage",
    "knockout_stage": "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage",
}

HEADERS = {
    "User-Agent": "KickoffWhen-Scraper/1.0 (https://kickoffwhen.com; data collection for non-commercial fan tool)"
}

# 16 个场馆的官方时区(IANA 格式)
# 数据来源:维基百科 + IANA TZ database
VENUES = {
    # United States
    "MetLife Stadium": {"city": "East Rutherford, NJ", "country": "USA", "timezone": "America/New_York", "slug": "metlife-stadium"},
    "AT&T Stadium": {"city": "Arlington, TX", "country": "USA", "timezone": "America/Chicago", "slug": "att-stadium"},
    "SoFi Stadium": {"city": "Inglewood, CA", "country": "USA", "timezone": "America/Los_Angeles", "slug": "sofi-stadium"},
    "Mercedes-Benz Stadium": {"city": "Atlanta, GA", "country": "USA", "timezone": "America/New_York", "slug": "mercedes-benz-stadium"},
    "Hard Rock Stadium": {"city": "Miami Gardens, FL", "country": "USA", "timezone": "America/New_York", "slug": "hard-rock-stadium"},
    "NRG Stadium": {"city": "Houston, TX", "country": "USA", "timezone": "America/Chicago", "slug": "nrg-stadium"},
    "Arrowhead Stadium": {"city": "Kansas City, MO", "country": "USA", "timezone": "America/Chicago", "slug": "arrowhead-stadium"},
    "Lumen Field": {"city": "Seattle, WA", "country": "USA", "timezone": "America/Los_Angeles", "slug": "lumen-field"},
    "Levi's Stadium": {"city": "Santa Clara, CA", "country": "USA", "timezone": "America/Los_Angeles", "slug": "levis-stadium"},
    "Gillette Stadium": {"city": "Foxborough, MA", "country": "USA", "timezone": "America/New_York", "slug": "gillette-stadium"},
    "Lincoln Financial Field": {"city": "Philadelphia, PA", "country": "USA", "timezone": "America/New_York", "slug": "lincoln-financial-field"},
    # Mexico
    "Estadio Azteca": {"city": "Mexico City", "country": "MEX", "timezone": "America/Mexico_City", "slug": "estadio-azteca"},
    "Estadio BBVA": {"city": "Monterrey", "country": "MEX", "timezone": "America/Monterrey", "slug": "estadio-bbva"},
    "Estadio Akron": {"city": "Guadalajara", "country": "MEX", "timezone": "America/Mexico_City", "slug": "estadio-akron"},
    # Canada
    "BMO Field": {"city": "Toronto", "country": "CAN", "timezone": "America/Toronto", "slug": "bmo-field"},
    "BC Place": {"city": "Vancouver", "country": "CAN", "timezone": "America/Vancouver", "slug": "bc-place"},
}

# 48 支球队 ISO 代码(用于国旗 emoji 和 SEO)
# ⚠️ 抽签后需根据实际确认,这里列的是已确认参赛的代表性球队
# 完整 48 队需要在抽签结果出来后人工补全
TEAMS_TEMPLATE = {
    # 东道主
    "USA": {"name_en": "United States", "name_ja": "アメリカ", "name_ko": "미국", "name_zh": "美國", "flag": "🇺🇸"},
    "MEX": {"name_en": "Mexico", "name_ja": "メキシコ", "name_ko": "멕시코", "name_zh": "墨西哥", "flag": "🇲🇽"},
    "CAN": {"name_en": "Canada", "name_ja": "カナダ", "name_ko": "캐나다", "name_zh": "加拿大", "flag": "🇨🇦"},
    # 亚洲核心(SEO 关键)
    "JPN": {"name_en": "Japan", "name_ja": "日本", "name_ko": "일본", "name_zh": "日本", "flag": "🇯🇵"},
    "KOR": {"name_en": "Korea Republic", "name_ja": "韓国", "name_ko": "대한민국", "name_zh": "韓國", "flag": "🇰🇷"},
    "IRN": {"name_en": "Iran", "name_ja": "イラン", "name_ko": "이란", "name_zh": "伊朗", "flag": "🇮🇷"},
    "AUS": {"name_en": "Australia", "name_ja": "オーストラリア", "name_ko": "호주", "name_zh": "澳洲", "flag": "🇦🇺"},
    "KSA": {"name_en": "Saudi Arabia", "name_ja": "サウジアラビア", "name_ko": "사우디아라비아", "name_zh": "沙特", "flag": "🇸🇦"},
    "QAT": {"name_en": "Qatar", "name_ja": "カタール", "name_ko": "카타르", "name_zh": "卡塔爾", "flag": "🇶🇦"},
    "UZB": {"name_en": "Uzbekistan", "name_ja": "ウズベキスタン", "name_ko": "우즈베키스탄", "name_zh": "烏茲別克", "flag": "🇺🇿"},
    "JOR": {"name_en": "Jordan", "name_ja": "ヨルダン", "name_ko": "요르단", "name_zh": "約旦", "flag": "🇯🇴"},
    # 欧洲豪门
    "ENG": {"name_en": "England", "name_ja": "イングランド", "name_ko": "잉글랜드", "name_zh": "英格蘭", "flag": "🏴󠁧󠁢󠁥󠁮󠁧󠁿"},
    "FRA": {"name_en": "France", "name_ja": "フランス", "name_ko": "프랑스", "name_zh": "法國", "flag": "🇫🇷"},
    "GER": {"name_en": "Germany", "name_ja": "ドイツ", "name_ko": "독일", "name_zh": "德國", "flag": "🇩🇪"},
    "ESP": {"name_en": "Spain", "name_ja": "スペイン", "name_ko": "스페인", "name_zh": "西班牙", "flag": "🇪🇸"},
    "POR": {"name_en": "Portugal", "name_ja": "ポルトガル", "name_ko": "포르투갈", "name_zh": "葡萄牙", "flag": "🇵🇹"},
    "NED": {"name_en": "Netherlands", "name_ja": "オランダ", "name_ko": "네덜란드", "name_zh": "荷蘭", "flag": "🇳🇱"},
    "ITA": {"name_en": "Italy", "name_ja": "イタリア", "name_ko": "이탈리아", "name_zh": "義大利", "flag": "🇮🇹"},
    "BEL": {"name_en": "Belgium", "name_ja": "ベルギー", "name_ko": "벨기에", "name_zh": "比利時", "flag": "🇧🇪"},
    "CRO": {"name_en": "Croatia", "name_ja": "クロアチア", "name_ko": "크로아티아", "name_zh": "克羅地亞", "flag": "🇭🇷"},
    "SUI": {"name_en": "Switzerland", "name_ja": "スイス", "name_ko": "스위스", "name_zh": "瑞士", "flag": "🇨🇭"},
    "AUT": {"name_en": "Austria", "name_ja": "オーストリア", "name_ko": "오스트리아", "name_zh": "奧地利", "flag": "🇦🇹"},
    "DEN": {"name_en": "Denmark", "name_ja": "デンマーク", "name_ko": "덴마크", "name_zh": "丹麥", "flag": "🇩🇰"},
    "NOR": {"name_en": "Norway", "name_ja": "ノルウェー", "name_ko": "노르웨이", "name_zh": "挪威", "flag": "🇳🇴"},
    "SCO": {"name_en": "Scotland", "name_ja": "スコットランド", "name_ko": "스코틀랜드", "name_zh": "蘇格蘭", "flag": "🏴󠁧󠁢󠁳󠁣󠁴󠁿"},
    "TUR": {"name_en": "Türkiye", "name_ja": "トルコ", "name_ko": "튀르키예", "name_zh": "土耳其", "flag": "🇹🇷"},
    "CZE": {"name_en": "Czech Republic", "name_ja": "チェコ", "name_ko": "체코", "name_zh": "捷克", "flag": "🇨🇿"},
    # 南美
    "ARG": {"name_en": "Argentina", "name_ja": "アルゼンチン", "name_ko": "아르헨티나", "name_zh": "阿根廷", "flag": "🇦🇷"},
    "BRA": {"name_en": "Brazil", "name_ja": "ブラジル", "name_ko": "브라질", "name_zh": "巴西", "flag": "🇧🇷"},
    "URU": {"name_en": "Uruguay", "name_ja": "ウルグアイ", "name_ko": "우루과이", "name_zh": "烏拉圭", "flag": "🇺🇾"},
    "COL": {"name_en": "Colombia", "name_ja": "コロンビア", "name_ko": "콜롬비아", "name_zh": "哥倫比亞", "flag": "🇨🇴"},
    "ECU": {"name_en": "Ecuador", "name_ja": "エクアドル", "name_ko": "에콰도르", "name_zh": "厄瓜多爾", "flag": "🇪🇨"},
    "PAR": {"name_en": "Paraguay", "name_ja": "パラグアイ", "name_ko": "파라과이", "name_zh": "巴拉圭", "flag": "🇵🇾"},
    # 非洲
    "MAR": {"name_en": "Morocco", "name_ja": "モロッコ", "name_ko": "모로코", "name_zh": "摩洛哥", "flag": "🇲🇦"},
    "SEN": {"name_en": "Senegal", "name_ja": "セネガル", "name_ko": "세네갈", "name_zh": "塞內加爾", "flag": "🇸🇳"},
    "EGY": {"name_en": "Egypt", "name_ja": "エジプト", "name_ko": "이집트", "name_zh": "埃及", "flag": "🇪🇬"},
    "RSA": {"name_en": "South Africa", "name_ja": "南アフリカ", "name_ko": "남아프리카공화국", "name_zh": "南非", "flag": "🇿🇦"},
    "TUN": {"name_en": "Tunisia", "name_ja": "チュニジア", "name_ko": "튀니지", "name_zh": "突尼斯", "flag": "🇹🇳"},
    "ALG": {"name_en": "Algeria", "name_ja": "アルジェリア", "name_ko": "알제리", "name_zh": "阿爾及利亞", "flag": "🇩🇿"},
    "NGA": {"name_en": "Nigeria", "name_ja": "ナイジェリア", "name_ko": "나이지리아", "name_zh": "尼日利亞", "flag": "🇳🇬"},
    "CIV": {"name_en": "Ivory Coast", "name_ja": "コートジボワール", "name_ko": "코트디부아르", "name_zh": "象牙海岸", "flag": "🇨🇮"},
    "GHA": {"name_en": "Ghana", "name_ja": "ガーナ", "name_ko": "가나", "name_zh": "迦納", "flag": "🇬🇭"},
    "CMR": {"name_en": "Cameroon", "name_ja": "カメルーン", "name_ko": "카메룬", "name_zh": "喀麥隆", "flag": "🇨🇲"},
    "COD": {"name_en": "DR Congo", "name_ja": "コンゴ民主共和国", "name_ko": "DR콩고", "name_zh": "剛果民主共和國", "flag": "🇨🇩"},
    # 北中美洲与加勒比海
    "CRC": {"name_en": "Costa Rica", "name_ja": "コスタリカ", "name_ko": "코스타리카", "name_zh": "哥斯達黎加", "flag": "🇨🇷"},
    "PAN": {"name_en": "Panama", "name_ja": "パナマ", "name_ko": "파나마", "name_zh": "巴拿馬", "flag": "🇵🇦"},
    "HAI": {"name_en": "Haiti", "name_ja": "ハイチ", "name_ko": "아이티", "name_zh": "海地", "flag": "🇭🇹"},
    "CUW": {"name_en": "Curaçao", "name_ja": "キュラソー", "name_ko": "퀴라소", "name_zh": "庫拉索", "flag": "🇨🇼"},
    # 大洋洲
    "NZL": {"name_en": "New Zealand", "name_ja": "ニュージーランド", "name_ko": "뉴질랜드", "name_zh": "紐西蘭", "flag": "🇳🇿"},
    # ⚠️ 上面列了 ~50 个,实际 48 支需根据 2025年12月5日抽签结果取舍
}


# ============================================================
# 抓取核心
# ============================================================

def fetch_html(url: str, retry: int = 3) -> str:
    """带重试的 HTTP 请求,Wikipedia 偶尔会限流"""
    for attempt in range(retry):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as e:
            if attempt < retry - 1:
                print(f"  ⚠️  请求失败 ({e}),{2 ** attempt} 秒后重试...")
                time.sleep(2 ** attempt)
            else:
                raise
    return ""


def parse_footballbox(box, default_year: int = 2026) -> dict | None:
    """
    解析单个 Wikipedia footballbox(比赛卡片)
    Wikipedia 的足球比赛信息渲染后的 HTML 大致结构:

        <table class="footballbox">
          <tr class="fdate"><th>...date...</th></tr>
          <tr><th>HomeTeam</th><td>vs</td><th>AwayTeam</th></tr>
          <tr class="fhgoal">...</tr>
          ...
        </table>

    实际 class 名经常变化(footballbox / footballbox-collapsible / wikitable),
    所以这个解析器尽量做得宽松,允许部分字段缺失。
    """
    try:
        text = box.get_text(" ", strip=True)

        # 日期(找类似 "11 June 2026" / "2026-06-11")
        date_match = re.search(
            r"(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})",
            text,
        )
        kickoff_local_match = re.search(r"(\d{1,2}:\d{2})", text)

        # 球队(看 <th> 元素里的球队名)
        team_cells = box.find_all(["th"], limit=10)
        teams = []
        for cell in team_cells:
            name = cell.get_text(strip=True)
            # 过滤掉非球队的 th(日期、时间、其他标题)
            if name and not any(kw in name.lower() for kw in ["date", "time", "venue", "ref", "att", "report", "20", "june", "july"]):
                if len(name) < 40 and not name.isdigit():
                    teams.append(name)

        if len(teams) < 2 or not date_match:
            return None

        # 场地
        venue = None
        venue_match = re.search(r"(?:at\s+)([A-Z][A-Za-z\s&'.]+(?:Stadium|Field|Place|BBVA|Akron|Azteca))", text)
        if venue_match:
            venue = venue_match.group(1).strip()

        return {
            "date_text": date_match.group(1),
            "kickoff_local": kickoff_local_match.group(1) if kickoff_local_match else "TBD",
            "home_team": teams[0],
            "away_team": teams[1],
            "venue": venue,
            "raw_text_preview": text[:300],
        }
    except Exception as e:
        print(f"  ⚠️  解析单场比赛出错: {e}")
        return None


def scrape_wikipedia_matches() -> list[dict]:
    """从 Wikipedia 抓取所有比赛"""
    all_matches = []
    seen = set()  # 去重

    for stage_name, url in [("group_stage", WIKI_URLS["group_stage"]), ("knockout", WIKI_URLS["knockout_stage"]), ("main", WIKI_URLS["main"])]:
        print(f"\n📡 抓取 {stage_name}: {url}")
        try:
            html = fetch_html(url)
        except Exception as e:
            print(f"  ❌ 抓取失败: {e}")
            continue

        soup = BeautifulSoup(html, "lxml")

        # Wikipedia footballbox 实际渲染后的可能 class 名
        candidates = soup.find_all("table", class_=re.compile(r"footballbox|football-box|fevent"))
        if not candidates:
            # 备用:找含 "vs" 的 wikitable
            candidates = [t for t in soup.find_all("table", class_="wikitable") if "vs" in t.get_text().lower()]

        print(f"  发现 {len(candidates)} 个候选比赛表")

        for box in candidates:
            match = parse_footballbox(box)
            if match:
                key = (match["date_text"], match["home_team"], match["away_team"])
                if key not in seen:
                    seen.add(key)
                    match["stage_source"] = stage_name
                    all_matches.append(match)

    return all_matches


# ============================================================
# 数据清洗与标准化
# ============================================================

def normalize_matches(raw_matches: list[dict]) -> list[dict]:
    """
    把原始抓取数据转换成最终 JSON schema:
    {
      "id": "2026-06-11-mex-vs-rsa",
      "date": "2026-06-11",
      "kickoff_local": "13:00",
      "kickoff_utc": "2026-06-11T18:00:00Z",
      "home_team": "MEX",
      "away_team": "RSA",
      "venue_slug": "estadio-azteca",
      "venue_timezone": "America/Mexico_City",
      "stage": "group",
      "group": null,
      "matchday": null
    }
    """
    normalized = []
    for m in raw_matches:
        try:
            d = datetime.strptime(m["date_text"], "%d %B %Y")
            date_iso = d.strftime("%Y-%m-%d")

            # ID 命名规则
            home_slug = m["home_team"].lower().replace(" ", "-")
            away_slug = m["away_team"].lower().replace(" ", "-")
            match_id = f"{date_iso}-{home_slug}-vs-{away_slug}"

            venue_info = VENUES.get(m.get("venue") or "", {})

            normalized.append({
                "id": match_id,
                "date": date_iso,
                "kickoff_local": m["kickoff_local"],
                "kickoff_utc": None,  # 需要根据场馆时区+本地时间计算,见 README
                "home_team": m["home_team"],
                "away_team": m["away_team"],
                "venue_name": m.get("venue"),
                "venue_slug": venue_info.get("slug"),
                "venue_timezone": venue_info.get("timezone"),
                "venue_city": venue_info.get("city"),
                "stage": m["stage_source"],
                "group": None,
                "matchday": None,
                "_raw_preview": m.get("raw_text_preview", "")[:120],
            })
        except Exception as e:
            print(f"  ⚠️  规范化失败: {e}, 原始数据: {m}")

    return normalized


# ============================================================
# 生成空模板(抓取失败时备用)
# ============================================================

def generate_template_matches() -> list[dict]:
    """
    如果 Wikipedia 抓取失败或不完整,生成空 104 场模板,
    用户可以手动填充或从其他源(FIFA 官网、worldcupwiki.com)粘贴。
    """
    matches = []
    # 12 组 × 6 场小组赛 = 72
    for group_letter in "ABCDEFGHIJKL":
        for md in range(1, 4):  # 3 个轮次
            for slot in range(1, 3):  # 每轮 2 场
                matches.append({
                    "id": f"TBD-group-{group_letter}-md{md}-s{slot}",
                    "date": "TBD",
                    "kickoff_local": "TBD",
                    "kickoff_utc": None,
                    "home_team": f"TBD-{group_letter}{slot * 2 - 1}",
                    "away_team": f"TBD-{group_letter}{slot * 2}",
                    "venue_name": None,
                    "venue_slug": None,
                    "venue_timezone": None,
                    "stage": "group",
                    "group": group_letter,
                    "matchday": md,
                })
    # 淘汰赛 32 场
    knockout_stages = [
        ("round-of-32", 16),
        ("round-of-16", 8),
        ("quarter-final", 4),
        ("semi-final", 2),
        ("third-place", 1),
        ("final", 1),
    ]
    for stage, count in knockout_stages:
        for i in range(1, count + 1):
            matches.append({
                "id": f"TBD-{stage}-{i}",
                "date": "TBD",
                "kickoff_local": "TBD",
                "kickoff_utc": None,
                "home_team": "TBD",
                "away_team": "TBD",
                "venue_name": None,
                "venue_slug": None,
                "venue_timezone": None,
                "stage": stage,
                "group": None,
                "matchday": None,
            })
    return matches


# ============================================================
# 主流程
# ============================================================

def main():
    print("=" * 60)
    print("KickoffWhen | 2026 FIFA World Cup 赛程抓取")
    print("=" * 60)

    output_dir = Path(".")

    # 1. 抓取
    print("\n步骤 1: 从 Wikipedia 抓取比赛数据...")
    raw_matches = scrape_wikipedia_matches()
    print(f"\n✅ 抓取到 {len(raw_matches)} 场比赛")

    # 2. 规范化
    if raw_matches:
        print("\n步骤 2: 规范化数据...")
        matches = normalize_matches(raw_matches)
        print(f"✅ 规范化 {len(matches)} 场")
    else:
        print("\n⚠️  没抓到数据,生成空模板供手动填充")
        matches = generate_template_matches()

    # 3. 写出 JSON
    print("\n步骤 3: 写出 JSON 文件...")

    matches_path = output_dir / "matches.json"
    if matches_path.exists():
        backup = output_dir / f"matches.backup.{int(time.time())}.json"
        matches_path.rename(backup)
        print(f"  📦 已备份原文件到 {backup}")

    with open(matches_path, "w", encoding="utf-8") as f:
        json.dump(matches, f, ensure_ascii=False, indent=2)
    print(f"  ✅ matches.json ({len(matches)} 场)")

    with open(output_dir / "venues.json", "w", encoding="utf-8") as f:
        json.dump(VENUES, f, ensure_ascii=False, indent=2)
    print(f"  ✅ venues.json ({len(VENUES)} 个场馆)")

    with open(output_dir / "teams.json", "w", encoding="utf-8") as f:
        json.dump(TEAMS_TEMPLATE, f, ensure_ascii=False, indent=2)
    print(f"  ✅ teams.json ({len(TEAMS_TEMPLATE)} 支球队 - 注意:模板,需根据抽签结果核对到 48 队)")

    # 4. 数据完整性检查
    print("\n步骤 4: 数据完整性检查...")
    if len(matches) < 104:
        print(f"  ⚠️  比赛数 {len(matches)} < 104,缺失部分需手动补充")
    elif len(matches) > 104:
        print(f"  ⚠️  比赛数 {len(matches)} > 104,可能有重复需要去重")
    else:
        print(f"  ✅ 比赛数正好 104")

    missing_venues = [m for m in matches if not m.get("venue_slug")]
    if missing_venues:
        print(f"  ⚠️  {len(missing_venues)} 场缺场馆信息(常见于 Wikipedia 简称未匹配),手动补全")

    missing_kickoff = [m for m in matches if m.get("kickoff_local") in (None, "TBD")]
    if missing_kickoff:
        print(f"  ⚠️  {len(missing_kickoff)} 场缺开球时间,手动补全")

    print("\n" + "=" * 60)
    print("完成。下一步:")
    print("  1. 打开 matches.json 人工核对前 3 场(开幕战、第 2 场、第 3 场)")
    print("  2. 用 Python 或前端脚本计算 kickoff_utc(本地时间 + 时区)")
    print("  3. 把 stage 字段从 'main'/'group_stage' 等清洗为 'group'/'round-of-32' 等标准值")
    print("  4. 备份数据源:https://worldcupwiki.com/schedule/ 也可参考")
    print("=" * 60)


# ============================================================
# 辅助函数:本地时间 + 时区 → UTC
# ============================================================

def compute_kickoff_utc(date_str: str, kickoff_local: str, venue_timezone: str) -> str | None:
    """
    工具函数:把"2026-06-11" + "13:00" + "America/Mexico_City" → UTC ISO 字符串
    需要 zoneinfo (Python 3.9+)
    
    使用示例:
        utc = compute_kickoff_utc("2026-06-11", "13:00", "America/Mexico_City")
        # → "2026-06-11T18:00:00+00:00"
    """
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        print("需要 Python 3.9+ 或安装 backports.zoneinfo")
        return None

    if not all([date_str, kickoff_local, venue_timezone]) or "TBD" in (date_str, kickoff_local):
        return None

    try:
        dt_local = datetime.strptime(f"{date_str} {kickoff_local}", "%Y-%m-%d %H:%M")
        dt_local = dt_local.replace(tzinfo=ZoneInfo(venue_timezone))
        return dt_local.astimezone(timezone.utc).isoformat()
    except Exception as e:
        print(f"时区转换失败: {e}")
        return None


if __name__ == "__main__":
    main()
