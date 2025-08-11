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
            if (!response.ok) {
                throw new Error('データベースの読み込みに失敗しました。');
            }
            allArticles = await response.json();
            renderArticleList(allArticles);
        } catch (error) {
            console.error(error);
            articleContentEl.innerHTML = `<p style="color:red;">${error.message}</p>`;
        }
    }

    // 記事リストを画面に表示する関数
    function renderArticleList(articles) {
        if (articles.length === 0) {
            articleListEl.innerHTML = '<p style="padding: 20px;">該当する記事がありません。</p>';
            return;
        }
        const ul = document.createElement('ul');
        articles.forEach(article => {
            const li = document.createElement('li');
            li.textContent = article.title;
            li.dataset.id = article.id;
            
            // クリックイベントリスナーを追加
            li.addEventListener('click', () => {
                // --- ▼ここから変更▼ ---
                // すべてのliから 'selected' クラスを削除
                const allListItems = articleListEl.querySelectorAll('li');
                allListItems.forEach(item => item.classList.remove('selected'));
                
                // クリックされたliに 'selected' クラスを追加
                li.classList.add('selected');
                
                renderArticleContent(article);
                // --- ▲ここまで変更▲ ---
            });
            ul.appendChild(li);
        });
        articleListEl.innerHTML = ''; // 古いリストをクリア
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
