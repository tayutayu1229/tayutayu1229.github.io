document.addEventListener('DOMContentLoaded', () => {
    // ======== ▼▼▼ あなたのリポジトリ情報に書き換えてください ▼▼▼ ========
    const GITHUB_USER = 'tayutayu1229';
    const GITHUB_REPO = 'tayutayu1229.github.io';
    // ================================================================

    const API_URL = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/articles`;

    const articleListEl = document.getElementById('article-list');
    const articleContentEl = document.getElementById('article-content');
    const searchBoxEl = document.getElementById('search-box');

    let allArticles = [];

    async function main() {
        try {
            const response = await fetch(API_URL);
            if (!response.ok) {
                throw new Error('記事一覧の取得に失敗しました。リポジトリ情報を確認してください。');
            }
            const files = await response.json();
            // .mdファイルのみをフィルタリング
            allArticles = files.filter(file => file.name.endsWith('.md')).map(file => ({
                title: file.name.replace('.md', '').replace(/^\d+-/, ''), // ファイル名からタイトルを生成
                path: file.path,
                download_url: file.download_url
            }));
            
            renderArticleList(allArticles);
        } catch (error) {
            console.error(error);
            articleContentEl.innerHTML = `<div class="placeholder"><h2>エラー</h2><p>${error.message}</p></div>`;
        }
    }

    function renderArticleList(articles) {
        if (articles.length === 0) {
            articleListEl.innerHTML = '<p style="padding: 20px;">記事が見つかりません。</p>';
            return;
        }
        const ul = document.createElement('ul');
        articles.forEach(article => {
            const li = document.createElement('li');
            li.textContent = article.title;
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

    async function renderArticleContent(article) {
        try {
            const response = await fetch(article.download_url);
            const markdownText = await response.text();
            // marked.js を使ってMarkdownをHTMLに変換
            const contentHtml = marked.parse(markdownText); 
            
            articleContentEl.innerHTML = `
                <h2>${article.title}</h2>
                <div>${contentHtml}</div>
            `;
        } catch (error) {
            articleContentEl.innerHTML = `<p style="color:red;">記事の読み込みに失敗しました。</p>`;
        }
    }

    searchBoxEl.addEventListener('keyup', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredArticles = allArticles.filter(article =>
            article.title.toLowerCase().includes(searchTerm)
        );
        renderArticleList(filteredArticles);
    });

    main();
});
