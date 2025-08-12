# JREgyoumu/build.py

import os
from pathlib import Path
import shutil
import markdown
from jinja2 import Environment, FileSystemLoader
from collections import defaultdict

# --- 設定 ---
BASE_DIR = Path(__file__).resolve().parent
ARTICLES_DIR = BASE_DIR / "articles"
TEMPLATES_DIR = BASE_DIR / "templates"
# ★完成品を出力する一時的なフォルダ名を指定
OUTPUT_DIR = BASE_DIR / "_site" 
SITE_BASE_PATH = "/tayutayu1229.github.io/JREgyoumu"


def main():
    print(">>> サイト生成を開始します...")
    
    # 古い出力先があれば一旦削除して、クリーンな状態にする
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=True)
    template = env.get_template("base.html")

    all_articles = []
    for md_path in sorted(ARTICLES_DIR.glob("**/*.md")):
        relative_path = md_path.relative_to(ARTICLES_DIR)
        article_url = f"{SITE_BASE_PATH}/articles/{relative_path.with_suffix('.html')}".replace("\\", "/")
        category_name = relative_path.parent.name if relative_path.parent.name != "." else "その他"
        
        all_articles.append({
            "md_path": md_path, "title": relative_path.stem, "path": article_url,
            "category": category_name, "relative_path": relative_path
        })
    
    categories = defaultdict(list)
    for article in all_articles:
        article["category_path"] = f"{SITE_BASE_PATH}/articles/{article['relative_path'].parent}/index.html".replace("\\", "/")
        categories[article['category']].append(article)

    # 各記事ページを生成
    for article in all_articles:
        content_html = article["md_path"].read_text(encoding="utf-8")
        html_content = markdown.markdown(content_html, extensions=['fenced_code', 'tables'])
        breadcrumbs = [{"name": article['category'], "path": article['category_path']}, {"name": article['title'], "path": "#"}]
        
        rendered_html = template.render(
            content=html_content, title=article['title'], base_path=SITE_BASE_PATH,
            categories=categories, breadcrumbs=breadcrumbs
        )
        output_path = OUTPUT_DIR / "articles" / article["relative_path"].with_suffix(".html")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered_html, encoding="utf-8")
        print(f"  - 記事ページ生成: {output_path}")

    # 各カテゴリのトップページを生成
    for category_name, articles_in_cat in categories.items():
        category_dir = articles_in_cat[0]['relative_path'].parent
        category_index_path = OUTPUT_DIR / "articles" / category_dir / "index.html"
        list_html = f"<h1>{category_name} の記事一覧</h1><ul>"
        for article in articles_in_cat:
            list_html += f'<li><a href="{article["path"]}">{article["title"]}</a></li>'
        list_html += "</ul>"
        breadcrumbs = [{"name": category_name, "path": "#"}]

        rendered_html = template.render(
            content=list_html, title=f"{category_name} カテゴリ", base_path=SITE_BASE_PATH,
            categories=categories, breadcrumbs=breadcrumbs
        )
        category_index_path.write_text(rendered_html, encoding="utf-8")
        print(f"  - カテゴリページ生成: {category_index_path}")

    # サイト全体のトップページを生成
    generate_site_index_page(template, categories)
    print(">>> サイトの生成が完了しました。")


def generate_site_index_page(template, categories):
    list_html = "<h1>ナレッジ一覧</h1>"
    for category_name, articles in sorted(categories.items()):
        list_html += f"<h2>{category_name}</h2><ul>"
        for article in articles:
            list_html += f'<li><a href="{article["path"]}">{article["title"]}</a></li>'
        list_html += "</ul>"

    rendered_html = template.render(
        content=list_html, title="ナレッジシステム トップページ", base_path=SITE_BASE_PATH,
        categories=categories, breadcrumbs=None
    )
    index_path = OUTPUT_DIR / "index.html"
    index_path.write_text(rendered_html, encoding="utf-8")
    print(f"  - サイトトップページ生成: {index_path}")

if __name__ == "__main__":
    main()
