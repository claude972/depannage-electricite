"use client";
// Installation of the web app on the device. The control itself belongs to the PWA lot
// (components/pwa-registration.tsx); this panel only gives it a place and an explanation.
import { PwaInstallControl } from "../pwa-registration";
import { Icon } from "./icons";

export function InstallPanel() {
  return (
    <section className="panel install-panel" aria-labelledby="install-title">
      <div className="install-head">
        <span className="install-icon">
          <Icon name="bolt" size={18} />
        </span>
        <div>
          <h2 id="install-title">Installer l’application</h2>
          <p>
            Ajoutez Courant à l’écran d’accueil pour l’ouvrir en plein écran. Vos
            dossiers restent chargés depuis le serveur : hors connexion, seule une
            page d’information s’affiche.
          </p>
        </div>
      </div>
      <PwaInstallControl />
    </section>
  );
}
