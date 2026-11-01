"use client";
// Public home (UI-PUBLIC-HOME-001): the first screen migrated to the theme foundation
// (ThemeSurface + ThemeToggle + --ui-* tokens). Visual reference: prototype 6bc0cab
// `web-network.html` (green / Plus Jakarta Sans / light-dark). Presentational only: every action
// goes through `HomeHandlers`, wired by PublicSite to the existing PublicSession callbacks.
// Navigation uses hash routing, so in-page sections are reached with buttons (scroll + focus),
// never `href="#…"`. No price, review, delay, qualification or metric; photos are illustrations
// (credits in public/home/CREDITS.md). Role spaces are not re-themed by this file.
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Category } from "../app/types";
import { CATEGORIES } from "../app/format";
import { ThemeSurface } from "../app/theme-provider";
import { ThemeToggle } from "../app/theme-toggle";
import { FAQ } from "./public-lists";
import styles from "./public-home.module.css";

// ---- Actions: one table between rendered controls and the real session callbacks --------------
export type HomeTargetView = "help" | "pricing" | "join" | "about" | "privacy" | "legal";
export type HomeAction =
  | { type: "new"; category?: Category }
  | { type: "login" }
  | { type: "view"; view: HomeTargetView }
  | { type: "demo"; role?: "manager" };
export type HomeHandlers = {
  onNew(category?: Category): void;
  onLogin(): void;
  onNavigate(view: HomeTargetView): void;
  onDemo(role?: "manager"): void;
};
const TARGET_VIEWS: HomeTargetView[] = ["help", "pricing", "join", "about", "privacy", "legal"];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function runHomeAction(action: HomeAction, handlers: HomeHandlers): void {
  if (action.type === "new") {
    if (action.category) handlers.onNew(action.category);
    else handlers.onNew();
  } else if (action.type === "login") handlers.onLogin();
  else if (action.type === "view") handlers.onNavigate(action.view);
  else if (action.role) handlers.onDemo(action.role);
  else handlers.onDemo();
}
/** Stable key rendered as `data-home-action` (lets SSR tests replay every rendered control). */
export function actionKey(action: HomeAction): string {
  if (action.type === "new") return action.category ? `new:${action.category}` : "new";
  if (action.type === "view") return `view:${action.view}`;
  if (action.type === "demo") return action.role ? `demo:${action.role}` : "demo";
  return "login";
}
export function parseActionKey(key: string): HomeAction | null {
  const [type, arg, extra] = key.split(":");
  if (extra !== undefined) return null;
  if (type === "login" && arg === undefined) return { type: "login" };
  if (type === "new") {
    if (arg === undefined) return { type: "new" };
    return (CATEGORY_IDS as string[]).includes(arg) ? { type: "new", category: arg as Category } : null;
  }
  if (type === "view") return (TARGET_VIEWS as string[]).includes(arg ?? "") ? { type: "view", view: arg as HomeTargetView } : null;
  if (type === "demo") {
    if (arg === undefined) return { type: "demo" };
    return arg === "manager" ? { type: "demo", role: "manager" } : null;
  }
  return null;
}

// ---- Pure keyboard helpers --------------------------------------------------------------------
/** Manual slides only: wraps both ways, never advances on its own. */
export function stepSlide(index: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}
export function slideKeyDelta(key: string): -1 | 1 | null {
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  return null;
}
/** ARIA tabs (automatic activation): ←/→ wrap, Home/End jump; other keys are ignored. */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return stepSlide(index, count, 1);
  if (key === "ArrowLeft") return stepSlide(index, count, -1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

// ---- Content (sober, provisional copy; categories are the business CATEGORIES) ----------------
const PHOTO = {
  hero1: "/home/hero-photo-1.jpg",
  hero2: "/home/hero-photo-2.jpg",
  panel: "/home/section-real-panel.jpg",
  socket: "/home/section-socket.jpg",
  outlet: "/home/section-outlet.jpg",
};
type Slide = { image: string; width: number; height: number; alt: string; title: string; text: string; secondary: { label: string; action: HomeAction } };
export const HOME_SLIDES: Slide[] = [
  {
    image: PHOTO.hero1,
    width: 1800,
    height: 1200,
    alt: "Électricien en tenue haute visibilité intervenant dans une armoire électrique (photo d’illustration)",
    title: "Une panne électrique ? Décrivez-la, on s’occupe de la suite.",
    text: "Coupure, prise, tableau ou éclairage : décrivez le problème en quelques étapes. Une estimation indicative, puis un devis avant toute intervention.",
    secondary: { label: "Explorer la démonstration", action: { type: "demo" } },
  },
  {
    image: PHOTO.hero2,
    width: 1800,
    height: 1350,
    alt: "Électricien travaillant avec une visseuse sur un tableau électrique (photo d’illustration)",
    title: "Un devis détaillé avant toute intervention",
    text: "L’artisan propose un devis ; rien n’est engagé tant que vous ne l’avez pas accepté. Le paiement est une étape séparée.",
    secondary: { label: "Comment ça marche", action: { type: "view", view: "help" } },
  },
];
export const HOME_CARDS: { title: string; category: Category; image: string; position: string }[] = [
  { title: "Panne de tableau électrique", category: "panel", image: PHOTO.panel, position: "center 45%" },
  { title: "Prise qui ne fonctionne plus", category: "socket", image: PHOTO.socket, position: "center" },
  { title: "Disjoncteur qui saute", category: "panel", image: PHOTO.hero1, position: "45% 40%" },
  { title: "Coupure de courant partielle", category: "outage", image: PHOTO.hero1, position: "30% 35%" },
  { title: "Prise abîmée ou qui chauffe", category: "socket", image: PHOTO.outlet, position: "center 40%" },
  { title: "Éclairage qui ne s’allume plus", category: "lighting", image: PHOTO.hero2, position: "60% 40%" },
  { title: "Plusieurs prises sans courant", category: "socket", image: PHOTO.socket, position: "center 60%" },
  { title: "Origine de la panne inconnue", category: "diagnostic", image: PHOTO.outlet, position: "center" },
];
export const HOME_SITUATIONS: Record<Category, string[]> = {
  outage: ["Plus de courant dans tout le logement", "Coupure sur une partie du logement", "Courant qui revient puis repart"],
  panel: ["Disjoncteur qui saute", "Différentiel qui déclenche", "Fusible ou disjoncteur à vérifier", "Tableau qui chauffe ou grésille"],
  socket: ["Prise qui ne fonctionne plus", "Plusieurs prises sans courant", "Prise qui chauffe ou noircit", "Interrupteur sans effet"],
  lighting: ["Luminaire qui ne s’allume plus", "Circuit d’éclairage sans courant", "Éclairage qui clignote", "Éclairage extérieur en panne"],
  diagnostic: ["Origine de la panne inconnue", "Panne intermittente", "Odeur de chaud près d’un appareil ou d’une prise", "Autre problème électrique"],
};
const ADVICE_QUESTIONS = FAQ.slice(0, 4).map((entry) => entry.question);
const SECTION = { interventions: "accueil-interventions", services: "accueil-services", advice: "accueil-conseils" } as const;
type SectionId = (typeof SECTION)[keyof typeof SECTION];
const NAV_SECTIONS: { id: SectionId; label: string }[] = [
  { id: SECTION.interventions, label: "Interventions" },
  { id: SECTION.services, label: "Services" },
  { id: SECTION.advice, label: "Conseils" },
];
const NAV_VIEWS: { view: HomeTargetView; label: string }[] = [
  { view: "pricing", label: "Tarifs" },
  { view: "join", label: "Vous êtes artisan ?" },
];
const FOOTER_VIEWS: { view: HomeTargetView; label: string }[] = [
  { view: "help", label: "Aide" },
  { view: "about", label: "À propos" },
  { view: "privacy", label: "Confidentialité" },
  { view: "legal", label: "Mentions légales" },
];

type ScrollDoc = { getElementById(id: string): { scrollIntoView(o: ScrollIntoViewOptions): void; querySelector<E extends Element = HTMLElement>(s: string): E | null } | null };
type ScrollWin = { matchMedia?: (q: string) => { matches: boolean } };
/** In-page section navigation: scroll + focus the section heading. Never touches
 *  `location.hash`/history (the app router reads the hash as a view) nor the session. */
export function scrollToSection(id: string, doc: ScrollDoc = document, win: ScrollWin = window) {
  const section = doc.getElementById(id);
  if (!section) return;
  const reduced = typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  section.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  section.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
}

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22">
        <path d="M13 2L5 14h6l-1 8 8-12h-6l1-8z" fill="currentColor" />
      </svg>
    </span>
  );
}
function Arrow({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={dir === "prev" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PublicHome({ gated = false, handlers }: { gated?: boolean; handlers: HomeHandlers }) {
  const uid = useId();
  const navId = `${uid}-nav`;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const [slide, setSlide] = useState(0);
  const [tab, setTab] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

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

  const act = (action: HomeAction) => ({
    type: "button" as const,
    "data-home-action": actionKey(action),
    onClick: () => {
      setMenuOpen(false);
      runHomeAction(action, handlers);
    },
  });
  const goSection = (id: SectionId) => {
    setMenuOpen(false);
    scrollToSection(id);
  };
  const onHeroKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const delta = slideKeyDelta(e.key);
    if (delta === null) return;
    e.preventDefault();
    setSlide((s) => stepSlide(s, HOME_SLIDES.length, delta));
  };
  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = tabKeyTarget(e.key, tab, CATEGORIES.length);
    if (next === null) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const slideIds = HOME_SLIDES.map((_, i) => `${uid}-slide-${i}`);

  return (
    <ThemeSurface className={styles.home}>
      <header className={styles.topbar}>
        <div className={`${styles.wrap} ${styles.topbarInner}`}>
          <button type="button" className={styles.brand} aria-label="Courant, accueil" aria-current="page" onClick={() => window.scrollTo({ top: 0 })}>
            <BrandMark />
            <span className={styles.brandText}>
              <strong>Courant</strong>
              <small>Nom de travail</small>
            </span>
          </button>
          <nav id={navId} className={`${styles.nav} ${menuOpen ? styles.navOpen : ""}`} aria-label="Navigation principale">
            {NAV_SECTIONS.map((item) => (
              <button type="button" key={item.id} className={styles.navLink} data-home-anchor={item.id} onClick={() => goSection(item.id)}>
                {item.label}
              </button>
            ))}
            {NAV_VIEWS.map((item) => (
              <button key={item.view} className={styles.navLink} {...act({ type: "view", view: item.view })}>
                {item.label}
              </button>
            ))}
            <button className={`${styles.navLink} ${styles.navLogin}`} {...act({ type: "login" })}>
              Se connecter
            </button>
          </nav>
          <div className={styles.topbarActions}>
            <ThemeToggle className={styles.themeToggle} />
            <button className={`${styles.btn} ${styles.btnGhost} ${styles.loginButton}`} {...act({ type: "login" })}>
              Se connecter
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary} ${styles.headerCta}`} {...act({ type: "new" })}>
              Décrire ma panne
            </button>
            <button ref={menuToggle} type="button" className={styles.menuButton} aria-expanded={menuOpen} aria-controls={navId} aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"} onClick={() => setMenuOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d={menuOpen ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main id="main" className={styles.main}>
        {gated && (
          <div className={`${styles.wrap} ${styles.gate}`} role="status">
            <span>Connectez-vous pour accéder à cet espace.</span>
            <button className={`${styles.btn} ${styles.btnGhost}`} {...act({ type: "login" })}>
              Se connecter
            </button>
          </div>
        )}

        {/* Full-viewport hero: two photos, MANUAL slides only (no autoplay), opaque text surface. */}
        <section className={styles.hero} aria-roledescription="carrousel" aria-label="Présentation du dépannage électrique" onKeyDown={onHeroKey}>
          <div className={styles.slides} aria-live="polite">
            {HOME_SLIDES.map((s, i) => {
              const Title = i === 0 ? "h1" : "h2";
              return (
                <div key={s.image} id={slideIds[i]} className={styles.slide} role="group" aria-roledescription="diapositive" aria-label={`${i + 1} sur ${HOME_SLIDES.length}`} hidden={i !== slide}>
                  <img src={s.image} alt={s.alt} width={s.width} height={s.height} decoding="async" {...(i === 0 ? { fetchPriority: "high" as const } : {})} />
                  <div className={styles.slideText}>
                    <Title className={styles.slideTitle}>{s.title}</Title>
                    <p>{s.text}</p>
                    <div className={styles.slideActions}>
                      <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBig}`} {...act({ type: "new" })}>
                        Décrire ma panne
                      </button>
                      <button className={`${styles.btn} ${styles.btnOutlineLight} ${styles.btnBig}`} {...act(s.secondary.action)}>
                        {s.secondary.label}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className={styles.slideControls}>
            <button type="button" className={styles.slideArrow} aria-controls={slideIds.join(" ")} aria-label="Diapositive précédente" onClick={() => setSlide((s) => stepSlide(s, HOME_SLIDES.length, -1))}>
              <Arrow dir="prev" />
            </button>
            <div className={styles.slideDots} role="group" aria-label="Choisir une diapositive">
              {HOME_SLIDES.map((_, i) => (
                <button key={i} type="button" className={styles.slideDot} aria-controls={slideIds[i]} aria-label={`Diapositive ${i + 1}`} aria-current={i === slide ? "true" : undefined} onClick={() => setSlide(i)} />
              ))}
            </div>
            <button type="button" className={styles.slideArrow} aria-controls={slideIds.join(" ")} aria-label="Diapositive suivante" onClick={() => setSlide((s) => stepSlide(s, HOME_SLIDES.length, 1))}>
              <Arrow dir="next" />
            </button>
          </div>
        </section>
        <div className={styles.wrap}>
          <p className={styles.credit}>Photos d’illustration (Pexels) : elles ne représentent ni notre équipe ni un artisan de la plateforme.</p>

          <section id={SECTION.interventions} className={styles.section} aria-labelledby={`${uid}-iv`}>
            <h2 id={`${uid}-iv`} className={styles.sectionTitle} tabIndex={-1}>
              Interventions électriques fréquentes
            </h2>
            <ul className={styles.ivGrid}>
              {HOME_CARDS.map((card) => (
                <li key={card.title}>
                  <button className={styles.ivc} {...act({ type: "new", category: card.category })}>
                    <img src={card.image} alt="" width={160} height={120} loading="lazy" decoding="async" style={{ objectPosition: card.position }} />
                    <span className={styles.ivcBody}>
                      <span className={styles.chip}>{CATEGORIES.find((c) => c.id === card.category)?.label}</span>
                      <strong>{card.title}</strong>
                    </span>
                  </button>
                </li>
              ))}
              <li className={styles.ivCta}>
                <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBig}`} {...act({ type: "new" })}>
                  Décrire ma panne <span aria-hidden="true">→</span>
                </button>
              </li>
            </ul>
            <p className={styles.hint}>Texte provisoire. L’estimation est indicative et doit être confirmée par un devis avant toute intervention.</p>
          </section>

          <section id={SECTION.services} className={`${styles.section} ${styles.catalogue}`} aria-labelledby={`${uid}-cat`}>
            <h2 id={`${uid}-cat`} className={styles.sectionTitle} tabIndex={-1}>
              Dépannage électrique : nos services
            </h2>
            <div className={styles.tablist} role="tablist" aria-label="Catégories de pannes" onKeyDown={onTabKey}>
              {CATEGORIES.map((c, i) => (
                <button
                  key={c.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${uid}-tab-${c.id}`}
                  aria-controls={`${uid}-panel-${c.id}`}
                  aria-selected={i === tab}
                  tabIndex={i === tab ? 0 : -1}
                  onClick={() => setTab(i)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {CATEGORIES.map((c, i) => (
              <div key={c.id} role="tabpanel" id={`${uid}-panel-${c.id}`} aria-labelledby={`${uid}-tab-${c.id}`} tabIndex={0} hidden={i !== tab} className={styles.tabpanel}>
                <p className={styles.panelLead}>{c.description}</p>
                <ul className={styles.tabLinks}>
                  {HOME_SITUATIONS[c.id].map((label) => (
                    <li key={label}>
                      <button {...act({ type: "new", category: c.id })}>
                        <span aria-hidden="true">→</span>
                        {label}
                      </button>
                    </li>
                  ))}
                </ul>
                <button className={`${styles.btn} ${styles.btnPrimary}`} {...act({ type: "new", category: c.id })}>
                  Décrire cette panne
                </button>
              </div>
            ))}
          </section>

          <section id={SECTION.advice} className={`${styles.section} ${styles.advice}`} aria-labelledby={`${uid}-adv`}>
            <h2 id={`${uid}-adv`} className={styles.sectionTitle} tabIndex={-1}>
              Conseils et formation
            </h2>
            <div className={styles.adviceGrid}>
              <div className={styles.adviceIntro}>
                <img src={PHOTO.panel} alt="Électricien intervenant sur une armoire électrique ouverte (photo d’illustration)" width={1200} height={900} loading="lazy" decoding="async" />
                <p>Des repères pour comprendre une panne, une estimation et un devis. Les guides pratiques et la formation sont en préparation ; les réponses ci-contre sont déjà disponibles dans l’aide.</p>
                <button className={`${styles.btn} ${styles.btnDark}`} {...act({ type: "view", view: "help" })}>
                  Consulter l’aide
                </button>
              </div>
              <ul className={styles.adviceList} aria-label="Questions fréquentes">
                {ADVICE_QUESTIONS.map((question) => (
                  <li key={question}>
                    <button {...act({ type: "view", view: "help" })}>
                      <span className={styles.chip}>Question fréquente</span>
                      <strong>{question}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <p className={styles.hint}>Toute intervention sur un tableau électrique relève d’un professionnel.</p>
          </section>

          <section className={styles.join} aria-labelledby={`${uid}-join`}>
            <div className={styles.joinText}>
              <h2 id={`${uid}-join`}>Rejoignez notre réseau d’électriciens</h2>
              <p>Présentez votre activité et votre zone d’intervention.</p>
            </div>
            <div className={styles.joinMedia} aria-hidden="true">
              <img src={PHOTO.hero2} alt="" width={1800} height={1350} loading="lazy" decoding="async" />
            </div>
            <button className={`${styles.btn} ${styles.btnDark} ${styles.btnBig} ${styles.joinBtn}`} {...act({ type: "view", view: "join" })}>
              Nous rejoindre
            </button>
          </section>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footerInner}`}>
          <span className={styles.brandText}>
            <strong>Courant</strong>
            <small>Nom de travail. Application en préparation.</small>
          </span>
          <nav className={styles.footerNav} aria-label="Informations">
            {FOOTER_VIEWS.map((item) => (
              <button key={item.view} {...act({ type: "view", view: item.view })}>
                {item.label}
              </button>
            ))}
            <button {...act({ type: "demo", role: "manager" })}>Démonstration espace professionnel</button>
          </nav>
          <p className={styles.credits}>Crédits photo (Pexels) : Fatih Yurtman, ranjeet, Anastasia Shuraeva, Ksenia Chernaya.</p>
        </div>
      </footer>
    </ThemeSurface>
  );
}
