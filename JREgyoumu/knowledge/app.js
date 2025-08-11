document.addEventListener('DOMContentLoaded', () => {
    // DOM要素を取得
    const articleListEl = document.getElementById('article-list');
    const articleContentEl = document.getElementById('article-content');
    const searchBoxEl = document.getElementById('search-box');

    let allArticles = []; // 全記事データを保持する配列

    // データベース(db.json)を読み込むメイン関数
    async function main() {
        try {
            // ▼▼▼ この一行が重要！ローカルのdb.jsonを読み込みます ▼▼▼
            const response = await fetch('db.json'); 
            if (!response.ok) {
                throw new Error('データベースファイル(db.json)の読み込みに失敗しました。');
            }
            allArticles = await response.json();
            renderArticleList(allArticles);
        } catch (error) {
            console.error(error);
            articleContentEl.innerHTML = `<div class="placeholder"><h2>エラー</h2><p>${error.message}</p><p>GitHub Actionsの実行が成功しているか確認してください。</p></div>`;
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
