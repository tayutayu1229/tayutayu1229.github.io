import os
import shutil
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
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))
    template = env.get_template("base.html")

    all_articles = []

    # 'articles' ディレクトリ内の全Markdownファイルを検索
    for md_path in sorted(ARTICLES_DIR.glob("**/*.md")):
        # ファイルの内容を読み込み
        raw_text = md_path.read_text(encoding="utf-8")
        
        # MarkdownをHTMLに変換
        html_content = markdown.markdown(raw_text, extensions=['fenced_code', 'tables'])

        # 出力先のパスを決定 (articles -> JREgyoumu/articles)
        relative_path = md_path.relative_to(ARTICLES_DIR)
        output_path = OUTPUT_DIR / "articles" / relative_path.with_suffix(".html")
        
        # 親ディレクトリがなければ作成
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # HTMLをテンプレートに埋め込む
        rendered_html = template.render(
            content=html_content,
            title=relative_path.stem, # タイトルをファイル名から取得
            root_path=".." # CSSやJSファイルへのパスを調整
        )

        # HTMLファイルとして書き出し
        output_path.write_text(rendered_html, encoding="utf-8")
        print(f"  - {output_path} を生成しました。")
        
        # トップページ用の記事リストに追加
        all_articles.append({
            "title": relative_path.stem,
            "path": f"./{output_path.relative_to(OUTPUT_DIR)}".replace("\\", "/")
        })
        
    # トップページ (index.html) を生成
    generate_index_page(template, all_articles)

    print(">>> サイトの生成が完了しました。")


def generate_index_page(template, articles):
    """サイトのトップページを生成する"""
    index_content = "<h1>記事一覧</h1><ul>"
    for article in articles:
        index_content += f'<li><a href="{article["path"]}">{article["title"]}</a></li>'
    index_content += "</ul>"
    
    rendered_html = template.render(
        content=index_content,
        title="ナレッジシステム トップページ",
        root_path="." # CSSやJSファイルへのパスを調整
    )

    index_path = OUTPUT_DIR / "index.html"
    index_path.write_text(rendered_html, encoding="utf-8")
    print(f"  - {index_path} を生成しました。")


if __name__ == "__main__":
    main()
