// Bascule clair/sombre (maquette test). Clé unique « delivo-test-theme » ; sans stockage, le thème vaut pour la session.
(function () {
  var KEY = "delivo-test-theme";
  var root = document.documentElement;
  var btn = document.querySelector(".theme-toggle");
  if (!btn) return;
  function render() {
    var light = root.getAttribute("data-theme") === "light";
    btn.setAttribute("aria-pressed", light ? "true" : "false");
    btn.setAttribute("aria-label", light ? "Thème clair activé — passer au thème sombre" : "Thème sombre activé — passer au thème clair");
    btn.querySelector(".theme-label").textContent = light ? "Thème sombre" : "Thème clair";
  }
  btn.addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); } catch (e) { /* stockage indisponible : thème conservé pour la session */ }
    render();
  });
  render();
})();
