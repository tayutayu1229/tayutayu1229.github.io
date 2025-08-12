document.addEventListener('DOMContentLoaded', () => {
    // DOM要素を取得
    const articleListEl = document.getElementById('article-list');
    const articleContentEl = document.getElementById('article-content');
    const searchBoxEl = document.getElementById('search-box');

    // ▼▼▼ この部分でパスを明示的に定義します ▼▼▼
    const dbUrl = '/db.json';
    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

    let allArticles = []; 

    // データベース(db.json)を読み込むメイン関数
    async function main() {
        // デバッグ用に、どのURLを読もうとしているかコンソールに表示します
        console.log(`これからこのURLからdb.jsonを読み込みます: ${dbUrl}`);

        try {
            const response = await fetch(dbUrl); 

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(
                        `データベースファイルが見つかりません(404 Not Found)。<br>URL: ${dbUrl}<br>` +
                        'パスが正しいか、gh-pagesブランチにファイルが存在するか確認してください。'
                    );
                }
                throw new Error(`サーバーエラー (ステータス: ${response.status})。`);
            }

            allArticles = await response.json();
            renderArticleList(allArticles);

        } catch (error) {
            console.error('エラーが発生しました:', error);
            articleContentEl.innerHTML = `<div class="placeholder"><h2>エラー</h2><p>${error.message}</p></div>`;
        }
    }

    // (これ以降の関数は変更ありません)
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

    function renderArticleContent(article) {
        articleContentEl.innerHTML = `
            <h2>${article.title}</h2>
            <p><small>公開日: ${article.date}</small></p>
            <div>${article.content_html}</div>
        `;
    }
    
    searchBoxEl.addEventListener('keyup', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredArticles = allArticles.filter(article => 
            article.title.toLowerCase().includes(searchTerm) ||
            article.content_md.toLowerCase().includes(searchTerm)
        );
        renderArticleList(filteredArticles);
    });

    main();
});
