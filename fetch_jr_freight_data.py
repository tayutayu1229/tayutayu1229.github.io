import requests
from bs4 import BeautifulSoup
import json
import datetime
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
            "date": now.strftime("%Y年%m月%d日"),
            "time": now.strftime("%H時%M分現在"),
            "company": "日本貨物鉄道株式会社",
            "title": "",
            "incidents": [],
            "affected_trains": [],
            "related_files": []
        }

        # 標題
        title_tag = soup.find("h2", string=re.compile("標"))
        if title_tag:
            # 標題の直後の<p>
            next_div = title_tag.find_parent("div").find_next_sibling("div")
            if next_div:
                p_tag = next_div.find("p")
                if p_tag:
                    data["title"] = clean_text(p_tag.text)

        # 発生時刻・概要
        incident_tag = soup.find("h2", string=re.compile("発生時刻・概要"))
        if incident_tag:
            next_div = incident_tag.find_parent("div").find_next_sibling("div")
            if next_div:
                p_tag = next_div.find("p")
                if p_tag:
                    # 各(1)...(n)を抽出
                    incident_lines = [line.strip() for line in p_tag.decode_contents().split('<br />') if line.strip()]
                    for line in incident_lines:
                        m = re.match(r'\(\d+\)(\d{4}年\d{1,2}月\d{1,2}日\(.+\)\d{1,2}時\d{2}分～\d{1,2}日\(.+\)\d{1,2}時\d{2}分)', line)
                        # 時刻書式・区間・原因・状況を分割
                        m1 = re.match(r'\(\d+\)(?P<term>.+?)<br\s*/?>\s*　(?P<line>.+?)　(?P<cause>.+?)\((?P<status>.+)\)', line)
                        if m1:
                            data["incidents"].append({
                                "period": m1.group("term"),
                                "location": m1.group("line"),
                                "cause": m1.group("cause"),
                                "status": m1.group("status")
                            })
                        else:
                            # フォーマットが違う場合はそのまま
                            data["incidents"].append({"raw": clean_text(line)})

        # 線区（遅延・運休列車）
        trains_tag = soup.find("h2", string=re.compile("線"))
        if trains_tag:
            train_div = trains_tag.find_parent("div").find_next_sibling("div")
            if train_div:
                p_tag = train_div.find("p")
                if p_tag:
                    train_blocks = [block for block in re.split(r"<br\s*/?>", p_tag.decode_contents()) if block.strip()]
                    cur_line_label = ""
                    for block in train_blocks:
                        label_match = re.match(r'<(.+?)>', block)
                        if label_match:
                            cur_line_label = label_match.group(1)
                        else:
                            # 例: "8日発1062列車(鹿児島タ→名古屋タ)  北九州タ 停車中"
                            txt = BeautifulSoup(block, "html.parser").text
                            train_m = re.match(
                                r"(?P<departure>\d+日発)?(?P<number>.+?列車\(.*?\))\s*(?P<location>.*?)\s+(?P<status>.+)",
                                txt
                            )
                            if train_m:
                                data["affected_trains"].append({
                                    "line": cur_line_label,
                                    "train_number": clean_text(train_m.group("number")),
                                    "departure": train_m.group("departure") if train_m.group("departure") else "",
                                    "location": clean_text(train_m.group("location")),
                                    "status": clean_text(train_m.group("status"))
                                })
                            else:
                                # 遅延情報（+◯日◯時間等）パターン
                                delay_m = re.search(r'\+.*?予定', txt) or re.search(r'\+.*?着予定', txt)
                                data["affected_trains"].append({
                                    "line": cur_line_label,
                                    "raw": clean_text(txt),
                                    "delay": delay_m.group(0) if delay_m else ""
                                })

        # ファイル
        file_tag = soup.find("h2", string=re.compile("ファイル"))
        if file_tag:
            ul_tag = file_tag.find_parent("div").find_next_sibling("ul")
            if ul_tag:
                for a in ul_tag.find_all("a"):
                    url = a.get("href")
                    if not url.startswith("http"):
                        url = "https://www.jrfreight.co.jp" + url.strip("[/]").replace("(", "%28").replace(")", "%29")
                    data["related_files"].append({
                        "title": clean_text(a.text),
                        "url": url
                    })

        return data

    except Exception as e:
        print("Error:", e)
        return None


if __name__ == "__main__":
    jr_freight_data = fetch_and_parse_data()
    if jr_freight_data:
        with open('JR Freight Railway.json', 'w', encoding='utf-8') as f:
            json.dump(jr_freight_data, f, ensure_ascii=False, indent=2)
        print("JR Freight Railway.json updated successfully.")
    else:
        print("Failed to update jsonfile.")
