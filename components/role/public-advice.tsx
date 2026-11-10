"use client";

import { PUBLIC_ADVICE } from "./public-advice-content";
import { PublicChrome, serviceChromeHandlers } from "./public-chrome";
import styles from "./public-landing.module.css";

export function PublicAdvice() {
  return (
    <PublicChrome current="advice" editorial handlers={serviceChromeHandlers()} onHome={() => window.location.assign("/")}>
      <div className={`${styles.wrap} ${styles.advicePage}`}>
        <a className={styles.textLink} href="/">← Retour à l’accueil</a>
        <header>
          <h1>Le blog du dépannage</h1>
          <p>Des conseils pour décrire une panne, lire un devis et préparer votre rendez-vous.</p>
          <nav aria-label="Articles">
            {PUBLIC_ADVICE.map((article) => <a key={article.id} className={styles.textLink} href={`#${article.id}`}>{article.shortTitle}</a>)}
          </nav>
        </header>
        {PUBLIC_ADVICE.map((article) => (
          <article key={article.id} id={article.id} aria-labelledby={`article-${article.id}`}>
            <h2 id={`article-${article.id}`}>{article.title}</h2>
            {article.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </article>
        ))}
        <a className={styles.textLink} href="/#new">Décrire mon problème →</a>
      </div>
    </PublicChrome>
  );
}
