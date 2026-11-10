"use client";

import { useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Category } from "../app/types";
import { CATEGORIES } from "../app/format";
import { Icon } from "../app/icons";
import { serviceBySlug } from "./public-service-catalog";
import { PublicServiceList } from "./public-service-list";
import { PublicChrome, actionButton, type HomeAction, type HomeHandlers } from "./public-chrome";
import styles from "./public-home.module.css";

// Actions live with the shared chrome (P1 extraction); re-exported for existing callers/tests.
export { actionKey, parseActionKey, runHomeAction } from "./public-chrome";
export type { HomeAction, HomeHandlers, HomeTargetView } from "./public-chrome";

/** ARIA tabs (automatic activation): ←/→ wrap, Home/End jump; other keys are ignored. */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

const featuredSlugs = ["plusieurs-prises-sans-courant", "disjoncteur-qui-saute", "coupure-de-courant-partielle"];
export const FEATURED_SERVICES = featuredSlugs.map(serviceBySlug).filter((service) => service != null);

export const HOME_SITUATIONS: Record<Category, string[]> = {
  outage: ["Plus de courant dans tout le logement", "Coupure sur une partie du logement", "Courant qui revient puis repart"],
  panel: ["Disjoncteur qui saute", "Différentiel qui déclenche", "Fusible ou disjoncteur à vérifier", "Tableau qui chauffe ou grésille"],
  socket: ["Prise qui ne fonctionne plus", "Plusieurs prises sans courant", "Prise qui chauffe ou noircit", "Interrupteur sans effet"],
  lighting: ["Luminaire qui ne s’allume plus", "Circuit d’éclairage sans courant", "Éclairage qui clignote", "Éclairage extérieur en panne"],
  diagnostic: ["Origine de la panne inconnue", "Panne intermittente", "Odeur de chaud près d’un appareil ou d’une prise", "Autre problème électrique"],
};
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

export function PublicHome({ gated = false, handlers }: { gated?: boolean; handlers: HomeHandlers }) {
  const uid = useId();
  const [tab, setTab] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const act = (action: HomeAction) => actionButton(action, handlers);
  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = tabKeyTarget(e.key, tab, CATEGORIES.length);
    if (next === null) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <PublicChrome
      current="home"
      handlers={handlers}
      onHome={() => window.scrollTo({ top: 0 })}
      sections={NAV_SECTIONS}
      onSection={(id) => scrollToSection(id)}
      appNavigation
      mainClassName={styles.main}
      footerNote="Crédits photo (Pexels) : Fatih Yurtman, ranjeet, Anastasia Shuraeva, Ksenia Chernaya."
    >
      <div className={styles.wrap}>
        {gated && (
          <div className={styles.gate} role="status">
            <span>Connectez-vous pour accéder à cet espace.</span>
            <button className={styles.textLink} {...act({ type: "login" })}>Se connecter</button>
          </div>
        )}

        <button className={styles.address} {...act({ type: "address" })}>
          <Icon name="location" size={21} />
          <span>
            <span className={styles.eyebrow}>Lieu d’intervention</span>
            <strong>Choisir mon adresse</strong>
          </span>
          <Icon name="arrow" size={16} />
        </button>

        <section className={styles.hero} aria-labelledby={`${uid}-hero`}>
          <img src="/home/hero-photo-1.jpg" alt="" width={1800} height={1200} decoding="async" fetchPriority="high" />
          <div className={styles.heroBody}>
            <span className={styles.eyebrow}>Un problème électrique ?</span>
            <h1 id={`${uid}-hero`}>Un dépannage,<br />en toute clarté.</h1>
            <p>Expliquez ce qui ne va pas.<br />L’artisan vous proposera un devis.</p>
            <button className={styles.primary} {...act({ type: "new" })}>
              Présenter mon besoin <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>

        <ul className={styles.proofs}>
          <li><Icon name="check" size={17} /> Devis avant travaux</li>
          <li><Icon name="check" size={17} /> Demande sans engagement</li>
        </ul>

        <section id={SECTION.interventions} className={styles.section} aria-labelledby={`${uid}-iv`}>
          <div className={styles.sectionHead}>
            <h2 id={`${uid}-iv`} tabIndex={-1}>Quel est votre besoin ?</h2>
            <a className={styles.textLink} href="/prestations">Tout voir</a>
          </div>
          <PublicServiceList services={FEATURED_SERVICES} />
        </section>

        <section id={SECTION.advice} className={`${styles.section} ${styles.adviceSection}`} aria-labelledby={`${uid}-adv`}>
          <h2 id={`${uid}-adv`} tabIndex={-1}>Conseils &amp; prévention</h2>
          <button className={styles.advice} {...act({ type: "view", view: "help" })}>
            Les bons réflexes en cas de panne électrique
            <Icon name="arrow" size={19} />
          </button>
        </section>

        <button className={styles.textLink} {...act({ type: "login" })}>Accéder à mon espace</button>

        <section id={SECTION.services} className={styles.section} aria-labelledby={`${uid}-cat`}>
          <h2 id={`${uid}-cat`} tabIndex={-1}>
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
              <button className={styles.primary} {...act({ type: "new", category: c.id })}>
                Décrire cette panne
              </button>
            </div>
          ))}
        </section>

        <section className={styles.join} aria-labelledby={`${uid}-join`}>
          <div>
            <h2 id={`${uid}-join`}>Vous êtes électricien ?</h2>
            <p>Présentez votre activité et votre zone d’intervention.</p>
          </div>
          <button className={styles.textLink} {...act({ type: "view", view: "join" })}>Nous rejoindre</button>
        </section>
        <button className={styles.textLink} {...act({ type: "demo" })}>Explorer la démonstration</button>
      </div>
    </PublicChrome>
  );
}
