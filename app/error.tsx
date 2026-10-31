"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="page-loader">
      <h1>Votre espace n’a pas pu être chargé.</h1>
      <p>Vos données enregistrées sont conservées. Vous pouvez réessayer.</p>
      <button className="button primary" onClick={reset}>
        Réessayer
      </button>
    </main>
  );
}
