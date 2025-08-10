import requests
from bs4 import BeautifulSoup
import json
import datetime
import re

URL = "https://www.jrfreight.co.jp/jrfreight/i_daiya.html"

def fetch_and_parse_data():
    try:
        response = requests.get(URL)
        response.raise_for_status()  # HTTPエラーがあれば例外を発生させる
        soup = BeautifulSoup(response.content, 'html.parser')

        # データの初期化
        data = {
            "date": datetime.datetime.now().strftime("%Y年%m月%d日"),
            "time": datetime.datetime.now().strftime("%H時現在"),
            "company": "日本貨物鉄道株式会社",
            "status_title": "",
            "incidents": [],
            "affected_trains": [],
            "related_files": []
        }

        # 輸送障害情報
        status_title_element = soup.find('p', style=re.compile("color:#d81223;"))
        if status_title_element:
            data['status_title'] = status_title_element.get_text(strip=True)

        incident_elements = soup.find_all('p', class_='info_detail')
        for incident in incident_elements:
            time_period = incident.find_previous_sibling('h3').get_text(strip=True)
            details = [p.get_text(strip=True) for p in incident.find_all('p')]
            
            # 詳細情報から場所、原因、影響を抽出
            location = ""
            cause = ""
            impact = ""
            for detail in details:
                if '場所：' in detail:
                    location = detail.replace('場所：', '').strip()
                elif '原因：' in detail:
                    cause = detail.replace('原因：', '').strip()
                elif '影響：' in detail:
                    impact = detail.replace('影響：', '').strip()
            
            data['incidents'].append({
                "time_period": time_period,
                "location": location,
                "cause": cause,
                "impact": impact
            })
            
        # 影響のある貨物列車
        train_lines = soup.find_all('h3', class_='train_line')
        for line in train_lines:
            line_name = line.get_text(strip=True)
            train_list_elements = line.find_next_sibling('ul', class_='train_list').find_all('li')
            trains = []
            for train_element in train_list_elements:
                parts = train_element.get_text(separator='|', strip=True).split('|')
                if len(parts) >= 4:
                    train_number = parts[0].replace('列車番号：', '').strip()
                    route = parts[1].replace('区間：', '').strip()
                    current_location = parts[2].replace('現在地：', '').strip()
                    status = parts[3].replace('状況：', '').strip()
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

        # 関連ファイル
        file_list_elements = soup.find('div', class_='file_list')
        if file_list_elements:
            file_links = file_list_elements.find_all('a')
            for link in file_links:
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
