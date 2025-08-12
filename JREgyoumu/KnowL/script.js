document.addEventListener("DOMContentLoaded", () => {
    const categoryList = document.getElementById("category-list");
    const articleList = document.getElementById("article-list");
    const reloadTitle = document.getElementById("reload-title");

    // タイトルクリックで更新
    reloadTitle.addEventListener("click", (e) => {
        e.preventDefault();
        location.reload();
    });

    // JSON読み込み
    fetch("data.json")
        .then(res => res.json())
        .then(data => {
            const categories = [...new Set(data.map(item => item.category))];

            // カテゴリ表示
            categories.forEach(cat => {
                const li = document.createElement("li");
                const a = document.createElement("a");
                a.href = "#";
                a.textContent = cat;
                a.addEventListener("click", (e) => {
                    e.preventDefault();
                    document.querySelectorAll(".sidebar li a").forEach(el => el.classList.remove("active"));
                    a.classList.add("active");
                    showArticles(data.filter(item => item.category === cat));
                });
                li.appendChild(a);
                categoryList.appendChild(li);
            });

            // 全記事表示
            showArticles(data);
        });

    function showArticles(articles) {
        articleList.innerHTML = "";
        articles.forEach(article => {
            const section = document.createElement("article");
            section.innerHTML = `
                <h2>${article.title}</h2>
                <p>${article.content}</p>
                <small>更新日: ${article.last_update}</small>
            `;
            articleList.appendChild(section);
        });
    }
});
