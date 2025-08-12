let allData = [];

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("knowledgeContainer");
  const searchInput = document.getElementById("searchInput");

  fetch("data/knowledge.json")
    .then(response => response.json())
    .then(data => {
      allData = data;
      renderCards(data);

      searchInput.addEventListener("input", () => {
        const keyword = searchInput.value.toLowerCase();
        const filtered = allData.filter(item =>
          item.title.toLowerCase().includes(keyword) ||
          item.desc.toLowerCase().includes(keyword) ||
          item.content.toLowerCase().includes(keyword)
        );
        renderCards(filtered);
      });
    });
});

function renderCards(items) {
  const container = document.getElementById("knowledgeContainer");
  container.innerHTML = "";
  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${item.title}</h3>
      <p><strong>${item.desc}</strong></p>
      <div>${marked.parse(item.content)}</div>
      ${item.category ? `<p style="font-size:0.9em;color:#555;">カテゴリ: ${item.category}</p>` : ""}
    `;
    container.appendChild(card);
  });
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function filterByCategory(category) {
  const filtered = category
    ? allData.filter(item => item.category === category)
    : allData;
  renderCards(filtered);
}
