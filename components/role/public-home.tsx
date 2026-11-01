"use client";
// Public home (UI-PUBLIC-HOME-001): the first screen migrated to the theme foundation
// (ThemeSurface + ThemeToggle + --ui-* tokens). Visual reference: prototype 6bc0cab
// `web-network.html` (green / Plus Jakarta Sans / light-dark). Presentational only: every action
// goes through `HomeHandlers`, wired by PublicSite to the existing PublicSession callbacks.
// Navigation uses hash routing, so in-page sections are reached with buttons (scroll + focus),
// never `href="#…"`; the intervention cards are real links to /prestations/<slug> and show the
// category's indicative estimate only. No review, delay, qualification or metric; photos are illustrations
// (credits in public/home/CREDITS.md). Role spaces are not re-themed by this file.
import { useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Category } from "../app/types";
import { CATEGORIES, money } from "../app/format";
import { SERVICES, serviceEstimate, servicePath } from "./public-service-catalog";
import { FAQ } from "./public-lists";
import { PublicChrome, actionButton, type HomeAction, type HomeHandlers } from "./public-chrome";
import styles from "./public-home.module.css";

// Actions live with the shared chrome (P1 extraction); re-exported for existing callers/tests.
export { actionKey, parseActionKey, runHomeAction } from "./public-chrome";
export type { HomeAction, HomeHandlers, HomeTargetView } from "./public-chrome";

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
}; // card photos: public-service-catalog.ts (SERVICE_PHOTOS)
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
// The 8 intervention cards = the service pages catalogue (each card links to /prestations/<slug>
// and shows the canonical indicative estimate of its category).
export const HOME_CARDS: { slug: string; title: string; category: Category; image: string; position: string; href: string; min: number; max: number }[] = SERVICES.map((s) => {
  const e = serviceEstimate(s.category);
  return { slug: s.slug, title: s.title, category: s.category, image: s.photo.src, position: s.position, href: servicePath(s.slug), min: e.min, max: e.max };
});
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

function Arrow({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={dir === "prev" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PublicHome({ gated = false, handlers }: { gated?: boolean; handlers: HomeHandlers }) {
  const uid = useId();
  const [slide, setSlide] = useState(0);
  const [tab, setTab] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const act = (action: HomeAction) => actionButton(action, handlers);
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
    <PublicChrome
      current="home"
      handlers={handlers}
      onHome={() => window.scrollTo({ top: 0 })}
      sections={NAV_SECTIONS}
      onSection={(id) => scrollToSection(id)}
      className={styles.home}
      mainClassName={styles.main}
      footerNote="Crédits photo (Pexels) : Fatih Yurtman, ranjeet, Anastasia Shuraeva, Ksenia Chernaya."
    >
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
              <li key={card.slug}>
                <a className={styles.ivc} href={card.href} data-service-card={card.slug}>
                  <img src={card.image} alt="" width={160} height={120} loading="lazy" decoding="async" style={{ objectPosition: card.position }} />
                  <span className={styles.ivcBody}>
                    <span className={styles.chip}>{CATEGORIES.find((c) => c.id === card.category)?.label}</span>
                    <strong>{card.title}</strong>
                    <span className={styles.ivcPrice}>
                      Estimation indicative : {money(card.min)} – {money(card.max)}
                    </span>
                  </span>
                </a>
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
    </PublicChrome>
  );
}
