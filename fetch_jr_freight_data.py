import requests
from bs4 import BeautifulSoup
import json
import datetime
import re

URL = "https://www.jrfreight.co.jp/jrfreight/i_daiya.html"

def fetch_and_parse_data():
    try:
        response = requests.get(URL, timeout=10)
        response.raise_for_status()  # HTTPエラーがあれば例外を発生させる
        soup = BeautifulSoup(response.content, 'html.parser')

        # データの初期化
        data = {
            "date": datetime.datetime.now().strftime("%Y年%m月%d日"),
            "time": datetime.datetime.now().strftime("%H時%M分現在"),
            "company": "日本貨物鉄道株式会社",
            "status_title": "",
            "incidents": [],
            "affected_trains": [],
            "related_files": []
        }

        # 更新日時とステータスタイトルの取得
        updated_info_element = soup.select_one('div.mainContentsInner p.font_size_s')
        if updated_info_element:
            text = updated_info_element.get_text(strip=True)
            match = re.search(r'（(?P<date>\d{4}年\d{2}月\d{2}日) (?P<time>\d{2}時\d{2}分)現在）', text)
            if match:
                data['date'] = match.group('date')
                data['time'] = match.group('time') + '現在'

        status_title_element = soup.select_one('div.mainContentsInner p.font_size_m_bold.color_red')
        if status_title_element:
            data['status_title'] = status_title_element.get_text(strip=True)

        # 輸送障害情報の取得
        incident_list_container = soup.select_one('.info_detailList')
        if incident_list_container:
            for incident_item in incident_list_container.select('.info_detailList__item'):
                impact = incident_item.select_one('.info_detailList__title').get_text(strip=True)
                time_period = incident_item.select_one('.info_detailList__term').get_text(strip=True).replace('期間：', '')
                location = incident_item.select_one('.info_detailList__place').get_text(strip=True).replace('場所：', '')
                cause = incident_item.select_one('.info_detailList__cause').get_text(strip=True).replace('原因：', '')

                data['incidents'].append({
                    "time_period": time_period,
                    "location": location,
                    "cause": cause,
                    "impact": impact
                })
        
        # 影響のある貨物列車の取得
        affected_trains_container = soup.select_one('.trainDelayInfo')
        if affected_trains_container:
            for line_section in affected_trains_container.select('.trainDelayInfo__line'):
                line_name = line_section.select_one('.trainDelayInfo__title').get_text(strip=True)
                trains = []
                for train_item in line_section.select('li'):
                    train_details = [p.get_text(strip=True) for p in train_item.select('p')]
                    if len(train_details) >= 4:
                        train_number = train_details[0].replace('列車番号：', '')
                        route = train_details[1].replace('区間：', '')
                        current_location = train_details[2].replace('現在地：', '')
                        status = train_details[3].replace('状況：', '')
                        trains.append({
                            "train_number": train_number,
                            "route": route,
                            "current_location": current_location,
                            "status": status
                        })
                data['affected_trains'].append({
                    "line": line_name,
                    "trains": trains
                })

        # 関連ファイルの取得
        related_files_container = soup.select_one('.file_list')
        if related_files_container:
            for link in related_files_container.select('a'):
                data['related_files'].append({
                    "title": link.get_text(strip=True),
                    "url": link.get('href')
                })

        return data

    except requests.exceptions.RequestException as e:
        print(f"Error fetching data: {e}")
        return None
    except Exception as e:
        print(f"Error parsing data: {e}")
        return None

if __name__ == "__main__":
    jr_freight_data = fetch_and_parse_data()
    if jr_freight_data:
        with open('data.json', 'w', encoding='utf-8') as f:
            json.dump(jr_freight_data, f, ensure_ascii=False, indent=2)
        print("data.json updated successfully.")
    else:
        print("Failed to update data.json.")
