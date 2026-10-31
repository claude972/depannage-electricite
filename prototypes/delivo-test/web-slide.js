// Carrousel MANUEL à deux diapositives (maquette test) : aucune lecture automatique.
// Flèches et indicateurs (boutons), flèches gauche/droite du clavier dans la zone, aria-current sur l’indicateur actif.
(function () {
  var region = document.querySelector(".photo-hero");
  if (!region) return;
  var slides = Array.prototype.slice.call(region.querySelectorAll(".slide"));
  var dots = Array.prototype.slice.call(region.querySelectorAll(".slide-dot"));
  var index = 0;
  function show(next) {
    index = (next + slides.length) % slides.length;
    slides.forEach(function (s, i) {
      var active = i === index;
      s.hidden = !active;
      s.classList.toggle("is-active", active);
    });
    dots.forEach(function (d, i) {
      if (i === index) d.setAttribute("aria-current", "true");
      else d.removeAttribute("aria-current");
    });
  }
  region.querySelector('[data-slide="prev"]').addEventListener("click", function () { show(index - 1); });
  region.querySelector('[data-slide="next"]').addEventListener("click", function () { show(index + 1); });
  dots.forEach(function (d) {
    d.addEventListener("click", function () { show(Number(d.getAttribute("data-goto"))); });
  });
  region.addEventListener("keydown", function (e) {
    if (e.target.closest("a, input, textarea")) return;
    if (e.key === "ArrowLeft") { show(index - 1); e.preventDefault(); }
    if (e.key === "ArrowRight") { show(index + 1); e.preventDefault(); }
  });
})();
