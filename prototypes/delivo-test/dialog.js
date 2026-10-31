// Maquette test : dialogue local uniquement (Échap ferme nativement, le focus revient au déclencheur). Aucun envoi.
(function () {
  const dialog = document.getElementById("test-dialog");
  if (!dialog) return;
  let opener = null;
  window.openDialog = function (subject) {
    document.getElementById("dialog-subject").textContent = subject;
    opener = document.activeElement;
    dialog.showModal();
  };
  dialog.addEventListener("close", function () { if (opener) opener.focus(); });
  document.querySelectorAll("[data-open]").forEach(function (el) {
    el.addEventListener("click", function (e) { e.preventDefault(); window.openDialog(el.getAttribute("data-open")); });
  });
})();
