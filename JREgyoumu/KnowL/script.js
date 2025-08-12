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

  const categories = [...new Set(window.knowledgeData.map(a => a.category))];

  categories.forEach(cat => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "#";
    a.className = "cat-link";
    a.textContent = cat;
    a.addEventListener("click", e => {
      e.preventDefault();
      document.querySelectorAll(".cat-link").forEach(link => link.classList.remove("active"));
      a.classList.add("active");
      filterByCategory(cat);
    });
    li.appendChild(a);
    categoryList.appendChild(li);
  });
}

// ====== 記事一覧表示（タイトルのみ、クリックでモーダル表示） ======
function displayArticles(articles) {
  const list = document.getElementById("article-list");
  list.innerHTML = "";
  document.getElementById("result-count").textContent = `${articles.length} 件のナレッジがあります`;

  articles.forEach(article => {
    const summaryDiv = document.createElement("div");
    summaryDiv.className = "article-summary";
    summaryDiv.innerHTML = `<h2>${article.title}</h2>`;

    // タイトルクリックでモーダル表示
    summaryDiv.addEventListener("click", () => {
      openModal(article);
    });

    list.appendChild(summaryDiv);
  });
}

// ====== カテゴリフィルタ ======
function filterByCategory(cat) {
  const filtered = window.knowledgeData.filter(a => a.category === cat);
  displayArticles(filtered);
}

// ====== 検索機能 ======
document.getElementById("search-box").addEventListener("input", e => {
  const keyword = e.target.value.toLowerCase();
  const filtered = window.knowledgeData.filter(a =>
    a.title.toLowerCase().includes(keyword) ||
    a.content.toLowerCase().includes(keyword)
  );
  displayArticles(filtered);
});

// ====== モーダル表示関連 ======
// モーダルのHTML要素を作る or 既にあれば再利用
let modalOverlay = null;

function createModal() {
  modalOverlay = document.createElement("div");
  modalOverlay.id = "modal-overlay";
  modalOverlay.style.position = "fixed";
  modalOverlay.style.top = 0;
  modalOverlay.style.left = 0;
  modalOverlay.style.width = "100%";
  modalOverlay.style.height = "100%";
  modalOverlay.style.backgroundColor = "rgba(0,0,0,0.5)";
  modalOverlay.style.display = "flex";
  modalOverlay.style.justifyContent = "center";
  modalOverlay.style.alignItems = "center";
  modalOverlay.style.zIndex = "1000";

  const modalBox = document.createElement("div");
  modalBox.id = "modal-box";
  modalBox.style.backgroundColor = "white";
  modalBox.style.padding = "24px";
  modalBox.style.borderRadius = "8px";
  modalBox.style.maxWidth = "600px";
  modalBox.style.width = "90%";
  modalBox.style.maxHeight = "80vh";
  modalBox.style.overflowY = "auto";
  modalBox.style.position = "relative";
  modalOverlay.appendChild(modalBox);

  // 閉じるボタン
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "閉じる";
  closeBtn.style.position = "absolute";
  closeBtn.style.top = "12px";
  closeBtn.style.right = "12px";
  closeBtn.style.backgroundColor = "var(--jr-green)";
  closeBtn.style.color = "white";
  closeBtn.style.border = "none";
  closeBtn.style.borderRadius = "4px";
  closeBtn.style.padding = "6px 12px";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.fontWeight = "bold";
  closeBtn.addEventListener("click", closeModal);
  modalBox.appendChild(closeBtn);

  // 内容入れるコンテナ
  const contentDiv = document.createElement("div");
  contentDiv.id = "modal-content";
  contentDiv.style.marginTop = "32px";
  modalBox.appendChild(contentDiv);

  // オーバーレイクリックで閉じる
  modalOverlay.addEventListener("click", e => {
    if (e.target === modalOverlay) {
      closeModal();
    }
  });

  document.body.appendChild(modalOverlay);
}

function openModal(article) {
  if (!modalOverlay) {
    createModal();
  }

  const contentDiv = document.getElementById("modal-content");
  contentDiv.innerHTML = `
    <h2 style="color: var(--jr-green); margin-top:0;">${article.title}</h2>
    <p style="white-space: pre-wrap; line-height: 1.6;">${article.content}</p>
    <div style="color:#666; font-size: 0.9rem; margin-top:12px;">
      カテゴリ: ${article.category} / 更新日: ${article.updated}
    </div>
  `;

  modalOverlay.style.display = "flex";
}

function closeModal() {
  if (modalOverlay) {
    modalOverlay.style.display = "none";
  }
}
