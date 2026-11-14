"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "../app/icons";
import { INTERVENTION_PROFILES, repairSituations, type RepairSituation } from "../../shared/intervention-profile";
import { HOME_SUPPORT_PREVIEW } from "../../shared/support-contact";
import { COMMITMENTS, MATCHING, STEPS, WEB_FAQ as FAQ } from "../../shared/public-home";
import { PUBLIC_ADVICE } from "./public-advice-content";
import { SERVICES, SERVICE_PHOTOS, servicePath, type ServicePhoto } from "./public-service-catalog";
import { PublicServiceList } from "./public-service-list";
import { PublicContactActions, usePublishedSupportPhone } from "./public-contact-actions";
import { PublicChrome, actionButton, type HomeAction, type HomeHandlers } from "./public-chrome";
import styles from "./public-landing.module.css";

export { actionKey, parseActionKey, runHomeAction } from "./public-chrome";
export type { HomeAction, HomeHandlers, HomeTargetView } from "./public-chrome";

type Situation = {
  title: string;
  description: string;
  href: string;
  photo: ServicePhoto;
  position: string;
};

const repairPhotos: Record<RepairSituation["photo"], [ServicePhoto, string]> = {
  outage: [SERVICE_PHOTOS.cabinet, "34% 44%"],
  socket: [SERVICE_PHOTOS.outlet, "50% 51%"],
  panel: [SERVICE_PHOTOS.panelWork, "56% 43%"],
  light: [SERVICE_PHOTOS.fixture, "38% 42%"],
  inspection: [SERVICE_PHOTOS.panelWork, "56% 43%"],
};
function toSituation({ title, description, slug, photo: key }: RepairSituation): Situation {
  const [photo, position] = repairPhotos[key];
  return { title, description, href: servicePath(slug), photo, position };
}

const household = repairSituations("particulier");
const shortcuts = ["Coupure", "Prises", "Tableau", "Éclairage"];
const SHORTCUTS = household.map(({ slug, photo }, index) => ({ label: shortcuts[index], art: photo, href: servicePath(slug) }));
const MODES = [
  { id: "repair", label: "Dépannage", icon: "bolt", title: "Dépannages courants", cards: [] },
  {
    id: "install", label: "Installation", icon: "plug", title: "Installations courantes",
    cards: [
      { title: "Ajouter une prise", description: "Préparez la pose d’un nouveau point électrique.", href: "/#new/installation-prise", photo: SERVICE_PHOTOS.outlet, position: "50% 53%" },
      { title: "Installer un luminaire", description: "Décrivez le luminaire et son emplacement.", href: "/#new/installation-luminaire", photo: SERVICE_PHOTOS.fixture, position: "38% 43%" },
    ],
  },
  {
    id: "diagnose", label: "Diagnostic", icon: "search", title: "Situations à vérifier",
    cards: [
      { title: "Origine de la panne inconnue", description: "Vous constatez une anomalie sans avoir identifié son origine.", href: servicePath("origine-de-la-panne-inconnue"), photo: SERVICE_PHOTOS.cabinet, position: "42% 45%" },
      { title: "Faire vérifier le tableau", description: "Décrivez le problème pour orienter la vérification.", href: servicePath("panne-tableau-electrique"), photo: SERVICE_PHOTOS.panel, position: "52% 45%" },
      toSituation(household[2]),
    ],
  },
] satisfies { id: string; label: string; icon: string; title: string; cards: Situation[] }[];
const SECTIONS = [
  { id: "accueil-services", label: "Services" },
  { id: "accueil-interventions", label: "Interventions" },
  { id: "accueil-conseils", label: "Le blog" },
];

export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr").trim();
}

type ScrollDoc = { getElementById(id: string): { scrollIntoView(o: ScrollIntoViewOptions): void; querySelector<E extends Element = HTMLElement>(s: string): E | null } | null };
type ScrollWin = { matchMedia?: (q: string) => { matches: boolean } };
export function scrollToSection(id: string, doc: ScrollDoc = document, win: ScrollWin = window) {
  const section = doc.getElementById(id);
  if (!section) return;
  const reduced = typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  section.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  section.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
}

type Detail = { title: string; text: string; link?: { href: string; text: string } };

function Details({ items, name }: { items: Detail[]; name?: string }) {
  return (
    <div className={styles.details}>
      {items.map((item, index) => (
        <details key={item.title} name={name} open={name && index === 0 ? true : undefined}>
          <summary>{item.title}<Icon name="arrow" size={16} /></summary>
          <p>{item.text} {item.link && <a href={item.link.href}>{item.link.text}</a>}</p>
        </details>
      ))}
    </div>
  );
}

export function PublicHome({ gated = false, handlers, supportWhatsAppPhone, showSupportPreview = false }: { gated?: boolean; handlers: HomeHandlers; supportWhatsAppPhone?: string; showSupportPreview?: boolean }) {
  const phoneHref = usePublishedSupportPhone();
  const [modeIndex, setModeIndex] = useState(0);
  const [profile, setProfile] = useState("particulier");
  const [query, setQuery] = useState("");
  const modeButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const rail = useRef<HTMLUListElement>(null);
  const mode = MODES[modeIndex];
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const situations = mode.id === "repair" ? repairSituations(profile).map(toSituation) : mode.cards;
  const cards = situations.filter((card) => {
    const content = normalize(`${card.title} ${card.description}`);
    return terms.every((term) => content.includes(term));
  });
  const act = (action: HomeAction) => actionButton(action, handlers);
  const chooseMode = (index: number) => {
    setModeIndex(index);
    setQuery("");
    if (rail.current) rail.current.scrollLeft = 0;
  };
  const onModeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = tabKeyTarget(event.key, modeIndex, MODES.length);
    if (next === null) return;
    event.preventDefault();
    chooseMode(next);
    modeButtons.current[next]?.focus();
  };
  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    scrollToSection("accueil-services");
  };
  const moveCards = (direction: number) => {
    const list = rail.current;
    const card = list?.firstElementChild;
    if (!list || !card) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollBy({ left: direction * (card.getBoundingClientRect().width + 10), behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <PublicChrome
      supportWhatsAppPhone={supportWhatsAppPhone}
      supportPhoneHref={phoneHref}
      current="home"
      handlers={handlers}
      onHome={() => window.scrollTo({ top: 0 })}
      sections={SECTIONS}
      onSection={scrollToSection}
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

        <div className={styles.hero}>
          <section className={styles.entry} aria-labelledby="public-home-title">
            <h1 id="public-home-title">
              <span className={styles.mobileTitle}>Dépannage électrique</span>
              <span className={styles.desktopTitle}>Un problème électrique ?</span>
            </h1>
            <p className={styles.heroLead}>Choisissez le lieu d’intervention et décrivez ce qui se passe.</p>
            <div className={styles.locationAndProfile}>
              <button className={styles.address} {...act({ type: "address" })}>
                <Icon name="location" size={20} />
                <span><small>Lieu d’intervention</small><strong>Choisir mon adresse</strong></span>
                <Icon name="arrow" size={15} />
              </button>
              <label className={styles.profileSelect}>
                <Icon name="users" size={20} />
                <span><small>Je suis un</small></span>
                <select aria-label="Je suis un" value={profile} onChange={event => {
                  setProfile(event.target.value);
                  if (rail.current) rail.current.scrollLeft = 0;
                }}>
                  {INTERVENTION_PROFILES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
                <Icon name="arrow" size={15} />
              </label>
            </div>
            <div className={styles.modes} role="tablist" aria-label="Type de service" onKeyDown={onModeKey}>
              {MODES.map((item, index) => (
                <button
                  type="button" role="tab" key={item.id} id={`mode-${item.id}`}
                  ref={(element) => { modeButtons.current[index] = element; }}
                  aria-controls="accueil-services" aria-selected={modeIndex === index}
                  tabIndex={modeIndex === index ? 0 : -1} onClick={() => chooseMode(index)}
                >
                  <Icon name={item.icon} size={18} />{item.label}
                </button>
              ))}
            </div>
            <form className={styles.searchForm} onSubmit={onSearch}>
              <div className={styles.searchRow}>
                <label>
                  <Icon name="search" size={22} />
                  <input type="search" aria-label="Rechercher un problème électrique" aria-controls="accueil-services" placeholder="Quel est le problème ?" value={query} onChange={(event) => setQuery(event.target.value)} />
                </label>
                <a href="/#new/scheduled"><Icon name="calendar" size={18} /> Plus tard</a>
              </div>
              {query.trim() && <button type="submit" className={styles.searchResults}>Voir {cards.length} résultat{cards.length > 1 ? "s" : ""}<Icon name="arrow" size={16} /></button>}
              <div className={styles.searchActions}>
                <button className={styles.primary} type="submit">Trouver une intervention <Icon name="arrow" size={18} /></button>
                <span><Icon name="check" size={17} /> Devis avant travaux</span>
              </div>
            </form>
            {showSupportPreview && (
              <aside className={styles.responseBanner} aria-label="Délai moyen de réponse">
                <Icon name="clock" size={22} />
                <p><strong>{HOME_SUPPORT_PREVIEW.average}</strong> {HOME_SUPPORT_PREVIEW.message}</p>
              </aside>
            )}
          </section>

          <section className={styles.shortcuts} aria-labelledby="home-shortcuts">
            <h2 id="home-shortcuts">Pour vous</h2>
            <ul>{SHORTCUTS.map((shortcut) => (
              <li key={shortcut.art}>
                <a href={shortcut.href}>
                  <span data-art={shortcut.art}><svg width="57" height="57" viewBox="0 0 80 80" aria-hidden="true"><use href={`/home/intervention-shortcuts.svg#art-${shortcut.art}`} /></svg></span>
                  {shortcut.label}
                </a>
              </li>
            ))}</ul>
          </section>

          <section id="accueil-services" className={styles.situations} role="tabpanel" aria-labelledby={`mode-${mode.id}`}>
            <div className={styles.situationsHeading}>
              <h2 tabIndex={-1}>{mode.title}</h2>
              <span aria-live="polite">{cards.length} {cards.length === 1 ? "situation" : "situations"}{mode.id === "repair" && ` · ${INTERVENTION_PROFILES.find(item => item.value === profile)?.label}`}</span>
              {cards.length > 1 && <div className={styles.carouselControls}>
                <button type="button" aria-label="Cartes précédentes" onClick={() => moveCards(-1)}><Icon name="back" size={17} /></button>
                <button type="button" aria-label="Cartes suivantes" onClick={() => moveCards(1)}><Icon name="arrow" size={17} /></button>
              </div>}
            </div>
            {cards.length > 0 ? (
              <ul ref={rail} className={styles.situationList}>
                {cards.map((card) => (
                  <li key={card.title}>
                    <a href={card.href}>
                      <img src={card.photo.src} width={card.photo.width} height={card.photo.height} alt="" decoding="async" style={{ objectPosition: card.position }} />
                      <span><strong>{card.title}</strong><small>{card.description}</small></span>
                      <Icon name="arrow" size={17} />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.empty}>
                <p>Aucune situation ne correspond à votre recherche.</p>
                <button className={styles.textLink} {...act({ type: "new" })}>Décrire mon besoin</button>
                <button className={styles.textLink} type="button" onClick={() => setQuery("")}>Effacer la recherche</button>
              </div>
            )}
          </section>
        </div>

        <section className={styles.urgent} aria-labelledby="home-urgent">
          <span className={styles.urgentIcon}><Icon name="bolt" size={28} /></span>
          <div><h2 id="home-urgent">Votre panne est urgente ?</h2><p>Décrivez la panne et indiquez votre commune. Le créneau dépend des disponibilités.</p></div>
          <div className={styles.urgentActions}>
            <PublicContactActions inline phoneHref={phoneHref} phoneLabel={showSupportPreview ? HOME_SUPPORT_PREVIEW.callLabel : undefined} />
            <a className={styles.bannerButton} href="/#new/urgent">Décrire ma panne urgente <Icon name="arrow" size={16} /></a>
          </div>
        </section>

        <section className={styles.steps} aria-labelledby="home-steps">
          <h2 id="home-steps">De la demande au devis</h2>
          <ol>{STEPS.map((step) => <li key={step.title}><strong>{step.title}</strong><p>{step.text}</p></li>)}</ol>
          <button className={styles.textLink} {...act({ type: "new" })}>Présenter mon besoin <Icon name="arrow" size={16} /></button>
        </section>

        <section className={styles.matching} aria-labelledby="home-matching">
          <h2 id="home-matching">Comment on trouve votre électricien</h2>
          <div className={styles.matchingGrid}>
            <img src="/home/section-real-panel.jpg" alt="Un électricien examine un tableau électrique" width={1200} height={900} loading="lazy" decoding="async" />
            <div>
              <Details items={MATCHING} name="matching" />
              <button className={styles.primary} type="button" onClick={() => { chooseMode(2); scrollToSection("accueil-services"); }}>Lancer le diagnostic <Icon name="arrow" size={16} /></button>
            </div>
          </div>
        </section>

        <section className={styles.commitments} aria-labelledby="home-commitments">
          <h2 id="home-commitments">Nos engagements</h2>
          <ul>{COMMITMENTS.map((item) => (
            <li key={item.title}>
              <Icon name={item.icon} size={23} />
              <div><h3>{item.title}</h3><p>{item.text}</p>{item.link && <a className={styles.textLink} href={item.link.href}>{item.link.text} <Icon name="arrow" size={16} /></a>}</div>
            </li>
          ))}</ul>
        </section>

        <section id="accueil-interventions" className={styles.catalogue} aria-labelledby="home-catalogue">
          <h2 id="home-catalogue" tabIndex={-1}>Les interventions électriques les plus courantes</h2>
          <p>Fourchettes indicatives TTC. Le prix final figure sur le devis que vous acceptez.</p>
          <PublicServiceList services={SERVICES} />
          <a className={styles.textLink} href="/prestations">Voir toutes les interventions <Icon name="arrow" size={16} /></a>
        </section>

        <section className={styles.faq} aria-labelledby="home-faq">
          <div><h2 id="home-faq">Questions fréquentes</h2><p>Les réponses utiles avant de demander un dépannage.</p><a className={styles.textLink} href="/#help/contact">Voir l’assistance <Icon name="arrow" size={16} /></a></div>
          <Details items={FAQ} />
        </section>

        <section className={styles.recruitment} aria-labelledby="home-recruitment">
          <div>
            <h2 id="home-recruitment">Vous êtes électricien ?</h2>
            <p>Rejoignez notre réseau pour recevoir des propositions de mission selon votre secteur, vos compétences et vos disponibilités.</p>
            <button className={styles.bannerButton} {...act({ type: "view", view: "join" })}>Découvrir la candidature <Icon name="arrow" size={16} /></button>
          </div>
          <img src="/home/hero-photo-2.jpg" alt="" width={1800} height={1350} loading="lazy" decoding="async" />
        </section>

        <section id="accueil-conseils" className={styles.blog} aria-labelledby="home-blog">
          <div className={styles.blogHeading}>
            <div><h2 id="home-blog" tabIndex={-1}>Le blog du dépannage</h2><p>Des conseils pour préparer votre intervention.</p></div>
            <a className={styles.textLink} href="/conseils">Voir tous les conseils <Icon name="arrow" size={16} /></a>
          </div>
          <div className={styles.blogGrid}>{PUBLIC_ADVICE.map((article) => (
            <a key={article.id} href={`/conseils#${article.id}`}>
              <img src={article.image} width={420} height={180} alt="" loading="lazy" decoding="async" />
              <div><small>{article.topic}</small><h3>{article.title}</h3><p>{article.summary}</p></div>
            </a>
          ))}</div>
        </section>
      </div>
    </PublicChrome>
  );
}
