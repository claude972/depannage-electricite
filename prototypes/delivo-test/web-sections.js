// Onglets du catalogue (maquette test) : motif ARIA « tabs » avec tabindex itinérant ; ←/→, Début/Fin.
(function () {
  var list = document.querySelector('[role="tablist"]');
  if (!list) return;
  var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
  function select(i, focus) {
    tabs.forEach(function (t, j) {
      var on = j === i;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tabs[i].focus();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { select(i, false); });
    t.addEventListener("keydown", function (e) {
      var n = tabs.length, k = e.key, next = null;
      if (k === "ArrowRight") next = (i + 1) % n;
      else if (k === "ArrowLeft") next = (i - 1 + n) % n;
      else if (k === "Home") next = 0;
      else if (k === "End") next = n - 1;
      if (next !== null) { e.preventDefault(); select(next, true); }
    });
  });
})();
