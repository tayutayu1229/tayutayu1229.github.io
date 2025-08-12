// ====== データ読み込み ======
fetch("data.json")
  .then(res => res.json())
  .then(data => {
    window.knowledgeData = data;
    initCategories();
    displayArticles(data);
  })
  .catch(err => {
    console.error("データ読み込みエラー:", err);
  });

// ====== カテゴリ生成 ======
function initCategories() {
  const categoryList = document.getElementById("category-list");
  categoryList.innerHTML = ""; // 初期化

  // 重複を排除してカテゴリ一覧生成
  const categories = [...new Set(window.knowledgeData.map(a => a.category))];

  categories.forEach(cat => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "#";
    a.className = "cat-link";
    a.textContent = cat;
    a.addEventListener("click", e => {
      e.preventDefault();
      // 選択状態の更新
      document.querySelectorAll(".cat-link").forEach(link => link.classList.remove("active"));
      a.classList.add("active");
      filterByCategory(cat);
    });
    li.appendChild(a);
    categoryList.appendChild(li);
  });
}

// ====== 記事一覧表示（タイトルのみ → クリックで詳細） ======
function displayArticles(articles) {
  const list = document.getElementById("article-list");
  list.innerHTML = "";
  document.getElementById("result-count").textContent = `${articles.length} 件のナレッジがあります`;

  articles.forEach(article => {
    // タイトル部分
    const summaryDiv = document.createElement("div");
    summaryDiv.className = "article-summary";
    summaryDiv.innerHTML = `<h2>${article.title}</h2>`;

    // 詳細部分（初期は非表示）
    const detailsDiv = document.createElement("div");
    detailsDiv.className = "article-details";
    detailsDiv.style.display = "none";
    detailsDiv.innerHTML = `
      <p>${article.content}</p>
      <div class="meta">カテゴリ: ${article.category} / 更新日: ${article.updated}</div>
    `;

    // タイトルクリックで詳細表示/非表示
    summaryDiv.addEventListener("click", () => {
      const isVisible = detailsDiv.style.display === "block";
      document.querySelectorAll(".article-details").forEach(el => el.style.display = "none"); // 他を閉じる
      detailsDiv.style.display = isVisible ? "none" : "block";
    });

    list.appendChild(summaryDiv);
    list.appendChild(detailsDiv);
  });
}

// ====== カテゴリフィルタ ======
function filterByCategory(cat) {
  const filtered = window.knowledgeData.filter(a => a.category === cat);
  displayArticles(filtered);
}

// ====== 検索機能（サイドバー） ======
document.getElementById("search-box").addEventListener("input", e => {
  const keyword = e.target.value.toLowerCase();
  const filtered = window.knowledgeData.filter(a =>
    a.title.toLowerCase().includes(keyword) ||
    a.content.toLowerCase().includes(keyword)
  );
  displayArticles(filtered);
});
