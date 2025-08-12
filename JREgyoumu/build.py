# JREgyoumu/build.py

import os
import shutil
from pathlib import Path
import markdown
from jinja2 import Environment, FileSystemLoader

# --- 設定 ---
BASE_DIR = Path(__file__).resolve().parent
ARTICLES_DIR = BASE_DIR / "articles"
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "css" # cssフォルダの場所

# ▼▼▼【変更点】▼▼▼
# 出力先を_siteフォルダに固定
OUTPUT_DIR = BASE_DIR / "_site"
# サイトのベースパス（リポジトリ名/フォルダ名）
SITE_BASE_PATH = "/tayutayu1229.github.io/JREgyoumu"


# --- メイン処理 ---
def main():
    print(">>> サイト生成を開始します...")

    # ▼▼▼【変更点】▼▼▼
    # 古い出力先があれば一旦削除して、クリーンな状態にする
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    # 出力先フォルダを（再）作成
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    # ▲▲▲【変更点】▲▲▲

    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=True)
    template = env.get_template("base.html")

    all_articles = []
    for md_path in sorted(ARTICLES_DIR.glob("**/*.md")):
        raw_text = md_path.read_text(encoding="utf-8")
        html_content = markdown.markdown(raw_text, extensions=['fenced_code', 'tables'])

        relative_path = md_path.relative_to(ARTICLES_DIR)
        
        # ▼▼▼【変更点】▼▼▼
        # 出力先を_siteフォルダの中にする
        output_path = OUTPUT_DIR / "articles" / relative_path.with_suffix(".html")
        output_path.parent.mkdir(parents=True, exist_ok=True)

        rendered_html = template.render(
            content=html_content,
            title=relative_path.stem,
            base_path=SITE_BASE_PATH
        )

        output_path.write_text(rendered_html, encoding="utf-8")
        print(f"  - {output_path} を生成しました。")
        
        article_url = f"{SITE_BASE_PATH}/articles/{relative_path.with_suffix('.html')}".replace("\\", "/")
        all_articles.append({
            "title": relative_path.stem,
            "path": article_url,
            "category": relative_path.parent.name
        })
        
    generate_index_page(template, all_articles)
    
    # ▼▼▼【追加】▼▼▼
    # cssフォルダを_siteフォルダにコピーする
    shutil.copytree(STATIC_DIR, OUTPUT_DIR / "css")
    print(f"  - {STATIC_DIR} を {OUTPUT_DIR / 'css'} にコピーしました。")
    # ▲▲▲【追加】▲▲▲

    print(">>> サイトの生成が完了しました。")


def generate_index_page(template, articles):
    sorted_articles = sorted(articles, key=lambda x: x['path'])
    index_content = "<h1>記事一覧</h1><ul>"
    for article in sorted_articles:
        if article['category'] != ".":
            index_content += f'<li>[{article["category"]}] <a href="{article["path"]}">{article["title"]}</a></li>'
        else:
            index_content += f'<li><a href="{article["path"]}">{article["title"]}</a></li>'
    index_content += "</ul>"
    
    rendered_html = template.render(
        content=index_content,
        title="ナレッジシステム トップページ",
        base_path=SITE_BASE_PATH
    )

    # index.htmlも_siteフォルダに出力
    index_path = OUTPUT_DIR / "index.html"
    index_path.write_text(rendered_html, encoding="utf-8")
    print(f"  - {index_path} を生成しました。")


if __name__ == "__main__":
    main()
