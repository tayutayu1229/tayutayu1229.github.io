document.addEventListener("DOMContentLoaded", () => {
    const categoryList = document.getElementById("category-list");
    const tagList = document.getElementById("tag-list");
    const articleList = document.getElementById("article-list");
    const reloadTitle = document.getElementById("reload-title");
    const searchInput = document.getElementById("search-input");
    const sortSelect = document.getElementById("sort-select");
    const resultCount = document.getElementById("result-count");

    let allData = [];
    let filteredData = [];
    let selectedCategory = null;
    let selectedTag = null;

    reloadTitle.addEventListener("click", (e) => {
        e.preventDefault();
        location.reload();
    });

    fetch("data.json")
        .then(res => res.json())
        .then(data => {
            allData = data;
            filteredData = [...allData];

            const categories = [...new Set(data.map(item => item.category))];
            categories.forEach(cat => {
                const li = document.createElement("li");
                const a = document.createElement("a");
                a.href = "#";
                a.textContent = cat;
                a.addEventListener("click", (e) => {
                    e.preventDefault();
                    selectedCategory = cat;
                    selectedTag = null;
                    updateView();
                });
                li.appendChild(a);
                categoryList.appendChild(li);
            });

            const tags = [...new Set(data.flatMap(item => item.tags))];
            tags.forEach(tag => {
                const li = document.createElement("li");
                const a = document.createElement("a");
                a.href = "#";
                a.textContent = tag;
                a.addEventListener("click", (e) => {
                    e.preventDefault();
                    selectedTag = tag;
                    selectedCategory = null;
                    updateView();
                });
                li.appendChild(a);
                tagList.appendChild(li);
            });

            updateView();
        });

    searchInput.addEventListener("input", () => updateView());
    sortSelect.addEventListener("change", () => updateView());

    function updateView() {
        let data = [...allData];

        if (selectedCategory) {
            data = data.filter(item => item.category === selectedCategory);
        }

        if (selectedTag) {
            data = data.filter(item => item.tags.includes(selectedTag));
        }

        const keyword = searchInput.value.trim().toLowerCase();
        if (keyword) {
            data = data.filter(item =>
                item.title.toLowerCase().includes(keyword) ||
                item.content.toLowerCase().includes(keyword) ||
                item.tags.some(tag => tag.toLowerCase().includes(keyword))
            );
        }

        data.sort((a, b) => {
            if (sortSelect.value === "desc") {
                return new Date(b.last_update) - new Date(a.last_update);
            } else {
                return new Date(a.last_update) - new Date(b.last_update);
            }
        });

        filteredData = data;
        showArticles(filteredData);
    }

    function showArticles(articles) {
        articleList.innerHTML = "";
        resultCount.textContent = `表示件数: ${articles.length}件`;

        if (articles.length === 0) {
            articleList.innerHTML = "<p>該当する記事がありません。</p>";
            return;
        }

        articles.forEach((article, index) => {
            const summaryDiv = document.createElement("div");
            summaryDiv.classList.add("article-summary");
            summaryDiv.innerHTML = `
                <h2>${article.title}</h2>
                <p>${article.content.substring(0, 100)}...</p>
            `;

            const detailDiv = document.createElement("div");
            detailDiv.classList.add("article-details");
            detailDiv.innerHTML = `
                <p>${article.content}</p>
                <small>カテゴリ: ${article.category} / タグ: ${article.tags.join(", ")} / 更新日: ${article.last_update}</small>
            `;

            summaryDiv.addEventListener("click", () => {
                detailDiv.style.display = (detailDiv.style.display === "block") ? "none" : "block";
            });

            articleList.appendChild(summaryDiv);
            articleList.appendChild(detailDiv);
        });
    }
});
