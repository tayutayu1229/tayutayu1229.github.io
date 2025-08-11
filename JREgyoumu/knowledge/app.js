document.addEventListener('DOMContentLoaded', () => {
    // DOM要素を取得
    const articleListEl = document.getElementById('article-list');
    const articleContentEl = document.getElementById('article-content');
    const searchBoxEl = document.getElementById('search-box');

    let allArticles = []; // 全記事データを保持する配列

    // データベース(db.json)を読み込むメイン関数
    async function main() {
        try {
            const response = await fetch('db.json'); 

            // ▼▼▼ エラーハンドリング強化 ▼▼▼
            if (!response.ok) {
                // 404エラー（ファイルが見つからない）の場合
                if (response.status === 404) {
                    throw new Error(
                        'データベースファイル(db.json)が見つかりません (404 Not Found)。<br>' +
                        'GitHub Actionsのビルドが成功し、gh-pagesブランチにファイルが正しく配置されているか確認してください。'
                    );
                }
                // その他のHTTPエラーの場合
                throw new Error(`サーバーエラーが発生しました (ステータス: ${response.status})。`);
            }
            // ▲▲▲ ここまで ▲▲▲

            // JSONのパースを試みる (ここでSyntaxErrorが発生する可能性)
            allArticles = await response.json();
            renderArticleList(allArticles);

        } catch (error) {
            // ▼▼▼ エラーハンドリング強化 ▼▼▼
            console.error('エラーが発生しました:', error);
            let userMessage = '';

            // JSON形式が不正な場合
            if (error instanceof SyntaxError) {
                userMessage = 
                    'データベースファイル(db.json)の形式が正しくありません。<br>' +
                    'ファイルが破損しているか、ビルドが正常に完了しなかった可能性があります。';
            // ネットワーク接続の問題などの場合
            } else if (error instanceof TypeError) {
                userMessage = 
                    'ネットワークエラーが発生しました。<br>' + 
                    'インターネット接続を確認してください。';
            // 上記以外の、自分で定義したエラーメッセージなどの場合
            } else {
                userMessage = error.message;
            }

            articleContentEl.innerHTML = `<div class="placeholder"><h2>エラー</h2><p>${userMessage}</p></div>`;
            // ▲▲▲ ここまで ▲▲▲
        }
    }

    // 記事リストを画面に表示する関数
    function renderArticleList(articles) {
        if (articles.length === 0) {
            articleListEl.innerHTML = '<p style="padding: 20px;">記事が見つかりません。</p>';
            return;
        }
        const ul = document.createElement('ul');
        articles.forEach(article => {
            const li = document.createElement('li');
            li.textContent = article.title;
            li.dataset.id = article.id;
            
            li.addEventListener('click', () => {
                const allListItems = articleListEl.querySelectorAll('li');
                allListItems.forEach(item => item.classList.remove('selected'));
                li.classList.add('selected');
                renderArticleContent(article);
            });
            ul.appendChild(li);
        });
        articleListEl.innerHTML = '';
        articleListEl.appendChild(ul);
    }

    // 選択された記事の内容を画面に表示する関数
    function renderArticleContent(article) {
        articleContentEl.innerHTML = `
            <h2>${article.title}</h2>
            <p><small>公開日: ${article.date}</small></p>
            <div>${article.content_html}</div>
        `;
    }
    
    // 検索ボックスの入力イベント
    searchBoxEl.addEventListener('keyup', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        
        const filteredArticles = allArticles.filter(article => 
            article.title.toLowerCase().includes(searchTerm) ||
            article.content_md.toLowerCase().includes(searchTerm)
        );
        renderArticleList(filteredArticles);
    });

    // 初期化
    main();
});
