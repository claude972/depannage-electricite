// Bannière « Nous rejoindre » : dialogue local de candidature factice (rien n’est envoyé). Échap ferme ; focus rendu au bouton.
(function () {
  var btn = document.getElementById("join-open");
  var dlg = document.getElementById("join-dialog");
  if (!btn || !dlg) return;
  btn.addEventListener("click", function () { dlg.showModal(); });
  dlg.addEventListener("close", function () {
    dlg.querySelector("form").reset();
    btn.focus();
  });
})();
