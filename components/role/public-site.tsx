"use client";
// Public site (mode "public"): landing, request draft, account entry, help and the honest
// informational pages. Presentational only: every action goes through `session`.
import { useEffect, useId, useState } from "react";
import type { PublicSession } from "../app/session-types";
import type { Category, View } from "../app/types";
import { Alerts, Brand, PageTitle, Unavailable } from "../app/ui";
import { AuthForm, RequestForm } from "../app/forms";
import { Icon } from "../app/icons";
import { InstallPanel } from "../app/install-panel";
import { CATEGORIES, category, money } from "../app/format";
import styles from "./public.module.css";

const NAV: { view: View; label: string }[] = [
  { view: "help", label: "Comment ça marche" },
  { view: "pricing", label: "Tarifs" },
  { view: "join", label: "Vous êtes artisan ?" },
];
const FOOTER_LINKS: { view: View; label: string }[] = [
  { view: "help", label: "Aide" },
  { view: "about", label: "À propos" },
  { view: "privacy", label: "Confidentialité" },
  { view: "legal", label: "Mentions légales" },
];
const PUBLIC_VIEWS: View[] = [
  "home",
  "new",
  "auth",
  "help",
  "pricing",
  "join",
  "join-organization",
  "demo",
  "about",
  "privacy",
  "legal",
];
// Wording kept verbatim from the previous public help page.
const FAQ: [string, string][] = [
  [
    "Quelle différence entre estimation et devis ?",
    "L’estimation donne une fourchette indicative. Le devis est établi par l’artisan à partir de votre besoin et détaille les prestations, les taxes et le montant proposé. Vous le validez avant le début des travaux.",
  ],
  [
    "Quand dois-je régler l’intervention ?",
    "Le paiement est proposé une fois l’intervention terminée, sur la base du devis accepté. Le règlement est traité avec Stripe. Une redirection de paiement ne suffit pas à confirmer son encaissement.",
  ],
  [
    "Comment suivre ma demande ?",
    "Dans « Mes demandes », ouvrez une intervention pour consulter son état, son devis et les échanges associés.",
  ],
  [
    "Comment sont attribuées les missions ?",
    "Un artisan éligible accepte une demande disponible. L’attribution est contrôlée pour qu’une même mission ne soit pas acceptée par plusieurs artisans. Aucun délai n’est garanti à ce stade.",
  ],
  [
    "Que couvre la garantie prévue ?",
    "Le projet prévoit un suivi de garantie d’un an. Ses conditions commerciales et son périmètre doivent être définis avant le lancement réel. Aucune couverture supplémentaire n’est promise dans cette version.",
  ],
  [
    "Puis-je gérer plusieurs établissements ?",
    "L’espace professionnel regroupe les sites et leurs interventions. Il distingue copropriétés, restauration, bureaux et établissements recevant du public.",
  ],
  [
    "Puis-je tester sans transmettre mes informations ?",
    "Oui. La démonstration utilise des exemples et conserve ses modifications dans ce navigateur. Elle n’envoie aucune demande à un artisan et ne réalise aucun débit bancaire.",
  ],
];
const JOIN_STEPS: { icon: string; title: string; text: string }[] = [
  {
    icon: "person",
    title: "Informations personnelles",
    text: "Nom, téléphone et adresse email professionnelle : les coordonnées utilisées pour vous joindre au sujet d’une mission.",
  },
  {
    icon: "building",
    title: "Société",
    text: "Raison sociale, SIRET, statut juridique, effectif et adresse de l’entreprise.",
  },
  {
    icon: "document",
    title: "Pièces justificatives",
    text: "Extrait Kbis, attestation d’assurance RC Pro et justificatif de qualification. Les fichiers sont déposés dans un stockage privé et consultés uniquement pour l’examen du dossier.",
  },
  {
    icon: "location",
    title: "Zones d’intervention",
    text: "Les codes postaux que vous couvrez et les types de panne que vous traitez. Vous les modifiez depuis votre espace.",
  },
  {
    icon: "calendar",
    title: "Disponibilité",
    text: "Un indicateur que vous activez ou désactivez à tout moment pour recevoir ou non des missions disponibles.",
  },
];
const LEGAL_SECTIONS: { title: string; fields: string[] }[] = [
  {
    title: "Éditeur",
    fields: [
      "Raison sociale et forme juridique",
      "Adresse du siège",
      "Numéro SIREN et numéro de TVA",
      "Directeur ou directrice de la publication",
      "Adresse de contact",
    ],
  },
  {
    title: "Hébergeur",
    fields: ["Nom de l’hébergeur", "Adresse", "Coordonnées de contact"],
  },
  {
    title: "Propriété intellectuelle",
    fields: ["Titulaire des droits sur le nom, le logo et les contenus"],
  },
  {
    title: "Données personnelles",
    fields: ["Responsable du traitement", "Contact pour l’exercice des droits"],
  },
];
const PENDING = "À renseigner par l’exploitant";

export function PublicSite({ session }: { session: PublicSession }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navId = useId();
  const known = PUBLIC_VIEWS.includes(session.view);
  const view: View = known ? session.view : "home";

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const navigate = (target: View) => {
    setMenuOpen(false);
    session.go(target);
  };
  const login = () => {
    setMenuOpen(false);
    session.setAuthMode("login");
    session.go("auth");
  };
  const signupArtisan = () => {
    session.setAuthMode("signup");
    session.go("auth");
  };
  const newRequest = (c?: Category) => {
    if (c) session.setCategory(c);
    session.go("new");
  };

  return (
    <div className={styles.site}>
      {(session.error || session.notice) && (
        <div className="public-alerts">
          <Alerts
            error={session.error}
            notice={session.notice}
            onClearError={() => session.setError("")}
            onClearNotice={() => session.setNotice("")}
          />
        </div>
      )}
      <div className={styles.headerBar}>
        <header className={styles.header}>
          <button
            type="button"
            className="brand-button"
            onClick={() => navigate("home")}
            aria-label="Courant, accueil"
            aria-current={view === "home" ? "page" : undefined}
          >
            <Brand />
          </button>
          <nav
            id={navId}
            className={`${styles.nav} ${menuOpen ? styles.navOpen : ""}`}
            aria-label="Navigation principale"
          >
            {NAV.map((item) => (
              <button
                type="button"
                key={item.view}
                className={styles.navLink}
                aria-current={view === item.view ? "page" : undefined}
                onClick={() => navigate(item.view)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className={styles.headerActions}>
            <button
              type="button"
              className="button outline"
              aria-current={view === "auth" ? "page" : undefined}
              onClick={login}
            >
              Se connecter
            </button>
            <button
              type="button"
              className={styles.menuButton}
              aria-expanded={menuOpen}
              aria-controls={navId}
              aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name={menuOpen ? "close" : "menu"} size={22} />
            </button>
          </div>
        </header>
      </div>

      <main id="main" className={`public-main ${styles.main}`}>
        {view === "new" ? (
          <RequestForm
            initialCategory={session.categoryId}
            initialValues={session.pendingDraft}
            sites={[]}
            mode="public"
            busy={session.busy}
            onBack={() => session.go("home")}
            onSubmit={async (values) => {
              session.saveDraft(values);
            }}
            onDemo={() => session.startDemo("client", "new")}
          />
        ) : view === "auth" ? (
          <AuthView session={session} />
        ) : view === "help" ? (
          <HelpView onNew={() => newRequest()} />
        ) : view === "pricing" ? (
          <PricingView onNew={() => newRequest()} />
        ) : view === "join" ? (
          <JoinView
            onSignup={signupArtisan}
            onDemo={() => session.startDemo("artisan")}
          />
        ) : view === "join-organization" ? (
          <JoinOrganizationView session={session} />
        ) : view === "demo" ? (
          <DemoEntryView session={session} />
        ) : view === "about" ? (
          <AboutView onNew={() => newRequest()} onJoin={() => navigate("join")} />
        ) : view === "privacy" ? (
          <PrivacyView />
        ) : view === "legal" ? (
          <LegalView />
        ) : (
          <HomeView
            gated={!known}
            onLogin={login}
            onNew={newRequest}
            onDemo={() => session.startDemo()}
            onProfessional={() => session.startDemo("manager")}
          />
        )}
      </main>

      <footer className={`public-footer ${styles.footer}`}>
        <Brand compact />
        <span>Courant est un nom de travail. Application en préparation.</span>
        <nav className={styles.footerNav} aria-label="Informations">
          {FOOTER_LINKS.map((item) => (
            <button
              type="button"
              key={item.view}
              aria-current={view === item.view ? "page" : undefined}
              onClick={() => navigate(item.view)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </footer>
    </div>
  );
}

function HomeView({
  gated,
  onLogin,
  onNew,
  onDemo,
  onProfessional,
}: {
  gated: boolean;
  onLogin: () => void;
  onNew: (c?: Category) => void;
  onDemo: () => void;
  onProfessional: () => void;
}) {
  return (
    <>
      {gated && (
        <div className={`alert warning ${styles.gate}`} role="status">
          <Icon name="lock" />
          <span>Connectez-vous pour accéder à cet espace.</span>
          <button type="button" className="button outline" onClick={onLogin}>
            Se connecter
          </button>
        </div>
      )}
      <section className={`landing ${styles.landing}`}>
        <div className="landing-copy">
          <span className="context-line">
            <span className="mini-bolt">
              <Icon name="bolt" size={16} />
            </span>
            Dépannage électrique pour particuliers et professionnels
          </span>
          <h1>
            Une panne électrique.
            <br />
            Un parcours clair.
          </h1>
          <p>
            Décrivez le problème, consultez une estimation et validez le devis
            de votre artisan. Retrouvez chaque étape au même endroit.
          </p>
          <div className="landing-actions">
            <button
              type="button"
              className="button primary large"
              onClick={() => onNew()}
            >
              <Icon name="plus" />
              Demander une intervention
            </button>
            <button type="button" className="text-button" onClick={onDemo}>
              Explorer la démonstration <Icon name="arrow" size={16} />
            </button>
          </div>
          <div className="landing-assurance">
            <span>
              <Icon name="document" />
              Devis avant intervention
            </span>
            <span>
              <Icon name="lock" />
              Paiement avec Stripe
            </span>
          </div>
        </div>
        <div className="service-board">
          <div className="service-board-head">
            <Icon name="panel" size={24} />
            <span>De la demande à la résolution</span>
            <span className="board-mark">C.</span>
          </div>
          <div className="board-flow">
            <div>
              <span className="flow-node">1</span>
              <section>
                <strong>Vous décrivez la panne</strong>
                <p>Le problème, le lieu et votre besoin.</p>
              </section>
            </div>
            <div>
              <span className="flow-node">2</span>
              <section>
                <strong>Vous validez le devis</strong>
                <p>Un détail des prestations et du prix.</p>
              </section>
            </div>
            <div>
              <span className="flow-node last">
                <Icon name="check" size={18} />
              </span>
              <section>
                <strong>Vous suivez l’intervention</strong>
                <p>Le suivi et les documents réunis.</p>
              </section>
            </div>
          </div>
          <div className="board-note">
            <Icon name="shield" />
            <span>Vous gardez la main sur votre demande.</span>
          </div>
        </div>
      </section>
      <section className="public-services" aria-labelledby="services-title">
        <div className="section-heading">
          <div>
            <h2 id="services-title">Quel est le problème ?</h2>
            <p>Commencez par ce qui vous ressemble le plus.</p>
          </div>
        </div>
        <div className="service-options">
          {CATEGORIES.map((c) => (
            <button type="button" key={c.id} onClick={() => onNew(c.id)}>
              <Icon name={c.icon} size={28} />
              <strong>{c.label}</strong>
              <span>{c.description}</span>
              <Icon name="arrow" size={16} />
            </button>
          ))}
        </div>
      </section>
      <section className="professional-band" aria-labelledby="pro-title">
        <span className="band-icon">
          <Icon name="building" size={38} />
        </span>
        <div>
          <h2 id="pro-title">Plusieurs sites. Un seul espace de suivi.</h2>
          <p>
            Syndics, restaurants, bureaux et établissements recevant du public :
            organisez vos demandes par site.
          </p>
        </div>
        <button type="button" className="button outline" onClick={onProfessional}>
          Découvrir l’espace professionnel
        </button>
      </section>
    </>
  );
}

function AuthView({ session }: { session: PublicSession }) {
  return (
    <div className={styles.authPage}>
      {session.pendingDraft && (
        <div className="alert warning" role="status">
          <Icon name="document" />
          <span>Votre brouillon de demande sera repris après connexion.</span>
        </div>
      )}
      <AuthForm
        mode={session.authMode}
        onMode={(mode) => session.setAuthMode(mode)}
        busy={session.busy}
        onSubmit={async (values) => {
          if (session.authMode === "signup") await session.signUp(values);
          else if (session.authMode === "reset")
            await session.resetPassword(values.email);
          else await session.signIn(values.email, values.password);
        }}
        onDemo={() => session.startDemo("client")}
      />
    </div>
  );
}

function HelpView({ onNew }: { onNew: () => void }) {
  return (
    <div className={styles.page}>
      <PageTitle
        title="Un dépannage, étape par étape."
        subtitle="Comprendre votre demande, votre devis et votre paiement."
      />
      <div className="help-layout">
        <section className="panel faq-panel" aria-labelledby="faq-title">
          <h2 id="faq-title">Questions fréquentes</h2>
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
        <aside>
          <section className="help-panel">
            <Icon name="help" size={30} />
            <h2>Besoin d’une intervention ?</h2>
            <p>
              Commencez par décrire le problème. Vous pourrez préciser le lieu
              et votre besoin.
            </p>
            <button type="button" className="button primary full" onClick={onNew}>
              Créer une demande
            </button>
          </section>
          <section className="panel compact-panel">
            <h3>Contact et informations légales</h3>
            <p>
              Les coordonnées de l’exploitant, les conditions de service et les
              mentions légales seront publiées avant l’ouverture commerciale.
            </p>
            <p>Cette version ne fournit pas de ligne d’urgence.</p>
          </section>
          <InstallPanel />
        </aside>
      </div>
    </div>
  );
}

function PricingView({ onNew }: { onNew: () => void }) {
  return (
    <div className={styles.page}>
      <PageTitle
        title="Comment le prix se forme"
        subtitle="Trois montants distincts jalonnent une intervention : l’estimation indicative, le devis que vous acceptez et le montant effectivement réglé."
      />
      <div className={styles.columns}>
        <div className={styles.stack}>
          <section className={`panel ${styles.block}`} aria-labelledby="pricing-steps">
            <h2 id="pricing-steps">Trois montants, trois moments</h2>
            <ol className={styles.steps}>
              <li>
                <span className={styles.stepNumber}>1</span>
                <div>
                  <strong>L’estimation indicative</strong>
                  <p>
                    Une fourchette affichée dès la description du problème,
                    calculée à partir du type de panne. Elle sert à se situer ;
                    ce n’est ni un prix garanti ni un engagement.
                  </p>
                </div>
              </li>
              <li>
                <span className={styles.stepNumber}>2</span>
                <div>
                  <strong>Le devis de l’artisan</strong>
                  <p>
                    Établi par l’artisan affecté, il détaille les prestations,
                    les quantités, le sous-total, la TVA et le total. Aucun
                    travail ne commence avant que vous l’ayez accepté.
                  </p>
                </div>
              </li>
              <li>
                <span className={styles.stepNumber}>3</span>
                <div>
                  <strong>Le montant réglé</strong>
                  <p>
                    Proposé une fois l’intervention terminée, sur la base du
                    devis accepté. Le règlement est traité avec Stripe ; il
                    n’est considéré comme encaissé qu’après confirmation de la
                    plateforme, jamais sur la seule redirection.
                  </p>
                </div>
              </li>
            </ol>
          </section>
          <Unavailable
            title="Barème officiel, frais de déplacement et majorations"
            reason="À définir par l’exploitant. Aucun tarif public, frais de déplacement ou majoration (soir, week-end, urgence) n’est publié tant que cette décision n’est pas prise."
            blocker="PUB-02"
          />
        </div>
        <div className={styles.stack}>
          <section className={`panel ${styles.block}`} aria-labelledby="pricing-table">
            <h2 id="pricing-table">Fourchettes indicatives par type de panne</h2>
            <table className={styles.table}>
              <caption>
                Fourchettes indicatives de préparation du service, pas un barème
                contractuel.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Type de problème</th>
                  <th scope="col">Fourchette indicative</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((c) => {
                  const k = category(c.id);
                  return (
                    <tr key={c.id}>
                      <th scope="row">
                        <span className={styles.rowLabel}>
                          <span className={styles.rowIcon}>
                            <Icon name={k.icon} size={18} />
                          </span>
                          <span>
                            {k.label}
                            <small>{k.description}</small>
                          </span>
                        </span>
                      </th>
                      <td>
                        {money(k.min)} – {money(k.max)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className={styles.footnote}>
              TVA : selon le taux applicable indiqué sur le devis. Les montants
              ci-dessus n’incluent ni déplacement ni majoration, qui restent à
              définir.
            </p>
          </section>
          <section className={styles.cta}>
            <div>
              <h2>Commencer par le problème</h2>
              <p>
                L’estimation s’affiche dès la première étape, avant toute
                création de compte.
              </p>
            </div>
            <button type="button" className="button primary" onClick={onNew}>
              Décrire mon problème
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function JoinView({ onSignup, onDemo }: { onSignup: () => void; onDemo: () => void }) {
  return (
    <div className={styles.page}>
      <PageTitle
        title="Rejoindre le réseau d’électriciens"
        subtitle="Un dossier en cinq parties, examiné par l’opérateur avant tout accès aux missions."
      />
      <div className={styles.columns}>
        <div className={styles.stack}>
          <section className={`panel ${styles.block}`} aria-labelledby="join-steps">
            <h2 id="join-steps">Ce que contient le dossier</h2>
            <ol className={styles.steps}>
              {JOIN_STEPS.map((step, index) => (
                <li key={step.title}>
                  <span className={styles.stepNumber}>{index + 1}</span>
                  <div>
                    <strong>
                      <Icon name={step.icon} size={16} />
                      {step.title}
                    </strong>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <section className={`panel ${styles.block}`} aria-labelledby="join-review">
            <h2 id="join-review">Comment se déroule l’examen</h2>
            <ul className={styles.list}>
              <li>
                Vous complétez le dossier à votre rythme ; il reste en brouillon
                tant que vous ne le soumettez pas.
              </li>
              <li>
                Une fois soumis, il est examiné par l’opérateur de la
                plateforme. Il n’existe aucune validation automatique.
              </li>
              <li>
                L’opérateur peut demander des compléments, approuver ou
                suspendre un dossier. Vous voyez l’état courant dans votre
                espace.
              </li>
              <li>
                Les missions disponibles ne sont proposées qu’aux dossiers
                approuvés, dans les zones et catégories déclarées.
              </li>
            </ul>
          </section>
        </div>
        <div className={styles.stack}>
          <section className={`panel ${styles.block}`} aria-labelledby="join-space">
            <h2 id="join-space">Ce que l’espace artisan permet</h2>
            <ul className={styles.list}>
              <li>Recevoir, accepter ou décliner une mission disponible.</li>
              <li>
                Établir un devis détaillé (prestations, quantités, TVA) que le
                client accepte avant les travaux.
              </li>
              <li>
                Suivre l’intervention : rendez-vous, déplacement, compte rendu.
              </li>
              <li>
                Suivre le règlement du client, traité avec Stripe, en reliant
                votre compte Stripe depuis votre espace.
              </li>
            </ul>
          </section>
          <Unavailable
            title="Commission, délais de règlement et conditions du réseau"
            reason="Non définis à ce stade. Aucun pourcentage, aucun délai de versement ni condition contractuelle n’est publié avant décision de l’exploitant."
            blocker="Q-PDF-15 / Q-PDF-05"
          />
          <section className={styles.cta}>
            <div>
              <h2>Créer mon compte artisan</h2>
              <p>
                Aucun paiement n’est demandé à l’inscription. Votre dossier
                devra être approuvé avant d’accepter des missions.
              </p>
            </div>
            <div className={styles.ctaActions}>
              <button type="button" className="button primary" onClick={onSignup}>
                Créer mon compte artisan
              </button>
              <button type="button" className="button outline" onClick={onDemo}>
                Explorer l’espace artisan en démonstration
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function AboutView({ onNew, onJoin }: { onNew: () => void; onJoin: () => void }) {
  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageTitle
        title="À propos"
        subtitle="Courant est une application de dépannage électrique en préparation. Cette page décrit ce qu’elle fait, pas plus."
      />
      <section className={`panel ${styles.block}`} aria-labelledby="about-mission">
        <h2 id="about-mission">Ce que fait l’application</h2>
        <p className={styles.lead}>
          Mettre en relation une personne confrontée à une panne électrique et
          un artisan électricien, avec un parcours lisible : description du
          problème, estimation indicative, attribution d’un artisan, devis,
          intervention, puis règlement.
        </p>
        <dl className={styles.definitions}>
          <div>
            <dt>Pour qui</dt>
            <dd>
              Les particuliers ; les artisans électriciens ; les entreprises
              clientes qui gèrent plusieurs sites (copropriétés, restauration,
              bureaux, établissements recevant du public) ; et l’exploitant de
              la plateforme, qui examine les dossiers artisans et supervise les
              interventions.
            </dd>
          </div>
          <div>
            <dt>Devis avant travaux</dt>
            <dd>
              L’estimation affichée est une fourchette indicative. Les travaux
              ne commencent qu’après l’acceptation d’un devis détaillé établi
              par l’artisan.
            </dd>
          </div>
          <div>
            <dt>Paiement après intervention</dt>
            <dd>
              Le règlement est proposé une fois l’intervention terminée, sur la
              base du devis accepté, et traité avec Stripe. Aucun numéro de
              carte n’est stocké par l’application.
            </dd>
          </div>
          <div>
            <dt>Attribution contrôlée</dt>
            <dd>
              Une mission ne peut être acceptée que par un seul artisan
              éligible. Aucun délai d’intervention n’est garanti à ce stade.
            </dd>
          </div>
        </dl>
      </section>
      <section className={`panel ${styles.block}`} aria-labelledby="about-operator">
        <h2 id="about-operator">Exploitant</h2>
        <Unavailable
          title="Identité de l’exploitant, équipe et coordonnées à renseigner"
          reason="Le nom définitif, la société exploitante, les personnes responsables et les moyens de contact seront publiés avant l’ouverture commerciale. Aucune information de substitution n’est affichée."
          blocker="PUB-08 / PUB-09"
        />
      </section>
      <section className={styles.cta}>
        <div>
          <h2>Et maintenant ?</h2>
          <p>Décrivez une panne ou découvrez le dossier artisan.</p>
        </div>
        <div className={styles.ctaActions}>
          <button type="button" className="button primary" onClick={onNew}>
            Demander une intervention
          </button>
          <button type="button" className="button outline" onClick={onJoin}>
            Rejoindre le réseau
          </button>
        </div>
      </section>
    </div>
  );
}

function PrivacyView() {
  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageTitle
        title="Confidentialité"
        subtitle="Ce que l’application enregistre aujourd’hui, où, et ce qui reste à publier."
      />
      <section className={`panel ${styles.block}`} aria-labelledby="privacy-data">
        <h2 id="privacy-data">Données enregistrées par l’application</h2>
        <dl className={styles.definitions}>
          <div>
            <dt>Compte</dt>
            <dd>
              Adresse email, nom complet, rôle choisi et, si vous le renseignez,
              numéro de téléphone. L’authentification est gérée par le service
              d’identité de l’application.
            </dd>
          </div>
          <div>
            <dt>Demandes</dt>
            <dd>
              Type de panne, description, adresse, code postal, ville, niveau
              d’urgence et état de la demande.
            </dd>
          </div>
          <div>
            <dt>Devis</dt>
            <dd>
              Lignes de prestation, montants, taux de TVA, état et date
              d’acceptation.
            </dd>
          </div>
          <div>
            <dt>Messages</dt>
            <dd>
              Les échanges liés à une intervention entre le client et l’artisan
              affecté.
            </dd>
          </div>
          <div>
            <dt>Documents</dt>
            <dd>
              Les fichiers déposés (justificatifs, pièces liées à une
              intervention) sont conservés dans un stockage privé, accessible
              uniquement aux rôles autorisés.
            </dd>
          </div>
          <div>
            <dt>Paiements</dt>
            <dd>
              Le règlement est traité avec Stripe. L’application conserve
              l’état du paiement et son montant ; elle ne stocke aucun numéro
              de carte.
            </dd>
          </div>
        </dl>
      </section>
      <section className={`panel ${styles.block}`} aria-labelledby="privacy-demo">
        <h2 id="privacy-demo">Mode démonstration</h2>
        <p>
          La démonstration n’envoie rien à un serveur : ses exemples et vos
          modifications sont conservés uniquement dans ce navigateur
          (localStorage). Pour les effacer, utilisez le bouton « Réinitialiser »
          du bandeau de démonstration, ou supprimez les données de site de ce
          navigateur.
        </p>
      </section>
      <section className={`panel ${styles.block}`} aria-labelledby="privacy-trackers">
        <h2 id="privacy-trackers">Traceurs et mesure d’audience</h2>
        <p>
          Cette version ne contient aucun traceur publicitaire ni outil de
          mesure d’audience. Un brouillon de demande non envoyé peut être
          conservé localement dans votre navigateur jusqu’à votre connexion.
        </p>
      </section>
      <section className={`panel ${styles.block}`} aria-labelledby="privacy-rights">
        <h2 id="privacy-rights">Vos droits et le contact</h2>
        <Unavailable
          title="Politique complète, contact DPO et préférences : à publier avant ouverture"
          reason="Les modalités d’accès, de rectification et de suppression, la durée de conservation, le contact du délégué à la protection des données et les préférences de confidentialité seront publiés avant l’ouverture commerciale."
          blocker="PUB-10"
        />
      </section>
    </div>
  );
}

function LegalView() {
  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageTitle
        title="Mentions légales"
        subtitle="Structure des mentions obligatoires. Chaque champ sera complété par l’exploitant avant publication."
      />
      {LEGAL_SECTIONS.map((section, index) => (
        <section
          key={section.title}
          className={`panel ${styles.block}`}
          aria-labelledby={`legal-section-${index}`}
        >
          <h2 id={`legal-section-${index}`}>{section.title}</h2>
          <dl className={`${styles.definitions} ${styles.pendingList}`}>
            {section.fields.map((field) => (
              <div key={field}>
                <dt>{field}</dt>
                <dd>{PENDING}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <Unavailable
        title="Mentions légales à compléter"
        reason="Aucune société, adresse ou identifiant fictif n’est affiché. Les informations ci-dessus seront renseignées par l’exploitant avant l’ouverture commerciale."
        blocker="PUB-08"
      />
    </div>
  );
}

// Manually shared organisation invitation: the code is kept in this browser and accepted
// server-side after login, for the verified recipient only. No email is sent by the app.
function JoinOrganizationView({ session }: { session: PublicSession }) {
  const valid = /^[0-9a-f]{64}$/.test(session.param);
  return (
    <section className={`panel ${styles.invitePanel}`} aria-labelledby="join-org-title">
      <span className="empty-icon">
        <Icon name="users" size={28} />
      </span>
      <h1 id="join-org-title">Invitation à rejoindre une organisation</h1>
      {valid ? (
        <>
          <p>
            Un propriétaire d’organisation vous a transmis ce lien. Connectez-vous avec
            l’adresse email qui a reçu l’invitation : elle sera acceptée automatiquement
            après la connexion, puis l’organisation apparaîtra dans votre espace.
          </p>
          <p>
            Le code n’est valable qu’une fois, pour l’adresse invitée, jusqu’à sa date
            d’expiration fixée par le propriétaire.
          </p>
          <div className={styles.inviteActions}>
            <button
              type="button"
              className="button primary"
              onClick={() => session.keepInvitation(session.param)}
            >
              Se connecter pour accepter
            </button>
            <button type="button" className="button outline" onClick={() => session.go("home")}>
              Plus tard
            </button>
          </div>
        </>
      ) : (
        <>
          <p role="alert">
            Ce lien d’invitation est incomplet ou invalide. Demandez un nouveau lien au
            propriétaire de l’organisation.
          </p>
          <button type="button" className="button outline" onClick={() => session.go("home")}>
            Revenir à l’accueil
          </button>
        </>
      )}
    </section>
  );
}

const DEMO_ROLES = ["client", "artisan", "manager", "admin"] as const;
// Explicit demonstration entry (#demo/<role> or #demo/<role>-<view>): isolated examples,
// never a live account. The controller ignores it when a live session exists.
function DemoEntryView({ session }: { session: PublicSession }) {
  const [head, ...rest] = session.param.split("-");
  const role = (DEMO_ROLES as readonly string[]).includes(head)
    ? (head as (typeof DEMO_ROLES)[number])
    : "client";
  const target = rest.join("-");
  useEffect(() => {
    session.startDemo(role, (target || undefined) as View | undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, target]);
  return (
    <section className={`panel ${styles.invitePanel}`} role="status">
      <h1>Ouverture de la démonstration…</h1>
      <p>Données fictives conservées dans ce navigateur. Aucun artisan contacté, aucun débit bancaire.</p>
    </section>
  );
}
