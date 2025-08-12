# JREgyoumu/build.py

import os
from pathlib import Path
import markdown
from jinja2 import Environment, FileSystemLoader

# --- 設定 ---
BASE_DIR = Path(__file__).resolve().parent
ARTICLES_DIR = BASE_DIR / "articles"
TEMPLATES_DIR = BASE_DIR / "templates"
OUTPUT_DIR = BASE_DIR

# --- メイン処理 ---
def main():
    print(">>> サイト生成を開始します...")

    # Jinja2のテンプレート環境を設定
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=True)
    template = env.get_template("base.html")

    all_articles = []

    # 'articles' ディレクトリ内の全Markdownファイルを検索
    for md_path in sorted(ARTICLES_DIR.glob("**/*.md")):
        raw_text = md_path.read_text(encoding="utf-8")
        html_content = markdown.markdown(raw_text, extensions=['fenced_code', 'tables'])

        relative_path = md_path.relative_to(ARTICLES_DIR)
        output_path = OUTPUT_DIR / "articles" / relative_path.with_suffix(".html")
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # ▼▼▼【変更点】ここから ▼▼▼
        # HTMLの出力先ディレクトリの深さを計算
        depth = len(output_path.relative_to(BASE_DIR).parent.parts)
        # 深さに応じて相対パスを生成 (例: 深さ2なら '../../')
        root_path = "/".join([".."] * depth)
        # ▲▲▲【変更点】ここまで ▲▲▲

        rendered_html = template.render(
            content=html_content,
            title=relative_path.stem,
            root_path=root_path  # 計算したパスをテンプレートに渡す
        )

        output_path.write_text(rendered_html, encoding="utf-8")
        print(f"  - {output_path} を生成しました。")
        
        all_articles.append({
            "title": relative_path.stem,
            "path": f"./{output_path.relative_to(OUTPUT_DIR)}".replace("\\", "/")
        })
        
    generate_index_page(template, all_articles)

    print(">>> サイトの生成が完了しました。")

def generate_index_page(template, articles):
    """サイトのトップページを生成する"""
    # トップページ用の記事リストHTMLを生成
    # sortedでカテゴリごと(パス)に並べ替え
    sorted_articles = sorted(articles, key=lambda x: x['path'])
    index_content = "<h1>記事一覧</h1><ul>"
    for article in sorted_articles:
        # パスからカテゴリ名を取得して表示
        category = Path(article['path']).parent.name
        if category != "articles":
            index_content += f'<li>[{category}] <a href="{article["path"]}">{article["title"]}</a></li>'
        else:
            index_content += f'<li><a href="{article["path"]}">{article["title"]}</a></li>'
    index_content += "</ul>"
    
    rendered_html = template.render(
        content=index_content,
        title="ナレッジシステム トップページ",
        root_path="." # トップページのパスは '.' のまま
    )

    index_path = OUTPUT_DIR / "index.html"
    index_path.write_text(rendered_html, encoding="utf-8")
    print(f"  - {index_path} を生成しました。")

if __name__ == "__main__":
    main()
