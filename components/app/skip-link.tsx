"use client";
// « Aller au contenu » : déplace le focus vers le contenu principal sans modifier le hash, que le
// routeur interne de l’application interpréterait comme une navigation vers l’accueil.
export function SkipLink() {
  return (
    <a
      className="skip-link"
      href="#main"
      onClick={(event) => {
        const main = document.getElementById("main") ?? document.querySelector("main");
        if (!(main instanceof HTMLElement)) return;
        event.preventDefault();
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus({ preventScroll: false });
        main.scrollIntoView({ block: "start" });
      }}
    >
      Aller au contenu
    </a>
  );
}
