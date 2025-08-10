import requests
from bs4 import BeautifulSoup
import json
import datetime
import base64
import re

URL = "https://www.jrfreight.co.jp/jrfreight/i_daiya.html"

def clean_text(text):
    return re.sub(r'\s+', ' ', text.strip())

def fetch_and_parse_data():
    try:
        response = requests.get(URL, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')

        now = datetime.datetime.now()
        data = {
            "company": "日本貨物鉄道株式会社",
            "date": now.strftime("%Y年%m月%d日"),
            "time": now.strftime("%H時%M分現在"),
            "status_title": "",
            "incidents": [],
            "affected_trains": [],
            "related_files": []
        }

        # 標題
        title_tag = soup.find("h2", string=re.compile("標"))
        if title_tag:
            p_tag = title_tag.find_parent("div").find_next("p")
            if p_tag:
                data["status_title"] = clean_text(p_tag.text)

        # 発生時刻・概要
        incident_tag = soup.find("h2", string=re.compile("発生時刻"))
        if incident_tag:
            p_tag = incident_tag.find_parent("div").find_next("p")
            if p_tag:
                lines = [BeautifulSoup(l, "html.parser").text for l in p_tag.decode_contents().split("<br />") if l.strip()]
                for line in lines:
                    m = re.match(r'^\(\d+\)(?P<term>.+?)\s+(?P<location>.+?)\s+(?P<cause>.+?)\((?P<impact>.+)\)$', line)
                    if m:
                        data["incidents"].append({
                            "time_period": clean_text(m.group("term")),
                            "location": clean_text(m.group("location")),
                            "cause": clean_text(m.group("cause")),
                            "impact": clean_text(m.group("impact"))
                        })
                    else:
                        data["incidents"].append({
                            "time_period": "",
                            "location": "",
                            "cause": "",
                            "impact": clean_text(line)
                        })

        # 線区 → 影響のある貨物列車
        trains_tag = soup.find("h2", string=re.compile("線"))
        if trains_tag:
            p_tag = trains_tag.find_parent("div").find_next("p")
            if p_tag:
                blocks = [b for b in p_tag.decode_contents().split("<br />") if b.strip()]
                current_line = None
                line_data = {}
                for b in blocks:
                    b_txt = BeautifulSoup(b, "html.parser").text.strip()
                    # <○○線 下り> の形式
                    if b_txt.startswith("<") and ">" in b_txt:
                        # 直前までの線区を保存
                        if current_line and "trains" in line_data:
                            data["affected_trains"].append(line_data)
                        current_line = b_txt.strip("<>")
                        line_data = {"line": current_line, "trains": []}
                    else:
                        # 列車情報パース
                        m = re.match(r'(?:(\d+日発))?(.+?列車\(.+?\))\s+(.+?)\s+(.+)', b_txt)
                        if m:
                            dep = m.group(1) or ""
                            number = clean_text(m.group(2))
                            location = clean_text(m.group(3))
                            status = clean_text(m.group(4))
                            # 区間は列車番号の括弧内
                            route_m = re.search(r'\((.+?)\)', number)
                            route = route_m.group(1) if route_m else ""
                            train_number = number.split("列車")[0]
                            line_data["trains"].append({
                                "train_number": clean_text(number.replace(f"({route})", "")),
                                "route": clean_text(route),
                                "current_location": location,
                                "status": status
                            })
                if current_line and "trains" in line_data:
                    data["affected_trains"].append(line_data)

        # ファイルリンク
        file_tag = soup.find("h2", string=re.compile("ファイル"))
        if file_tag:
            ul_tag = file_tag.find_parent("div").find_next("ul")
            if ul_tag:
                for a in ul_tag.find_all("a"):
                    url = a.get("href")
                    if not url.startswith("http"):
                        url = "https://www.jrfreight.co.jp" + url.strip("[/]")
                    data["related_files"].append({
                        "title": clean_text(a.text),
                        "url": url
                    })

        return data

    except Exception as e:
        print("Error:", e)
        return None

if __name__ == "__main__":
    result = fetch_and_parse_data()
    if result:
        with open('JR Frieght Railway.json', 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print("JR Frieght Railway.json updated successfully.")
    else:
        print("Failed to fetch data.")
