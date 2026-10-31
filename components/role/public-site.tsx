"use client";
// Public site (mode "public"): landing, request draft, account entry, help and the honest
// informational pages. Presentational only: every action goes through `session`.
// Visual references (addendum « pages publiques »): M11/M51 (home), M46/M70/M42 (help), M38
// (pricing), M60 (join), V8-C03 (about), V8-C05 (privacy), M63 (legal), M49 (auth). Every number,
// promise, team or contact of those mockups is an example and is never reproduced here.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { PublicSession } from "../app/session-types";
import type { Category, View } from "../app/types";
import { Alerts, Brand, PageTitle, Unavailable } from "../app/ui";
import { AuthForm, RequestForm } from "../app/forms";
import { Icon } from "../app/icons";
import { InstallPanel } from "../app/install-panel";
import { CATEGORIES, category, money } from "../app/format";
import { ABOUT_VALUES, FAQ, HELP_PROCESS, HOME_FACTS, HOME_STEPS, JOIN_FACTS, JOIN_REVIEW, JOIN_STEPS, JOIN_TILES, LEGAL_SECTIONS, PENDING, PRIVACY_DATA, numbered, pricingRows } from "./public-lists";
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
const PUBLIC_VIEWS: View[] = ["home", "new", "auth", "help", "pricing", "join", "join-organization", "demo", "about", "privacy", "legal"];

export function PublicSite({ session }: { session: PublicSession }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navId = useId();
  const menuToggle = useRef<HTMLButtonElement>(null);
  const known = PUBLIC_VIEWS.includes(session.view);
  const view: View = known ? session.view : "home";

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuToggle.current?.focus();
      }
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
          <Alerts error={session.error} notice={session.notice} onClearError={() => session.setError("")} onClearNotice={() => session.setNotice("")} />
        </div>
      )}
      <div className={styles.headerBar}>
        <header className={styles.header}>
          <button type="button" className="brand-button" onClick={() => navigate("home")} aria-label="Courant, accueil" aria-current={view === "home" ? "page" : undefined}>
            <Brand />
          </button>
          <nav id={navId} className={`${styles.nav} ${menuOpen ? styles.navOpen : ""}`} aria-label="Navigation principale">
            {NAV.map((item) => (
              <button type="button" key={item.view} className={styles.navLink} aria-current={view === item.view ? "page" : undefined} onClick={() => navigate(item.view)}>
                {item.label}
              </button>
            ))}
          </nav>
          <div className={styles.headerActions}>
            <button type="button" className={`button outline ${styles.loginButton}`} aria-current={view === "auth" ? "page" : undefined} onClick={login}>
              <Icon name="person" size={16} />
              Se connecter
            </button>
            <button ref={menuToggle} type="button" className={styles.menuButton} aria-expanded={menuOpen} aria-controls={navId} aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"} onClick={() => setMenuOpen((open) => !open)}>
              <Icon name={menuOpen ? "close" : "menu"} size={22} />
            </button>
          </div>
        </header>
      </div>

      <main id="main" className={`public-main ${styles.main}`}>
        {view === "new" ? (
          <RequestForm initialCategory={session.categoryId} initialValues={session.pendingDraft} sites={[]} mode="public" busy={session.busy} onBack={() => session.go("home")} onSubmit={async (values) => { session.saveDraft(values); }} onDemo={() => session.startDemo("client", "new")} />
        ) : view === "auth" ? (
          <AuthView session={session} />
        ) : view === "help" ? (
          <HelpView onNew={() => newRequest()} />
        ) : view === "pricing" ? (
          <PricingView onNew={() => newRequest()} />
        ) : view === "join" ? (
          <JoinView onSignup={signupArtisan} onDemo={() => session.startDemo("artisan")} />
        ) : view === "join-organization" ? (
          <JoinOrganizationView session={session} />
        ) : view === "demo" ? (
          <DemoEntryView session={session} />
        ) : view === "about" ? (
          <AboutView onNew={() => newRequest()} onJoin={() => navigate("join")} />
        ) : view === "privacy" ? (
          <PrivacyView onHome={() => navigate("home")} />
        ) : view === "legal" ? (
          <LegalView onHome={() => navigate("home")} />
        ) : (
          <HomeView gated={!known} onLogin={login} onNew={newRequest} onDemo={() => session.startDemo()} onProfessional={() => session.startDemo("manager")} />
        )}
      </main>

      <footer className={`public-footer ${styles.footer}`}>
        <Brand compact />
        <span>Courant est un nom de travail. Application en préparation.</span>
        <nav className={styles.footerNav} aria-label="Informations">
          {FOOTER_LINKS.map((item) => (
            <button type="button" key={item.view} aria-current={view === item.view ? "page" : undefined} onClick={() => navigate(item.view)}>
              {item.label}
            </button>
          ))}
        </nav>
      </footer>
    </div>
  );
}

// ---- Shared pieces --------------------------------------------------------------------------
/** Small blue pill above a title (M46, V8-C03 section labels). */
function Kicker({ icon = "bolt", children }: { icon?: string; children: ReactNode }) {
  return (
    <span className={styles.kicker}>
      <Icon name={icon} size={14} />
      {children}
    </span>
  );
}
/** Icon tile + title + text, used by steps, facts, tiles and value cards. */
function IconTile({ icon, size = 44 }: { icon: string; size?: number }) {
  return (
    <span className={styles.tile} style={{ width: size, height: size }} aria-hidden="true">
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </span>
  );
}
function StepsRow({ steps, numbered: withNumbers = true, columns }: { steps: { icon: string; title: string; text: string }[]; numbered?: boolean; columns: 3 | 4 }) {
  return (
    <ol className={`${styles.stepsRow} ${columns === 4 ? styles.stepsRow4 : ""}`}>
      {steps.map((step, index) => (
        <li key={step.title}>
          <span className={styles.stepVisual}>
            <IconTile icon={step.icon} size={56} />
            {withNumbers && <span className={styles.stepBadge}>{index + 1}</span>}
          </span>
          <div>
            <strong>{step.title}</strong>
            <p>{step.text}</p>
          </div>
          {index < steps.length - 1 && <span className={styles.stepArrow} aria-hidden="true"><Icon name="arrow" size={18} /></span>}
        </li>
      ))}
    </ol>
  );
}
function FactsStrip({ facts, columns }: { facts: { icon: string; title: string; text: string }[]; columns: 3 | 4 }) {
  return (
    <ul className={`${styles.facts} ${columns === 3 ? styles.facts3 : ""}`}>
      {facts.map((fact) => (
        <li key={fact.title}>
          <IconTile icon={fact.icon} size={40} />
          <div>
            <strong>{fact.title}</strong>
            <span>{fact.text}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
function Crumb({ onHome, current }: { onHome: () => void; current: string }) {
  return (
    <nav className={styles.crumb} aria-label="Fil d’Ariane">
      <button type="button" className="text-button" onClick={onHome}>Accueil</button>
      <span aria-hidden="true">›</span>
      <span aria-current="page">{current}</span>
    </nav>
  );
}

// ---- Home (M11 + M51) ----------------------------------------------------------------------
function HomeView({ gated, onLogin, onNew, onDemo, onProfessional }: { gated: boolean; onLogin: () => void; onNew: (c?: Category) => void; onDemo: () => void; onProfessional: () => void }) {
  return (
    <>
      {gated && (
        <div className={`alert warning ${styles.gate}`} role="status">
          <Icon name="lock" />
          <span>Connectez-vous pour accéder à cet espace.</span>
          <button type="button" className="button outline" onClick={onLogin}>Se connecter</button>
        </div>
      )}
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <Kicker>Dépannage électrique pour particuliers et professionnels</Kicker>
            <h1 id="home-title">
              Une panne électrique.
              <br />
              <span className={styles.accent}>Un parcours clair.</span>
            </h1>
            <p>Décrivez le problème, consultez une estimation indicative et validez le devis de votre artisan. Chaque étape reste au même endroit.</p>
            <div className={styles.heroActions}>
              <button type="button" className={`button primary large ${styles.heroCta}`} onClick={() => onNew()}>
                Demander une intervention
                <Icon name="arrow" size={18} />
              </button>
              <button type="button" className={`text-button ${styles.demoLink}`} onClick={onDemo}>
                Explorer la démonstration <Icon name="arrow" size={16} />
              </button>
            </div>
          </div>
          {/* PUBLIC-HERO-001: illustration derived from reference mockup M41 (vol. 3 p10), no face,
              no badge, no brand; not an artisan of the platform (traceability in the contract). */}
          <figure className={styles.heroFigure}>
            <img src="/images/public-hero-m41.jpg" width={346} height={306} alt="Illustration : un électricien devant un tableau électrique." loading="eager" decoding="async" />
            <figcaption>Illustration issue des maquettes de référence — pas un artisan de la plateforme.</figcaption>
          </figure>
        </div>
      </section>
      <section className={styles.stepsCard} aria-label="Les trois étapes">
        <StepsRow steps={HOME_STEPS} columns={3} />
      </section>
      <FactsStrip facts={HOME_FACTS} columns={4} />
      <section className={styles.categorySection} aria-labelledby="services-title">
        <div className={styles.sectionHead}>
          <h2 id="services-title">Quel est le problème ?</h2>
          <p>Commencez par ce qui vous ressemble le plus. L’estimation s’affiche dès la première étape.</p>
        </div>
        <div className={styles.categories}>
          {CATEGORIES.map((c) => (
            <button type="button" key={c.id} onClick={() => onNew(c.id)}>
              <IconTile icon={c.icon} size={44} />
              <strong>{c.label}</strong>
              <span>{c.description}</span>
              <Icon name="arrow" size={16} />
            </button>
          ))}
        </div>
      </section>
      <section className={styles.proBand} aria-labelledby="pro-title">
        <IconTile icon="building" size={64} />
        <div>
          <h2 id="pro-title">Plusieurs sites. Un seul espace de suivi.</h2>
          <p>Syndics, restaurants, bureaux et établissements recevant du public : organisez vos demandes par site.</p>
        </div>
        <button type="button" className="button outline" onClick={onProfessional}>Découvrir l’espace professionnel</button>
      </section>
    </>
  );
}

// ---- Account entry (M49: centred card; the shared form is untouched) -------------------------
function AuthView({ session }: { session: PublicSession }) {
  return (
    <div className={styles.authPage}>
      {session.pendingDraft && (
        <div className="alert warning" role="status">
          <Icon name="document" />
          <span>Votre brouillon de demande sera repris après connexion.</span>
        </div>
      )}
      <AuthForm mode={session.authMode} onMode={(mode) => session.setAuthMode(mode)} busy={session.busy} onSubmit={async (values) => { if (session.authMode === "signup") await session.signUp(values); else if (session.authMode === "reset") await session.resetPassword(values.email); else await session.signIn(values.email, values.password); }} onDemo={() => session.startDemo("client")} />
    </div>
  );
}

// ---- Help (M46 process + M70 FAQ + M42 column) ---------------------------------------------
function HelpView({ onNew }: { onNew: () => void }) {
  return (
    <div className={styles.page}>
      <Kicker>Dépannage électrique</Kicker>
      <PageTitle title="Comment ça marche" subtitle="Comprendre votre demande, votre devis et votre paiement, étape par étape." />
      <section className={`panel ${styles.processCard}`} aria-labelledby="process-title">
        <h2 id="process-title" className={styles.processTitle}>Le parcours en quatre étapes</h2>
        <StepsRow steps={HELP_PROCESS} columns={4} />
      </section>
      <div className={styles.helpLayout}>
        <section className={`panel ${styles.faqPanel}`} aria-labelledby="faq-title">
          <h2 id="faq-title"><IconTile icon="help" size={36} />Questions fréquentes</h2>
          <div className={styles.faqList}>
            {FAQ.map((item) => (
              <details key={item.question} className={styles.faqItem}>
                <summary>
                  <IconTile icon={item.icon} size={36} />
                  <span className={styles.faqQuestion}>{item.question}</span>
                  <Icon name="arrow" size={18} />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
          <div className={styles.faqFoot}>
            <IconTile icon="message" size={40} />
            <div>
              <strong>Vous ne trouvez pas votre réponse ?</strong>
              <span>Une fois connecté, l’assistance répond dans votre espace. Aucun appel, email ni SMS n’est promis.</span>
            </div>
          </div>
        </section>
        <aside className={styles.helpAside}>
          <section className={styles.helpCta}>
            <IconTile icon="bolt" size={44} />
            <h2>Besoin d’une intervention ?</h2>
            <p>Commencez par décrire le problème. Vous pourrez préciser le lieu et votre besoin.</p>
            <button type="button" className="button primary full" onClick={onNew}>Créer une demande</button>
          </section>
          <section className={`panel ${styles.block}`}>
            <h3>Contact et informations légales</h3>
            <p>Les coordonnées de l’exploitant, les conditions de service et les mentions légales seront publiées avant l’ouverture commerciale.</p>
            <p>Cette version ne fournit pas de ligne d’urgence.</p>
          </section>
          <InstallPanel />
        </aside>
      </div>
    </div>
  );
}

// ---- Pricing (M38) --------------------------------------------------------------------------
function PricingView({ onNew }: { onNew: () => void }) {
  const rows = pricingRows(CATEGORIES, category);
  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Les prix, <span className={styles.accent}>en trois montants</span></h1>
          <p className={styles.subtitle}>L’estimation indicative, le devis que vous acceptez et le montant effectivement réglé sont trois choses distinctes.</p>
        </div>
        <Unavailable title="Barème officiel, frais de déplacement et majorations" reason="À définir par l’exploitant. Aucun tarif public, frais de déplacement ou majoration (soir, week-end, urgence) n’est publié tant que cette décision n’est pas prise." blocker="PUB-02" />
      </div>
      <section className={`panel ${styles.priceTableCard}`} aria-labelledby="pricing-table">
        <h2 id="pricing-table" className={styles.srOnly}>Fourchettes indicatives par type de panne</h2>
        <table className={styles.table}>
          <caption>Fourchettes indicatives de préparation du service, pas un barème contractuel.</caption>
          <thead>
            <tr>
              <th scope="col">Type de problème</th>
              <th scope="col">Fourchette indicative</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <span className={styles.rowLabel}>
                    <IconTile icon={row.icon} size={40} />
                    <span>
                      {row.label}
                      <small>{row.description}</small>
                    </span>
                  </span>
                </th>
                <td>{money(row.min)} – {money(row.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.footnote}>TVA : selon le taux applicable indiqué sur le devis. Les montants ci-dessus n’incluent ni déplacement ni majoration, qui restent à définir.</p>
      </section>
      <section className={`panel ${styles.block}`} aria-labelledby="pricing-steps">
        <h2 id="pricing-steps">Trois montants, trois moments</h2>
        <ol className={`${styles.steps} ${styles.steps3}`}>
          <li>
            <span className={styles.stepNumber}>1</span>
            <div>
              <strong>L’estimation indicative</strong>
              <p>Une fourchette affichée dès la description du problème, calculée à partir du type de panne. Elle sert à se situer ; ce n’est ni un prix garanti ni un engagement.</p>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>2</span>
            <div>
              <strong>Le devis de l’artisan</strong>
              <p>Établi par l’artisan affecté, il détaille les prestations, les quantités, le sous-total, la TVA et le total. Aucun travail ne commence avant que vous l’ayez accepté.</p>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>3</span>
            <div>
              <strong>Le montant réglé</strong>
              <p>Proposé une fois l’intervention terminée, sur la base du devis accepté. Le règlement est traité avec Stripe ; il n’est considéré comme encaissé qu’après confirmation de la plateforme, jamais sur la seule redirection.</p>
            </div>
          </li>
        </ol>
      </section>
      <section className={styles.cta}>
        <div>
          <h2>Commencer par le problème</h2>
          <p>L’estimation s’affiche dès la première étape, avant toute création de compte.</p>
        </div>
        <button type="button" className="button primary" onClick={onNew}>Décrire mon problème <Icon name="arrow" size={16} /></button>
      </section>
    </div>
  );
}

// ---- Join the network (M60) -----------------------------------------------------------------
function JoinView({ onSignup, onDemo }: { onSignup: () => void; onDemo: () => void }) {
  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Rejoindre le réseau <span className={styles.accent}>d’électriciens</span></h1>
          <p className={styles.subtitle}>Un dossier en cinq parties, examiné par l’opérateur avant tout accès aux missions.</p>
        </div>
      </div>
      <FactsStrip facts={JOIN_FACTS} columns={3} />
      <div className={styles.columns}>
        <div className={styles.stack}>
          <section className={`panel ${styles.block}`} aria-labelledby="join-tiles">
            <h2 id="join-tiles"><IconTile icon="star" size={36} />Ce que l’espace artisan permet</h2>
            <ul className={styles.tiles}>
              {JOIN_TILES.map((tile) => (
                <li key={tile.title}>
                  <IconTile icon={tile.icon} size={44} />
                  <strong>{tile.title}</strong>
                  <span>{tile.text}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className={`panel ${styles.block}`} aria-labelledby="join-review">
            <h2 id="join-review">Comment se déroule l’examen</h2>
            <ul className={styles.list}>
              {JOIN_REVIEW.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </section>
        </div>
        <div className={styles.stack}>
          <section className={`panel ${styles.block}`} aria-labelledby="join-steps">
            <h2 id="join-steps"><IconTile icon="check" size={36} />Ce que contient le dossier</h2>
            <ol className={styles.checklist}>
              {JOIN_STEPS.map((step) => (
                <li key={step.title}>
                  <span className={styles.checkMark} aria-hidden="true"><Icon name="check" size={14} /></span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <Unavailable title="Commission, délais de règlement et conditions du réseau" reason="Non définis à ce stade. Aucun pourcentage, aucun délai de versement ni condition contractuelle n’est publié avant décision de l’exploitant." blocker="Q-PDF-15 / Q-PDF-05" />
          <section className={styles.cta}>
            <div>
              <h2>Créer mon compte artisan</h2>
              <p>Aucun paiement n’est demandé à l’inscription. Votre dossier devra être approuvé avant d’accepter des missions.</p>
            </div>
            <div className={`${styles.ctaActions} ${styles.ctaStack}`}>
              <button type="button" className={`button primary ${styles.wideCta}`} onClick={onSignup}>Créer mon compte artisan <Icon name="arrow" size={16} /></button>
              <button type="button" className="button outline" onClick={onDemo}>Explorer l’espace artisan en démonstration</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---- About (V8-C03) -------------------------------------------------------------------------
function AboutView({ onNew, onJoin }: { onNew: () => void; onJoin: () => void }) {
  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="about-title">
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <h1 id="about-title" className={styles.title}>À propos de Courant</h1>
            <p>Une application de dépannage électrique en préparation. Cette page décrit ce qu’elle fait, pas plus.</p>
            <span className={styles.rule} aria-hidden="true" />
          </div>
        </div>
      </section>
      <div className={styles.aboutColumns}>
        <section aria-labelledby="about-mission" className={styles.aboutMission}>
          <Kicker icon="bolt">Ce que fait l’application</Kicker>
          <h2 id="about-mission">Mettre en relation, sans ambiguïté sur le prix</h2>
          <p className={styles.lead}>Mettre en relation une personne confrontée à une panne électrique et un artisan électricien, avec un parcours lisible : description du problème, estimation indicative, attribution d’un artisan, devis, intervention, puis règlement.</p>
          <p>Pour les particuliers ; les artisans électriciens ; les entreprises clientes qui gèrent plusieurs sites (copropriétés, restauration, bureaux, établissements recevant du public) ; et l’exploitant de la plateforme, qui examine les dossiers artisans et supervise les interventions.</p>
          <div className={styles.aboutCta}>
            <IconTile icon="bolt" size={44} />
            <div>
              <strong>Besoin d’un électricien ?</strong>
              <span>Décrivez la panne ; l’estimation indicative s’affiche avant toute création de compte.</span>
              <button type="button" className="text-button" onClick={onNew}>Demander une intervention <Icon name="arrow" size={14} /></button>
            </div>
          </div>
        </section>
        <section aria-labelledby="about-values">
          <Kicker icon="shield">Ce qui guide le service</Kicker>
          <h2 id="about-values">Trois règles, sans exception</h2>
          <ul className={styles.valueCards}>
            {ABOUT_VALUES.map((value) => (
              <li key={value.title}>
                <IconTile icon={value.icon} size={44} />
                <strong>{value.title}</strong>
                <span>{value.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className={`panel ${styles.block} ${styles.narrowBlock}`} aria-labelledby="about-operator">
        <h2 id="about-operator">Exploitant, équipe et histoire</h2>
        <Unavailable title="Identité de l’exploitant, équipe et coordonnées à renseigner" reason="Le nom définitif, la société exploitante, les personnes responsables et les moyens de contact seront publiés avant l’ouverture commerciale. Aucune information de substitution n’est affichée." blocker="PUB-08 / PUB-09" />
      </section>
      <section className={`${styles.cta} ${styles.narrowBlock}`}>
        <div>
          <h2>Et maintenant ?</h2>
          <p>Décrivez une panne ou découvrez le dossier artisan.</p>
        </div>
        <div className={styles.ctaActions}>
          <button type="button" className="button primary" onClick={onNew}>Demander une intervention</button>
          <button type="button" className="button outline" onClick={onJoin}>Rejoindre le réseau</button>
        </div>
      </section>
    </div>
  );
}

// ---- Privacy (V8-C05) -----------------------------------------------------------------------
function PrivacyView({ onHome }: { onHome: () => void }) {
  const sections = ["Données enregistrées par l’application", "Mode démonstration", "Traceurs et mesure d’audience", "Vos droits et le contact"];
  return (
    <div className={`${styles.page} ${styles.document}`}>
      <Crumb onHome={onHome} current="Confidentialité" />
      <h1 className={styles.title}>Confidentialité</h1>
      <p className={styles.subtitle}>Ce que l’application enregistre aujourd’hui, où, et ce qui reste à publier. Cette page décrit le produit réel ; la politique complète sera publiée avant l’ouverture commerciale.</p>
      <section className={styles.docSection} aria-labelledby="privacy-data">
        <h2 id="privacy-data">{numbered(0, sections[0])}</h2>
        <ul className={styles.docList}>
          {PRIVACY_DATA.map((item) => (
            <li key={item.label}><strong>{item.label} :</strong> {item.text}</li>
          ))}
        </ul>
      </section>
      <section className={styles.docSection} aria-labelledby="privacy-demo">
        <h2 id="privacy-demo">{numbered(1, sections[1])}</h2>
        <p>La démonstration n’envoie rien à un serveur : ses exemples et vos modifications sont conservés uniquement dans ce navigateur (localStorage). Pour les effacer, utilisez le bouton « Réinitialiser » du bandeau de démonstration, ou supprimez les données de site de ce navigateur.</p>
      </section>
      <section className={styles.docSection} aria-labelledby="privacy-trackers">
        <h2 id="privacy-trackers">{numbered(2, sections[2])}</h2>
        <p>Cette version ne contient aucun traceur publicitaire ni outil de mesure d’audience. Un brouillon de demande non envoyé peut être conservé localement dans votre navigateur jusqu’à votre connexion.</p>
      </section>
      <section className={styles.docSection} aria-labelledby="privacy-rights">
        <h2 id="privacy-rights">{numbered(3, sections[3])}</h2>
        <Unavailable title="Politique complète, contact DPO et préférences : à publier avant ouverture" reason="Les modalités d’accès, de rectification et de suppression, la durée de conservation, le contact du délégué à la protection des données et les préférences de confidentialité seront publiés avant l’ouverture commerciale." blocker="PUB-10" />
      </section>
      <p className={styles.docFoot}>
        <Icon name="shield" size={20} />
        <span>Aucune adresse de contact n’est affichée tant que l’exploitant n’est pas désigné ; aucun cookie analytique ou marketing n’est utilisé.</span>
      </p>
    </div>
  );
}

// ---- Legal notice (M63) ----------------------------------------------------------------------
function LegalView({ onHome }: { onHome: () => void }) {
  return (
    <div className={`${styles.page} ${styles.document}`}>
      <Crumb onHome={onHome} current="Mentions légales" />
      <h1 className={styles.title}>Mentions légales</h1>
      <p className={styles.subtitle}>Structure des mentions obligatoires. Chaque champ sera complété par l’exploitant avant publication.</p>
      {LEGAL_SECTIONS.map((section, index) => (
        <section key={section.title} className={styles.docSection} aria-labelledby={`legal-section-${index}`}>
          <h2 id={`legal-section-${index}`}>{numbered(index, section.title)}</h2>
          <dl className={styles.legalFields}>
            {section.fields.map((field) => (
              <div key={field}>
                <dt>{field} :</dt>
                <dd>{PENDING}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <Unavailable title="Mentions légales à compléter" reason="Aucune société, adresse ou identifiant fictif n’est affiché. Les informations ci-dessus seront renseignées par l’exploitant avant l’ouverture commerciale." blocker="PUB-08" />
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
          <p>Un propriétaire d’organisation vous a transmis ce lien. Connectez-vous avec l’adresse email qui a reçu l’invitation : elle sera acceptée automatiquement après la connexion, puis l’organisation apparaîtra dans votre espace.</p>
          <p>Le code n’est valable qu’une fois, pour l’adresse invitée, jusqu’à sa date d’expiration fixée par le propriétaire.</p>
          <div className={styles.inviteActions}>
            <button type="button" className="button primary" onClick={() => session.keepInvitation(session.param)}>Se connecter pour accepter</button>
            <button type="button" className="button outline" onClick={() => session.go("home")}>Plus tard</button>
          </div>
        </>
      ) : (
        <>
          <p role="alert">Ce lien d’invitation est incomplet ou invalide. Demandez un nouveau lien au propriétaire de l’organisation.</p>
          <button type="button" className="button outline" onClick={() => session.go("home")}>Revenir à l’accueil</button>
        </>
      )}
    </section>
  );
}

const DEMO_ROLES = ["client", "artisan", "manager", "admin"] as const;
// Explicit demonstration entry (#demo/<role> or #demo/<role>-<view>): isolated examples,
// never a live account. The controller ignores it when a live session exists.
function DemoEntryView({ session }: { session: PublicSession }) {
  // #demo/<role>[-<view>[.<id>]] — the optional id selects a demo dossier for the view.
  const [path, id] = session.param.split(".");
  const [head, ...rest] = path.split("-");
  const role = (DEMO_ROLES as readonly string[]).includes(head) ? (head as (typeof DEMO_ROLES)[number]) : "client";
  const target = rest.join("-");
  useEffect(() => {
    session.startDemo(role, (target || undefined) as View | undefined, id || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, target, id]);
  return (
    <section className={`panel ${styles.invitePanel}`} role="status">
      <h1>Ouverture de la démonstration…</h1>
      <p>Données fictives conservées dans ce navigateur. Aucun artisan contacté, aucun débit bancaire.</p>
    </section>
  );
}
