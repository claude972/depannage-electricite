"use client";

import { PublicChrome } from "./public-chrome";
import { serviceChromeHandlers } from "./public-service-page";
import styles from "./phone-access.module.css";

export function AccountLookupPage() {
  const go = (href: string) => window.location.assign(href);
  return (
    <PublicChrome current="suivi" handlers={serviceChromeHandlers(go)} onHome={() => go("/")}>
      <div className={styles.page}>
        <h1>Suivre ma demande</h1>
        <p className={styles.lead}>Connectez-vous à votre compte par e-mail. Dans « Mes demandes », saisissez votre numéro de commande qui commence par INT-.</p>
        <a className={styles.submit} href="/#auth/requests">Me connecter à mon compte</a>
      </div>
    </PublicChrome>
  );
}
