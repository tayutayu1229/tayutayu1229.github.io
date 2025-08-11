import os
import json
import markdown
import frontmatter

def build_database():
    """articlesフォルダからMarkdownを読み込み、db.jsonを生成する"""
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    articles_dir = os.path.join(script_dir, 'articles')
    output_path = os.path.join(script_dir, 'db.json')
    
    articles_data = []
    
    if not os.path.exists(articles_dir):
        print(f"⚠️ 警告: '{articles_dir}' が見つかりません。空のdb.jsonを生成します。")
        article_files = []
    else:
        article_files = sorted(os.listdir(articles_dir))

    for filename in article_files:
        if filename.endswith('.md'):
            filepath = os.path.join(articles_dir, filename)
            
            with open(filepath, 'r', encoding='utf-8') as f:
                post = frontmatter.load(f)
                html_content = markdown.markdown(post.content)
                
                # 1つの記事データを辞書としてまとめる
                article = {
                    'id': os.path.splitext(filename)[0],
                    'title': post.metadata.get('title', '無題'),
                    # ▼▼▼ ここが修正点 ▼▼▼
                    'date': str(post.metadata.get('date', '日付なし')),
                    'content_html': html_content,
                    'content_md': post.content
                }
                articles_data.append(article)

    # `db.json`として書き出し
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(articles_data, f, indent=2, ensure_ascii=False)

    print(f"✅ `db.json`の生成が完了しました。{len(articles_data)}件の記事が書き込まれました。")

if __name__ == '__main__':
    build_database()
