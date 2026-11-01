"use client";
// Public service page (FASTSPLIT-PUBLIC-SERVICE-PAGES-001), rendered by app/prestations/[slug].
// Same PublicChrome / ThemeSurface as the public home; this route is outside the hash-routed app,
// so every chrome action is a real navigation back to it (/#new/<category>, /#auth, /#help…).
// The price is the canonical indicative estimate of the category, labelled as such.
import { useState } from "react";
import { money } from "../app/format";
import type { Category } from "../app/types";
import { PublicChrome, type HomeHandlers, type HomeTargetView } from "./public-chrome";
import { SERVICE_STEPS, serviceEstimate, serviceRequestHref, type ServiceEntry } from "./public-service-catalog";
import { BookingBar, BookingWizard } from "./public-booking";
import bookingStyles from "./public-booking.module.css";
import styles from "./public-service.module.css";

type Go = (href: string) => void;
const browserGo: Go = (href) => window.location.assign(href);

/** Chrome actions → URLs of the hash-routed app (pure: testable without a browser). */
export function serviceChromeHref(action: { type: "new"; category?: Category } | { type: "login" } | { type: "view"; view: HomeTargetView } | { type: "demo"; role?: "manager" } | { type: "home" }): string {
  if (action.type === "new") return action.category ? serviceRequestHref(action.category) : "/#new";
  if (action.type === "login") return "/#auth";
  if (action.type === "view") return `/#${action.view}`;
  if (action.type === "demo") return `/#demo/${action.role ?? "client"}`;
  return "/";
}
export function serviceChromeHandlers(go: Go = browserGo): HomeHandlers {
  return {
    onNew: (category) => go(serviceChromeHref({ type: "new", category })),
    onLogin: () => go(serviceChromeHref({ type: "login" })),
    onNavigate: (view) => go(serviceChromeHref({ type: "view", view })),
    onDemo: (role) => go(serviceChromeHref({ type: "demo", role })),
  };
}

export function PublicServicePage({ service, initialOpen = false }: { service: ServiceEntry; initialOpen?: boolean }) {
  const estimate = serviceEstimate(service.category);
  const range = `${money(estimate.min)} – ${money(estimate.max)}`;
  // Main CTA, final band and the fixed bar's « Confirmer » share ONE action: open the wizard here.
  const [open, setOpen] = useState(initialOpen);
  const openBooking = () => setOpen(true);
  const crumb = (
    <nav className={styles.crumb} aria-label="Fil d’Ariane">
      <a href="/">Accueil</a>
      <span aria-hidden="true">›</span>
      <span aria-current="page">{service.title}</span>
    </nav>
  );
  if (open)
    return (
      <PublicChrome current="service" className={styles.withBar} handlers={serviceChromeHandlers()} onHome={() => browserGo("/")} mainClassName={styles.main}>
        <div className={styles.wrap}>
          {crumb}
          <BookingWizard service={service} range={range} onClose={() => setOpen(false)} />
        </div>
      </PublicChrome>
    );
  return (
    <PublicChrome current="service" className={styles.withBar} handlers={serviceChromeHandlers()} onHome={() => browserGo("/")} mainClassName={styles.main}>
      <div className={styles.wrap}>
        {crumb}

        <section className={styles.hero} aria-labelledby="service-title">
          <div className={styles.heroText}>
            <span className={styles.chip}>{estimate.label}</span>
            <h1 id="service-title">{service.title}</h1>
            <p className={styles.intro}>{service.intro}</p>
            <div className={styles.price} data-service-price="">
              <span>Estimation indicative</span>
              <strong>{range}</strong>
              <small>Fourchette de la catégorie « {estimate.label} ». Le montant final figure sur le devis de l’artisan, que vous acceptez avant toute intervention.</small>
            </div>
            <button type="button" className={styles.cta} onClick={openBooking} data-service-cta="" data-booking-open="">
              Décrire ma panne <span aria-hidden="true">→</span>
            </button>
          </div>
          <figure className={styles.heroMedia}>
            <img src={service.photo.src} alt={service.alt} width={service.photo.width} height={service.photo.height} decoding="async" style={{ objectPosition: service.position }} />
          </figure>
        </section>

        <div className={styles.columns}>
          <section className={styles.card} aria-labelledby="service-covers">
            <h2 id="service-covers">Ce que couvre ce dépannage</h2>
            <ul className={styles.list}>
              {service.covers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section className={styles.card} aria-labelledby="service-checks">
            <h2 id="service-checks">Vérifications possibles selon le diagnostic</h2>
            <ul className={styles.list}>
              {service.checks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className={styles.note}>L’artisan adapte ses contrôles à ce qu’il constate sur place ; seul le devis accepté engage une réparation.</p>
          </section>
        </div>

        <section className={styles.section} aria-labelledby="service-steps">
          <h2 id="service-steps">Comment ça se passe</h2>
          <ol className={styles.steps}>
            {SERVICE_STEPS.map((step, index) => (
              <li key={step.title}>
                <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
                <strong>{step.title}</strong>
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="service-faq">
          <h2 id="service-faq">Questions fréquentes</h2>
          <div className={styles.faq}>
            {service.faq.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.band} aria-labelledby="service-cta">
          <div>
            <h2 id="service-cta">Décrivez votre panne</h2>
            <p>L’estimation indicative s’affiche dès la première étape, avant toute création de compte.</p>
          </div>
          <button type="button" className={styles.cta} onClick={openBooking} data-booking-open="">
            Décrire ma panne <span aria-hidden="true">→</span>
          </button>
        </section>

        <p className={styles.credit}>Photo d’illustration (Pexels) : elle ne représente ni notre équipe ni un artisan de la plateforme.</p>
      </div>
      <BookingBar title={service.title} range={range}>
        <button type="button" className={bookingStyles.barButton} onClick={openBooking} data-booking-open="">
          Confirmer
        </button>
      </BookingBar>
    </PublicChrome>
  );
}
