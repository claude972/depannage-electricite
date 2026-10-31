import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="page-loader">
      <h1>Cette page est introuvable.</h1>
      <p>Retrouvez vos demandes depuis votre espace.</p>
      <Link className="button primary" href="/">
        Revenir à l’accueil
      </Link>
    </main>
  );
}
