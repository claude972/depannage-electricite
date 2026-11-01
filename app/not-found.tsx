import Link from "next/link";
import { Brand } from "@/components/app/ui";
import { ThemeSurface } from "@/components/app/theme-provider";
import { ThemeToggle } from "@/components/app/theme-toggle";
import styles from "./error-pages.module.css";

export default function NotFound() {
  return (
    <ThemeSurface className={styles.page}>
      <header className={styles.bar}>
        <Link className={styles.home} href="/" aria-label="Courant, retour à l’accueil">
          <Brand compact />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className={styles.main}>
        <section className={styles.card} aria-labelledby="not-found-title">
          <p className={styles.code}>Erreur 404</p>
          <h1 id="not-found-title">Cette page est introuvable.</h1>
          <p>Retrouvez vos demandes depuis votre espace, ou décrivez une nouvelle panne.</p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/">
              Revenir à l’accueil
            </Link>
            <Link className={styles.secondary} href="/#new">
              Nouvelle demande
            </Link>
          </div>
        </section>
      </main>
    </ThemeSurface>
  );
}
