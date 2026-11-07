"use client";
import { Brand } from "@/components/app/ui";
import { ThemeSurface } from "@/components/app/theme-provider";
import { ThemeToggle } from "@/components/app/theme-toggle";
import styles from "./error-pages.module.css";

// Generic message only: the error object (message, stack, digest) is never rendered.
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ThemeSurface className={styles.page}>
      <header className={styles.bar}>
        <a className={styles.home} href="/" aria-label="Retour à l’accueil">
          <Brand compact />
        </a>
        <ThemeToggle />
      </header>
      <main id="main" className={styles.main}>
        <section className={styles.card} aria-labelledby="error-title">
          <h1 id="error-title">Votre espace n’a pas pu être chargé.</h1>
          <p>Vos données enregistrées sont conservées. Vous pouvez réessayer.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => reset()}>
              Réessayer
            </button>
            <a className={styles.secondary} href="/">
              Revenir à l’accueil
            </a>
          </div>
        </section>
      </main>
    </ThemeSurface>
  );
}
