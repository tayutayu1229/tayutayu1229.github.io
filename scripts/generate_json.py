import os
import json

MARKDOWN_DIR = "JREgyoumu/KnowL/markdown"
OUTPUT_JSON = "JREgyoumu/KnowL/data/knowledge.json"

def parse_markdown(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    title = ""
    desc = ""
    content_lines = []
    for line in lines:
        if line.startswith("title:"):
            title = line.replace("title:", "").strip()
        elif line.startswith("desc:"):
            desc = line.replace("desc:", "").strip()
        else:
            content_lines.append(line.strip())

    content = "\n".join(content_lines).strip()
    return {
        "title": title,
        "desc": desc,
        "content": content
    }

def main():
    entries = []
    for filename in os.listdir(MARKDOWN_DIR):
        if filename.endswith(".md"):
            path = os.path.join(MARKDOWN_DIR, filename)
            entry = parse_markdown(path)
            entries.append(entry)

    # 🔧 出力先ディレクトリがなければ作成
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)

    print(f"✅ {OUTPUT_JSON} を更新しました（{len(entries)}件）")

if __name__ == "__main__":
    main()
