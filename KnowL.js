document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("knowledgeContainer");
  const searchInput = document.getElementById("searchInput");

  fetch("data/knowledge.json")
    .then(response => response.json())
    .then(data => {
      renderCards(data);

      searchInput.addEventListener("input", () => {
        const keyword = searchInput.value.toLowerCase();
        const filtered = data.filter(item =>
          item.title.toLowerCase().includes(keyword) ||
          item.desc.toLowerCase().includes(keyword) ||
          item.content.toLowerCase().includes(keyword)
        );
        renderCards(filtered);
      });
    });

  function renderCards(items) {
    container.innerHTML = "";
    items.forEach(item => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <h3>${item.title}</h3>
        <p><strong>${item.desc}</strong></p>
        <p>${item.content}</p>
      `;
      container.appendChild(card);
    });
  }
});
